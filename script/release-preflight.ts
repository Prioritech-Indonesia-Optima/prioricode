#!/usr/bin/env bun
// Local release preflight: run the exact CI `build-cli` path without touching
// GitHub, so "green here" means "green on Actions".
//
//   bun run script/release-preflight.ts
//
// Mirrors publish.yml build-cli:
//   1. PRIORICODE_RELEASE=1 ./packages/prioricode/script/build.ts --no-upload
//      (cross-builds all 12 CLI targets, zips/tars them, and runs
//      cli-release-check --local: baseline/AVX2 byte-distinctness + SHA256SUMS)
//   2. ./packages/cli/script/build.ts
//
// On success everything built is deleted again (dist trees are hundreds of MB
// and gitignored — leaving them around just bloats disk). On failure the dirt
// is kept for debugging and the exit code is passed through.
//
// Requires the same host bun as CI: a non-baseline x64 bun (bun install from
// the default release asset). A baseline host bun silently embeds itself for
// --target=bun-linux-x64 and the distinctness check will fail — same as CI.

import { $ } from "bun"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const dirt = ["packages/prioricode/dist", "packages/app/dist", "packages/cli/dist"]

function clean() {
  for (const dir of dirt) {
    console.log(`cleaning ${dir}`)
  }
  // rm -rf via shell keeps this a one-liner and matches gitignore entries
  Bun.spawnSync(["rm", "-rf", ...dirt.map((d) => `${root}/${d}`)])
}

const version = (await $`git tag --list "v*" --sort=-v:refname`.cwd(root).text())
  .split("\n")
  .map((line) => line.trim())
  .find((line) => /^v\d+\.\d+\.\d+$/.test(line))
  ?.slice(1)
const preflightVersion = version ? `${version}-preflight` : "0.0.0-preflight"
console.log(`release preflight as version ${preflightVersion}`)

const cli =
  await $`PRIORICODE_VERSION=${preflightVersion} PRIORICODE_RELEASE=1 ./packages/prioricode/script/build.ts --no-upload`
    .cwd(root)
    .env(process.env)
    .nothrow()
if (cli.exitCode !== 0) {
  console.error("CLI build failed — dist trees kept for debugging")
  process.exit(cli.exitCode)
}

const lildax = await $`PRIORICODE_VERSION=${preflightVersion} ./packages/cli/script/build.ts`
  .cwd(root)
  .env(process.env)
  .nothrow()
if (lildax.exitCode !== 0) {
  console.error("cli (lildax) build failed — dist trees kept for debugging")
  process.exit(lildax.exitCode)
}

// Warn (never block) if the manually-synced installer copies on
// code.prioritech.co.id lag behind the latest release tag. Upgrades fetch the
// tag-pinned installer from GitHub and are unaffected; fresh installs via the
// documented curl/irm one-liners are the ones that get a stale script.
const drift = await $`bun run script/installer-drift-check.ts`.cwd(root).env(process.env).nothrow()
if (drift.exitCode !== 0) {
  console.warn(`WARN: installer drift check failed (exit ${drift.exitCode}) — the static host may be serving a stale install/install.ps1`)
}

clean()
console.log("release preflight passed: all targets built, baseline/AVX2 distinct, dirt cleaned")
