import { Effect } from "effect"
import * as path from "path"
import { FileAttribution } from "./file-attribution"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import type { InstanceContext } from "../project/instance-context"

/**
 * Attribution advisory for repo-wide git commands (`status`, `add`, `commit`,
 * `push`, `stash`). When the working tree carries paths this session did not
 * author, the tool output names their owners from the durable touch ledger and
 * states the ship rule — attribute first, ask the owning peer (sessions query)
 * or the user, and never silently narrow a ship to "only mine". Advisory only:
 * it never blocks, and a direct user instruction to ship overrides the rule.
 *
 * Solo projects pay nothing: the gate is one sibling-list lookup, skipped unless
 * a recently active peer session exists to coordinate with. Classification is
 * bounded (`PATH_CAP`) so giant dirty trees cost a single bounded stat batch.
 */

const GIT_SUBS = new Set(["status", "add", "commit", "push", "stash"])
const LISTED_CAP = 20
const PATH_CAP = 50
const FRESH_PEER_MS = 24 * 60 * 60_000

export interface GitCommandShape {
  readonly tokens: ReadonlyArray<string>
  readonly text: string
}

export interface AdvisoryInput {
  readonly instance: InstanceContext
  readonly sessionID: SessionID
  readonly cwd: string
  readonly shapes: ReadonlyArray<GitCommandShape>
  readonly runGit: (dir: string, args: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>>
}

const agoLabel = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const matchGitCommand = (tokens: ReadonlyArray<string>): { sub: string; repoDir?: string } | undefined => {
  const head = tokens[0]?.toLowerCase()
  if (head !== "git" && !head?.endsWith("/git") && !head?.endsWith("\\git") && head !== "git.exe") return undefined
  let repoDir: string | undefined
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? ""
    if (token === "-C") {
      repoDir = tokens[++i]
      continue
    }
    if (token === "-c" || token === "--git-dir" || token === "--work-tree") {
      i++
      continue
    }
    if (token.startsWith("-")) continue
    return GIT_SUBS.has(token) ? { sub: token, ...(repoDir === undefined ? {} : { repoDir }) } : undefined
  }
  return undefined
}

/** Porcelain-v1 line -> path. Renames/copies report "old -> new"; the new side is the live path. */
export const porcelainPath = (line: string): string | undefined => {
  if (line.length < 4) return undefined
  const rest = line.slice(3)
  const arrow = rest.indexOf(" -> ")
  const value = (arrow >= 0 ? rest.slice(arrow + 4) : rest).trim()
  return value === "" ? undefined : value
}

export const make = Effect.fn("ShellGitAdvisory.make")(function* () {
  const attribution = yield* FileAttribution.Service
  const sessions = yield* Session.Service
  const status = yield* SessionStatus.Service

  const advisory = Effect.fnUntraced(function* (input: AdvisoryInput) {
    if (input.instance.project.vcs !== "git") return [] as string[]
    const matches = input.shapes
      .map((shape) => ({ shape, match: matchGitCommand(shape.tokens) }))
      .filter(
        (item): item is { shape: GitCommandShape; match: { sub: string; repoDir?: string } } =>
          item.match !== undefined,
      )
    if (matches.length === 0) return [] as string[]

    const listed = yield* sessions.list({ limit: 50, roots: true })
    const siblings = listed.filter(
      (session) =>
        session.id !== input.sessionID &&
        session.projectID === input.instance.project.id &&
        !session.time.archived &&
        Date.now() - session.time.updated < FRESH_PEER_MS,
    )
    console.log("DEBUG advisory", {
      vcs: input.instance.project.vcs,
      subs: matches.map((m) => m.match.sub),
      siblings: siblings.map((s) => String(s.id)),
      self: String(input.sessionID),
    })

    const repoDir =
      matches[0]?.match.repoDir === undefined ? input.cwd : path.resolve(input.cwd, matches[0].match.repoDir)
    const roots = yield* input.runGit(repoDir, ["rev-parse", "--show-toplevel"])
    const root = roots[0]?.trim()
    if (root === undefined || root === "") return [] as string[]

    const foreign: FileAttribution.Attribution[] = []
    if (siblings.length > 0) {
      const dirty = yield* input.runGit(root, ["status", "--porcelain"])
      const paths = dirty
        .map(porcelainPath)
        .filter((item): item is string => item !== undefined)
        .slice(0, PATH_CAP)
      if (paths.length > 0) {
        const owned = yield* attribution.classify({
          projectID: input.instance.project.id,
          sessionID: String(input.sessionID),
          base: root,
          paths,
        })
        foreign.push(...owned.filter((item) => item.status !== "self"))
      }
    }

    const lines: string[] = []
    if (foreign.length > 0) {
      const titles = new Map(siblings.map((session) => [String(session.id), session.title]))
      const statusMap = yield* status.list()
      const now = Date.now()
      const rel = (item: FileAttribution.Attribution) => path.relative(root, item.path).replaceAll("\\", "/")
      const rank = (item: FileAttribution.Attribution) =>
        item.status === "unrecorded" ? 2 : item.status === "external" ? 1 : 0
      const describe = (item: FileAttribution.Attribution): string => {
        if (item.status === "unrecorded")
          return `  · ${rel(item)} — no attribution record (predates the ledger, unwatched writer, or reverted file)`
        const who =
          item.touch.sessionID === undefined
            ? `changed outside PrioriCode tools — the user's editor or a shell command (${agoLabel(now - item.touch.timeUpdated)})`
            : `peer ${item.touch.sessionID} "${titles.get(item.touch.sessionID) ?? "(unknown session)"}" (${
                statusMap.get(item.touch.sessionID as SessionID)?.type === "busy" ? "working now" : "idle"
              }, ${agoLabel(now - item.touch.timeUpdated)}, ${item.touch.op})`
        return `  · ${rel(item)} — ${who}`
      }
      const ordered = [...foreign].sort((a, b) => rank(a) - rank(b))
      const listed = ordered.slice(0, LISTED_CAP).map(describe)
      lines.push(
        "Working-tree paths NOT authored by your session (durable file-touch attribution):",
        ...listed,
        ...(ordered.length > listed.length ? [`  · (+${ordered.length - listed.length} more)`] : []),
        'Rule: before committing or staging, query the owning peer with the sessions tool (action "query", its session id as target) about whether its changes are finished and meant to ship; for unattributed paths ask the user — they likely edited them outside PrioriCode. Do not silently narrow a ship to your own subset, and do not commit a peer\'s work-in-progress without its OK. A direct user instruction to ship overrides this rule.',
      )
    }

    const commit = matches.find((item) => item.match.sub === "commit")
    if (commit !== undefined && !commit.shape.text.includes("PrioriCode-Session:")) {
      const mine = yield* attribution.classify({
        projectID: input.instance.project.id,
        sessionID: String(input.sessionID),
        base: root,
        paths: (yield* input.runGit(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "HEAD"]))
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .slice(0, PATH_CAP),
      })
      const authored = mine.filter((item) => item.status === "self").slice(0, 5)
      if (authored.length > 0) {
        lines.push(
          `Commit provenance: this commit lands lines your session wrote (${authored
            .map((item) => path.relative(root, item.path).replaceAll("\\", "/"))
            .join(
              ", ",
            )}). Add a \`PrioriCode-Session: ${String(input.sessionID)}\` trailer so git blame resolves those lines back to your session.`,
        )
      }
    }
    return lines
  })

  return { advisory }
})

export * as ShellGitAdvisory from "./shell-git-advisory"
