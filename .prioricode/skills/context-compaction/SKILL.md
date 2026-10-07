---
name: context-compaction
description: Work with PrioriCode's session compaction — the fit-or-shrink planner, overflow recovery, config surface, and the two runtime paths (V2 core + V1 CLI). Use when changing, debugging, or explaining how a session stays inside the model context window.
---

# Context Compaction

Compaction keeps a long session inside the model window by summarizing old turns into a durable checkpoint while preserving a verbatim recent tail. There are two runtime paths that must stay behaviorally consistent.

## The Two Paths

- **V2 core** — `backend/core/src/session/compaction.ts`. Pure `plan()` + `decide()` + `make()`. Driven by the runner in `backend/core/src/session/runner/llm.ts` (per-drain budget, `contextLimit(model)`).
- **V1 CLI** — `cli/src/session/compaction.ts` (`process`, `select`, `shrinkHeadToFit`) + `cli/src/session/overflow.ts` (`effectiveContext`, `usable`, `triggerPoint`, `isOverflow`). The native config is lowered to V1 by `cli/src/config/v2-compat.ts`.

## Config Surface (V2-native, `prioricode.json`)

| Key | Default | Meaning |
| --- | --- | --- |
| `compaction.auto` | `true` | summarize near the context limit |
| `compaction.keep.tokens` | `8000` | verbatim tail budget in tokens (legacy `preserve_recent_tokens`) |
| `compaction.keep.turns` | — | verbatim tail budget in turns (legacy `tail_turns`) |
| `compaction.buffer` | `20000` | headroom reserved for output + summary (legacy `reserved`) |
| `compaction.threshold` | — | percent trigger 1–100; overrides the buffer math |
| `compaction.default_context` | `128000` | fallback window for models without a declared limit; `0` disables compaction for them |
| `prune.*` | `70` / `15` / `8000` | top-level pressure-gated tool-output elision (`pressure_percent`, `keep_recent_steps`, `min_bytes`) — **not** part of `compaction` |

Trigger: `threshold` set → `floor(context * min(threshold,100) / 100)`; otherwise `context - max(output, buffer)`.

## The Fit-or-Shrink Algorithm

The summary request itself must fit the window. `plan()` is pure and terminating:

1. Split entries into a head (to summarize) and a verbatim tail, honoring `keep.tokens` and `keep.turns` (turn cap breaks at a user message, then trims leading assistant messages so the tail is whole turns).
2. Cap the tail to the window (`context - summaryOutput - CHECKPOINT_OVERHEAD`): oldest tail items reduce to a marker first, then the newest is hard-truncated.
3. Shrink the head in priority order until the prompt fits `context - summaryOutput - PROMPT_MARGIN`:
   - drop the oldest complete turn (counted in `droppedTokens`),
   - truncate the prior recent context by a quarter per step,
   - hard-truncate the prior summary,
   - otherwise return an explainable `window-too-small`.

`SUMMARY_OUTPUT_TOKENS = 4096`, `CHECKPOINT_OVERHEAD = 64`, `PROMPT_MARGIN = 256`. The V1 CLI mirrors this in `shrinkHeadToFit` (drop oldest turns, then hard-truncate the head) so an oversized session compacts instead of stalling on a summary request that does not fit.

## Invariants (do not break)

- **One-shot overflow recovery.** A provider overflow before durable output triggers at most one overflow compaction; a second overflow, or overflow after durable output, is the ordinary terminal failure. Recovery never loops or replays partial side effects.
- **Bounded per drain.** V2 caps automatic compactions per drain (`MAX_AUTO_COMPACTIONS_PER_DRAIN = 3` in the runner) so a pathological session cannot loop.
- **Durable history preserved.** Compaction replaces the active model representation with a checkpoint; the full transcript stays durable. Only a completed `session.next.compaction.ended` projects a model-visible compaction message.
- **Explainable decisions.** Each attempt records a `CompactionDecision` (trigger, window source, estimated size, limit, fallback) and outcome on the durable compaction events.
- **Model-switch behavior.** The model is sampled per turn; compaction uses the current model's window via `resolveContext` (declared limit wins, else `default_context`). Model/agent switches do **not** force a new baseline or discard earlier chronological System Context updates.

## Changing It

- Pure planner logic: unit-test in `backend/core/test/session-compaction-plan.test.ts` (no services).
- Runner/overflow behavior: `backend/core/test/session-runner.test.ts`, `session-compact-manual.test.ts`; V1 in `cli/test/session/compaction.test.ts` + `overflow.test.ts`.
- Config schema changes: update `backend/core/src/config/compaction.ts`, the V1↔V2 bridges (`backend/core/src/v1/config/migrate.ts`, `cli/src/config/v2-compat.ts`), and their fixtures/tests.
- Durable event schema: optional fields only (old rows must still decode); regenerate `backend/client/src/generated/types.ts` and `backend/sdk/src/v2/gen/types.gen.ts`.
- Docs: `docs/mintlify/reference/config.mdx`, `using/context.mdx`, `reference/environment-variables.mdx`, and `specs/v2/{session,config}.md` must match source in the same commit.
