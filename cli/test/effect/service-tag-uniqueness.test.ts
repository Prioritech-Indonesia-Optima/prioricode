import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { expect, test } from "bun:test"

// Service tags are runtime identity: two services registered under the same tag are the
// same service, so one layer silently shadows the other (see the 2026-10 "V2 suffix
// removal" regression where core Project/Skill/... collided with the legacy CLI services
// and broke the GUI/remote `directories` route). This test fails the suite whenever a
// static `Context.Service<...>()("tag")` registration is duplicated across packages.
const REPO_ROOT = path.resolve(import.meta.dir, "../../..")
const SCAN_DIRS = ["backend", "cli", "frontend", "cloud", "integrations", "tooling"]
const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build", ".git", ".bun", "vendor", "artifacts", "coverage"])

const sourceFiles = () => {
  const files: string[] = []
  const walk = (dir: string) => {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue
      const full = path.join(dir, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      if (
        (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
        new RegExp(`(^|/)src/`).test(full.replace(REPO_ROOT, ""))
      ) {
        files.push(full)
      }
    }
  }
  for (const dir of SCAN_DIRS) walk(path.join(REPO_ROOT, dir))
  return files
}

// Yields every static string-literal tag from `Context.Service<...>()("tag")`,
// handling nested generics and multi-line declarations.
const tagsIn = (text: string): Array<{ tag: string; line: number }> => {
  const found: Array<{ tag: string; line: number }> = []
  const needle = "Context.Service"
  let from = 0
  while (true) {
    const start = text.indexOf(needle, from)
    if (start === -1) break
    let i = start + needle.length
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] !== "<") {
      from = start + needle.length
      continue
    }
    let depth = 0
    let j = i
    for (; j < text.length; j++) {
      if (text[j] === "<") depth++
      else if (text[j] === ">") {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) {
      from = start + needle.length
      continue
    }
    let k = j + 1
    while (k < text.length && /\s/.test(text[k])) k++
    if (text.slice(k, k + 2) !== "()") {
      from = start + needle.length
      continue
    }
    k += 2
    while (k < text.length && /\s/.test(text[k])) k++
    if (text[k] !== "(") {
      from = start + needle.length
      continue
    }
    k++
    while (k < text.length && /\s/.test(text[k])) k++
    const quote = text[k]
    if (quote !== '"' && quote !== "'") {
      from = start + needle.length
      continue
    }
    const end = text.indexOf(quote, k + 1)
    if (end === -1) break
    found.push({ tag: text.slice(k + 1, end), line: text.slice(0, start).split("\n").length })
    from = start + needle.length
  }
  return found
}

test("every Context.Service tag is unique across the monorepo", () => {
  const files = sourceFiles()
  expect(files.length).toBeGreaterThan(500)

  const byTag = new Map<string, string[]>()
  for (const file of files) {
    for (const { tag, line } of tagsIn(readFileSync(file, "utf8"))) {
      const location = `${path.relative(REPO_ROOT, file)}:${line}`
      const locations = byTag.get(tag) ?? []
      locations.push(location)
      byTag.set(tag, locations)
    }
  }

  // Sanity: the scan must have found the real fleet of services, not zero due to a
  // broken glob (which would let future collisions pass silently).
  expect(byTag.size).toBeGreaterThan(100)

  const duplicates = [...byTag].filter(([, locations]) => locations.length > 1)
  expect(duplicates.map(([tag, locations]) => `${tag}:\n  ${locations.join("\n  ")}`)).toEqual([])
})
