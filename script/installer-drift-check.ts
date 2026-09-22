#!/usr/bin/env bun
// Compares the installer scripts served from code.prioritech.co.id (used by the
// documented install/upgrade one-liners) against the versions published in the
// latest release tag. The domain copy is synced manually — its deploy workflow
// is gated on a repo variable that is unset, so pushes to main do NOT refresh
// it. This guard exists because in September 2026 the domain served a stale
// pre-fix installer for days: every repo-side Windows upgrade fix merged and
// shipped, while users kept downloading the broken script and experiencing the
// "already fixed" failure again.
//
//   bun run script/installer-drift-check.ts
//
// Exit 0: in sync (or domain unreachable — reported as a warning, the check
// itself is not a CDN outage). Exit 1: drift — the static host must be
// re-synced from the tag before anything else ships.

const repo = "Prioritech-Indonesia-Optima/prioricode"

const version = (await Bun.spawn(["git", "tag", "--list", "v*", "--sort=-v:refname"], { cwd: import.meta.dir + "/.." })
  .stdout.text())
  .split("\n")
  .map((line) => line.trim())
  .find((line) => /^v\d+\.\d+\.\d+$/.test(line))
  ?.slice(1)

if (!version) {
  console.error("no vX.Y.Z tag found")
  process.exit(1)
}
console.log(`checking domain against ${version}`)

let drifted = 0
for (const file of ["install", "install.ps1"]) {
  const tagRes = await fetch(`https://raw.githubusercontent.com/${repo}/v${version}/${file}`)
  if (!tagRes.ok) {
    console.error(`FAIL: cannot fetch tagged ${file} (HTTP ${tagRes.status})`)
    drifted++
    continue
  }
  const tagged = await tagRes.text()
  let served: string | undefined
  try {
    const res = await fetch(`https://code.prioritech.co.id/${file}`, { cache: "no-store" })
    served = res.ok ? await res.text() : undefined
  } catch {}
  if (served === undefined) {
    console.warn(`WARN: code.prioritech.co.id/${file} unreachable — could not verify (not treated as drift)`)
    continue
  }
  if (served.trim() !== tagged.trim()) {
    console.error(
      `DRIFT: https://code.prioritech.co.id/${file} does not match ${version}/${file}. ` +
        "Users following the install/upgrade one-liners get the stale script. Re-sync the static host from the tag.",
    )
    drifted++
  } else {
    console.log(`in sync: ${file}`)
  }
}

if (drifted > 0) {
  console.error(`installer drift detected: ${drifted} file(s) out of sync with ${version}`)
  process.exit(1)
}
console.log(`installer domain check passed against ${version}`)
