#!/usr/bin/env bun

import { Script } from "@prioricode/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()

if (!Script.preview) {
  // Best effort: the generated changelog needs the CLI + an API key. When
  // either is missing, fall back to a plain commit list.
  await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd()).nothrow()
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  let body = await Bun.file(file)
    .text()
    .catch(() => "")
  if (!body.trim()) {
    const tag = (await $`git tag --list 'v*' --sort=-v:refname`.text())
      .split(/\r?\n/)
      .map((x: string) => x.trim())
      .find((x: string) => /^v\d+\.\d+\.\d+$/.test(x))
    const range = tag ? `${tag}..HEAD` : "HEAD~20..HEAD"
    body = (await $`git log ${range} --pretty=format:'- %s'`.text()).trim() || "No notable changes"
  }
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/prioricode-release-notes.txt`
  await Bun.write(notesFile, body)
  // Idempotent: a draft from an earlier attempt of the same version is
  // re-targeted instead of failing the run.
  const exists = (await $`gh release view v${Script.version} --json tagName`.nothrow()).exitCode === 0
  if (exists) {
    await $`gh release edit v${Script.version} --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  } else {
    await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  }
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
