#!/usr/bin/env bun
// Guards the integrity of the CLI release assets and publishes SHA256SUMS.txt.
//
//   bun script/cli-release-check.ts --local packages/prioricode/dist
//   bun script/cli-release-check.ts --release v0.1.4
//
// --local runs pre-upload against freshly built archives (fail fast, before
// anything touches the draft release). --release runs after every CLI upload
// job and verifies the bytes GitHub actually serves, which is the only
// authoritative view once windows archives get repacked/re-signed downstream.
//
// Checks:
//   1. every expected prioricode-* archive exists on the release
//   2. baseline (SSE2) and AVX2 builds contain byte-distinct binaries —
//      bun's separate baseline artifacts occasionally fail to materialize in
//      CI, which silently ships the same binary under two names (v0.1.3)
//   3. SHA256SUMS.txt is written (and uploaded, in release mode) so the
//      installers can verify what they download

import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "path"

const repo = process.env.GH_REPO || "Prioritech-Indonesia-Optima/prioricode"

const expected = [
  "prioricode-darwin-arm64.zip",
  "prioricode-darwin-x64.zip",
  "prioricode-darwin-x64-baseline.zip",
  "prioricode-linux-arm64.tar.gz",
  "prioricode-linux-arm64-musl.tar.gz",
  "prioricode-linux-x64.tar.gz",
  "prioricode-linux-x64-baseline.tar.gz",
  "prioricode-linux-x64-musl.tar.gz",
  "prioricode-linux-x64-baseline-musl.tar.gz",
  "prioricode-windows-arm64.zip",
  "prioricode-windows-x64.zip",
  "prioricode-windows-x64-baseline.zip",
]

// Only linux + windows bun runtimes ship a distinct baseline build; bun's
// darwin-x64 "baseline" is the same runtime as its AVX2 one, so the mac pair
// being identical is expected (true for every release ever, including v0.1.2).
const pairs: [string, string][] = [
  ["prioricode-linux-x64.tar.gz", "prioricode-linux-x64-baseline.tar.gz"],
  ["prioricode-linux-x64-musl.tar.gz", "prioricode-linux-x64-baseline-musl.tar.gz"],
  ["prioricode-windows-x64.zip", "prioricode-windows-x64-baseline.zip"],
]

const skipVariantCheck = process.argv.includes("--no-verify")
const skipUpload = process.argv.includes("--no-upload")

function die(message: string): never {
  console.error(`\x1b[0;31m${message}\x1b[0m`)
  process.exit(1)
}

async function sha256File(file: string) {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex")
}

async function binarySha256(archive: string) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-cli-check-"))
  try {
    if (archive.endsWith(".tar.gz")) await $`tar -xzf ${archive} -C ${tmp}`.quiet()
    else await $`unzip -qo ${archive} -d ${tmp}`.quiet()
    const entry = [...new Bun.Glob("**/*").scanSync({ cwd: tmp })]
      .sort()
      .find((file) => /^prioricode(\.exe)?$/.test(path.basename(file)))
    if (!entry) die(`archive ${path.basename(archive)} does not contain a prioricode binary`)
    return await sha256File(path.join(tmp, entry))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function checkVariants(assetsDir: string) {
  if (skipVariantCheck) {
    console.log("skipping baseline/AVX2 distinctness check (--no-verify)")
    return
  }
  for (const [native, baseline] of pairs) {
    const a = await binarySha256(path.join(assetsDir, native))
    const b = await binarySha256(path.join(assetsDir, baseline))
    if (a === b) {
      die(
        `baseline asset ${baseline} contains the SAME binary (${a.slice(0, 16)}…) as ${native}. ` +
          "The per-variant bun build artifacts were not produced distinctly " +
          "(a known flake when bun's baseline package fails to download). Refusing to ship.",
      )
    }
  }
  console.log(`variant check ok: ${pairs.length} native/baseline pairs are byte-distinct`)
}

async function writeSums(assetsDir: string) {
  const lines: string[] = []
  for (const name of expected) lines.push(`${await sha256File(path.join(assetsDir, name))}  ${name}`)
  const file = path.join(assetsDir, "SHA256SUMS.txt")
  await Bun.write(file, lines.join("\n") + "\n")
  console.log(`wrote SHA256SUMS.txt covering ${lines.length} CLI assets`)
  return file
}

const releaseIdx = process.argv.indexOf("--release")
const localIdx = process.argv.indexOf("--local")

if (releaseIdx >= 0) {
  const tag = process.argv[releaseIdx + 1]
  if (!tag) die("usage: cli-release-check.ts --release <tag>")
  const info = await $`gh release view ${tag} --repo ${repo} --json assets`.json()
  const names: string[] = (info.assets || []).map((asset: { name: string }) => asset.name)
  const missing = expected.filter((name) => !names.includes(name))
  if (missing.length) die(`release ${tag} is missing CLI assets: ${missing.join(", ")}`)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-cli-assets-"))
  try {
    // Per-asset download with retries via gh (authenticated). Must use gh and
    // not plain curl against the browser URL: this check runs while the
    // release is still a DRAFT, and draft asset URLs 404 without auth.
    for (const name of expected) {
      let ok = false
      for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
        ok =
          (
            await $`gh release download ${tag} --repo ${repo} --clobber --dir ${dir} --pattern ${name}`
              .nothrow()
              .quiet()
          ).exitCode === 0
        if (!ok) {
          console.log(`download ${name} failed (attempt ${attempt}/5), retrying...`)
          await Bun.sleep(attempt * 3000)
        }
      }
      if (!ok) die(`could not download release asset ${name} after 5 attempts`)
    }
    await checkVariants(dir)
    const sums = await writeSums(dir)
    if (skipUpload) {
      console.log(`dry run (--no-upload); sums would be:\n${await Bun.file(sums).text()}`)
    } else {
      await $`gh release upload ${tag} ${sums} --clobber --repo ${repo}`.quiet()
      console.log(`uploaded SHA256SUMS.txt to ${tag}`)
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
} else if (localIdx >= 0) {
  const dir = process.argv[localIdx + 1]
  if (!dir) die("usage: cli-release-check.ts --local <dist-dir>")
  const missing: string[] = []
  for (const name of expected) if (!(await Bun.file(path.join(dir, name)).exists())) missing.push(name)
  if (missing.length) die(`${dir} is missing CLI archives: ${missing.join(", ")}`)
  await checkVariants(dir)
  await writeSums(dir)
  console.log(`local CLI archives in ${dir} verified`)
} else {
  die("usage: cli-release-check.ts (--release <tag> | --local <dist-dir>) [--no-verify]")
}
