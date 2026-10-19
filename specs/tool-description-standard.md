# Tool Description Standard (3W1H + Acceptable Inputs)

Every model-facing tool description in both runtimes (V1 `cli/src/tool/*.txt`, V2 inline in
`backend/core/src/tool/*.ts`) answers four questions, in this order:

1. **Is** — first line: what the tool does and what it returns.
2. **When** — the trigger that should invoke it _and_ the sibling tool to prefer otherwise
   ("not for needle lookups — read a known path"). Tools with modes carry per-action triggers.
3. **How** — mechanics the model cannot guess: argument shapes, batching, paging, ordering,
   output format, and hard limits.
4. **Why** — one clause, only when the rule isn't self-evident: the failure the discipline
   prevents (e.g. rewriting a todo list drops unfinished work; guessing URLs fabricates links).

Labels are guidance, not required text — `Actions:` / `Usage:` / bulleted prose all satisfy
the standard; coverage is what matters.

## Acceptable inputs

Every non-trivial input field's annotate description states the acceptable values, not just
the intent: enums list their options and the default (`"markdown (default) | text | html"`),
ranges state units and bounds (`"milliseconds; default 120000, max 900000"`), formats show a
literal example (`"glob like \"*.js\" or \"*.{ts,tsx}\""`), and path fields say which forms are
accepted (absolute vs relative-to-Location) because that differs per runtime.

## Parity

- Tools whose contract is runtime-identical (`question`, `task`, `webfetch`, `skill`,
  `todowrite`, `plan_enter`/`plan_exit`, `websearch`) use byte-identical text;
  `cli/test/tool/description-parity.test.ts` pins each pair (text after trim; websearch
  compares with the interpolated year normalized).
- Tools whose contract genuinely differs per runtime (`read`, `glob`, `grep`, `write`, `edit`,
  `apply_patch`, `bash`) keep runtime-accurate content but follow the same skeleton — a shared
  string would misdescribe one side, and a wrong prompt is worse than a divergent one.
- When a runtime contract changes, the description on that side is part of the change; when
  guidance changes, edit both sides and run the parity test.

## Size budget

Descriptions stay terse: a tool description earns length only by preventing mistakes the model
actually makes. No tool description may grow without evidence of misuse.
