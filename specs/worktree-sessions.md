# Session worktrees: isolated writes, coordinated merges

Status: design for the next release. Builds on facts verified at `f30cd2942` (v0.3.10).

## Problem

Concurrent sessions sharing one working tree trample each other: interleaved
uncommitted edits, stash-pop damage, verification noise ("is this failure mine?"),
and agents refusing to ship foreign changes. Today each session hand-rolled a
worktree per convention; the machinery half-exists but is not session-scoped.

## Target model

1. **Each writing session gets its own worktree + branch, automatically.**
2. **Peers stay visible and coordinate via the existing channel** (already true:
   one Project row per git repo, roster/coordination keyed by `projectID`).
3. **Landing is a first-class, coordinated merge** — conflicts are negotiated
   agent-to-agent with the file-touch ledger as evidence, not guessed.

## What already exists (do not rebuild)

- `cli/src/worktree/index.ts`: managed create/list/remove/reset under
  `<data>/worktree/<projectID>/*`, detached boot, start-scripts, `worktree.ready/failed`
  events; HTTP `/experimental/worktree` + SDK `client.worktree.*`; GUI create-worktree-on-new-session;
  TUI warp/move.
- Instance-per-directory (`InstanceState`/`InstanceStore`), per-worktree snapshot/
  watcher/collision, shared WAL SQLite.
- Coordination: `query`/`respond`/`broadcast`, auto-announce, per-note traceability,
  `/coordination` ledger view.
- Attribution: `session_file_touch` ledger (session/op/model/diff-pointers), external
  watcher rows, `query paths=[…]`, collision last-writer notices, shell git advisory,
  `PrioriCode-Session:` trailer convention.

## Gaps and design

### 1. Session-scoped worktree (the "auto")

- New column `session.worktree_mode` (`shared | isolated`, default from config
  `worktree.isolateSessions`, initially **off** = today's behavior).
- `session.create` / first _write_ tool call on a shared-directory session with
  isolation on: call the existing Worktree.create (name = session slug), bind
  `session.directory := new worktree`, emit the same synthetic system-reminder the
  TUI warp flow uses. One `sessionID ↔ worktree` binding — the worktree is just
  the session's directory; all existing per-directory machinery then "just works".
- Provisioning: run `commands.start` (extend project config with optional
  `commands.install`, e.g. `bun install`); surface `worktree.installing` before
  `worktree.ready`. Worktree GC: `Remove` on session archive + `worktree.reset`
  reuse-by-name keeps disk bounded.
- CLI: `prioricode --isolate-worktree` (per-invocation opt-in before default flips).

### 2. Land command (the "merge it after")

- New `worktree.land` (service + httpapi + SDK):
  fetch → rebase-or-merge base → detect conflicts → **stop and report**, or complete
  with a merge commit carrying the session trailer. Never pushes; pushing stays
  agent/user action.
- Pre-flight conflict intelligence: compute `merge-tree` conflicts; for each
  colliding file query the touch ledger (`lookup`, repo-relative match per worktree)
  to name which sessions authored the colliding sides.

### 3. Conflict → coordination protocol (the "win-win")

Not silent auto-resolution. The feature makes conflicts _self-driving toward
negotiation_ exactly like the manual flow that shipped v0.3.10:

- `land` blocked by a conflict whose other side belongs to an **unlanded peer
  branch** → post the asking session a `request` ("I need to land; our branches
  collide on <files>; your move?") via the existing channel — the peer's owner
  answers with its intent (land first / rebase yours / merge strategy / split).
- Both-landed conflicts (base moved) → the landing agent is instructed by tool
  output to resolve semantically: re-run each side's intent, never pick-a-side
  blindly; advisory lists both diffs' message pointers.
- Broadcast stays the courtesy gate for shared-history moves.
- Escalation to the human already exists for unanswered queries.

### 4. Attribution across worktrees

Ledger keys absolute paths ⇒ per-worktree rows are separate by design. For land-time
questions add `FileTouch.recent({ withinMs })`-style **repo-relative** lookup per
project so "who touched this repo path anywhere" answers across worktrees. The
commit trailer then carries line-level truth into merged history permanently.

## Defaults & rollout

1. Land feature-flagged (off). 2. Enable for GUI new-session-in-worktree (already exists)
   - CLI flag. 3. Flip `isolateSessions` default-on after one release of dogfooding.
     The shell advisory + "never silently narrow a ship" rule stays — it covers shared
     trees and the human's editor either way.

## Non-goals

- No auto-push, no auto-resolve of semantic conflicts, no DB-per-worktree,
  no long-lived branch strategy UI (git remains the merge arbiter).
