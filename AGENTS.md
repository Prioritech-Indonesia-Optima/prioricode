# PrioriCode — Agent Guide

PrioriCode is an open source AI coding agent: a terminal UI (TUI), a web app, and a native
desktop app, all driven by one shared backend. It is a fork of
[OpenCode](https://github.com/anomalyco/opencode) and is built on **Bun**, **TypeScript**,
**Effect**, and **SolidJS**.

This file is the top-level guide. Package-specific rules live in nested `AGENTS.md` files —
**read the one in the directory you are editing before you change it.**

## Repository layout

| Path | What it is |
| --- | --- |
| `cli/` | The main `prioricode` package: core business logic, the headless API server, and the TUI. Where the app is wired together. |
| `backend/` | Shared backend packages (below). |
| `frontend/` | The user interfaces (below). |
| `cloud/` | Cloud services on SST: `console`, `stats`, `function`, `enterprise`, `infra`. |
| `integrations/` | `github`, `slack`, `vscode` integrations. |
| `docs/` | `mintlify` (docs-site source) and `web`. |
| `tooling/` | `containers`, `eval`, `nix`, `script`, `vm` — build/dev tooling. |
| `branding/` | Brand assets (source + generated). |
| `script/` | Repo-level scripts (release, generate, translate, brand, format). |
| `specs/` | Design specs and domain notes. |
| `plans/` | Working plans. |

### Backend packages (`backend/`)

A layered, Effect-based service stack. Dependencies flow downward; the public client is
generated from the server's `HttpApi`.

- `schema` — the lightweight Schema leaf. Shared public records (`Schema.Struct`); the single
  source of truth for values that mean the same thing internally and publicly. No Effect, no
  DB, no providers.
- `protocol` — composes Schema values into paths, payloads, envelopes, errors, cursors, and
  streams. Owns Session endpoint construction and middleware placement.
- `core` — the session runtime: System Context, Session History, compaction, the tool
  registry, and the Drizzle/SQLite database. The heart of the product.
- `llm` — provider-neutral LLM adapters and the model catalog.
- `server` — hosts Protocol's exact groups as the authoritative concrete `HttpApi`; owns
  protocol/domain adaptation and Location middleware.
- `client` — the generated network client. Root is zero-Effect (Promise); `/effect` depends on
  Effect + Schema + Protocol.
- `sdk` / `sdk-next` — the SDK and the scoped in-process "Embedded PrioriCode" host.
- `plugin` — the `@prioricode/plugin` API (v2 effect + promise).
- `codemode`, `tui-abi`, `slices`, `httpapi-codegen`, `http-recorder`, `effect-drizzle-sqlite`,
  `effect-sqlite-node` — supporting packages.

> The full domain language (System Context, Context Epoch, Session Drain, Provider Turn, etc.)
> is defined in `CONTEXT.md`. Read it before touching session/context/compaction code.

### Frontends (`frontend/`)

All frontends are SolidJS and consume the backend through the generated client.

- `gui` (`@prioricode/app`) — the shared web UI. The primary surface; most UI work happens here.
- `desktop` (`@prioricode/desktop`) — the Electron app that wraps `gui`. The renderer talks to
  main only via `window.api` (preload).
- `session-ui` — session/timeline UI components shared across surfaces.
- `ui` — the shared design-system component library.
- `tui` / `tui-core` — the terminal UI, written in SolidJS on [opentui](https://github.com/sst/opentui).
- `storybook` — component documentation and development.

## Development

Requirements: **Bun 1.3+**.

```bash
bun install          # install deps (postinstall fixes node-pty)
bun dev              # run the TUI (local equivalent of the built `prioricode`)
bun dev serve        # headless API server (port 4096)
bun dev web          # server + web interface
bun dev <directory>  # run the TUI against a specific directory
```

Dev servers (run from the repo root):

```bash
bun run dev:web        # frontend/gui web app
bun run dev:desktop    # frontend/desktop (Electron)
bun run dev:console    # cloud/console/app
bun run dev:stats      # cloud/stats
bun run dev:storybook  # frontend/storybook
```

To test UI changes, run the backend and the app dev server **separately** — `dev web` proxies
the hosted app, so local changes won't show there:

```bash
# terminal 1 (from cli/)
bun run ./src/index.ts serve --port 4096
# terminal 2 (from frontend/gui/)
bun dev -- --port 4444
# open http://localhost:4444 (targets the backend at http://localhost:4096)
```

**Regenerate the SDK** after changing the API or SDK surface (e.g. `cli/src/server/server.ts`,
any `HttpApi` route):

```bash
./script/generate.ts
```

**Database migrations** live in `backend/core` and are applied by core. Schema changes go
through `bun run migration` from `backend/core` and must be idempotent (cross-process migration
race). `bun dev` (channel `local`) must use the main `prioricode.db` so state is shared with
installed builds — see `cli/AGENTS.md`.

## Verification before shipping

A branch is merge-ready only when **all** of the following are green:

1. `bun run typecheck` — turbo, project references (uses `tsgo`).
2. `bun run lint` — oxlint (type-aware).
3. The test suite of **every package you touched** (table below).
4. i18n parity, if you changed user-visible copy (see Language support).

The repo root intentionally blocks `bun test` — always run tests **per package**, from that
package's directory.

| Package | Test command |
| --- | --- |
| `cli` | `bun test --timeout 30000 --only-failures` |
| `backend/core` | `bun test --only-failures` |
| `backend/llm` | `bun test --timeout 30000 --only-failures` |
| `backend/server` | `bun test` |
| `backend/client` | `bun test --timeout 5000` |
| `backend/sdk` | `bun test` |
| `backend/sdk-next` | `bun test --timeout 5000` |
| `backend/codemode` | `bun test` |
| `backend/tui-abi` | `bun test --timeout 30000` |
| `backend/httpapi-codegen` | `bun test --timeout 5000 --only-failures` |
| `backend/http-recorder` | `bun test --timeout 30000 --only-failures` |
| `backend/effect-drizzle-sqlite` | `bun test --timeout 30000 --only-failures` |
| `frontend/gui` | `bun run test` (unit + browser); `bun run test:e2e` (Playwright) |
| `frontend/session-ui` | `bun test src --only-failures` |
| `frontend/ui` | `bun test src --only-failures` |
| `frontend/tui` | `bun test --timeout 30000 --only-failures` |
| `frontend/tui-core` | `bun test --timeout 30000` |
| `cloud/function` | `bun test` |
| `tooling/eval` | `bun test` |

For `frontend/gui`, `bun run test` runs unit + browser suites; add `bun run test:e2e` for
end-to-end and `bun run test:stability` for performance/timeline checks. Before changing
session/timeline code, record a production benchmark baseline and compare it after the change.

## Code style

Follow the house style in `CONTRIBUTING.md`. The non-negotiables:

- **Effect** — `Effect.gen` for composition, `Effect.fn("Domain.method")` for named/traced
  effects, `Schema.Class` / `Schema.brand` / `Schema.TaggedErrorClass` for data and errors.
  Prefer yielding existing Effect services (`FileSystem`, `HttpClient`, `ChildProcessSpawner`,
  `Path`, `Clock`, `DateTime`) over raw platform APIs. Full rules: `cli/AGENTS.md` and the
  `effect` skill.
- **Module shape** — no `export namespace`. Use flat top-level exports plus a self-reexport
  (`export * as Foo from "./foo"`). No barrel `index.ts` in multi-sibling directories. Details:
  `cli/AGENTS.md`.
- **Types** — precise types; never `any`.
- **Immutability** — avoid `let`; prefer immutable patterns.
- **Control flow** — avoid `else`; prefer early returns.
- **Errors** — prefer `.catch(...)` over `try`/`catch` when possible.
- **Naming** — concise single-word identifiers when they stay descriptive.
- **Runtime** — use Bun helpers (`Bun.file()`, etc.) when they fit.
- **SolidJS** — prefer `createStore` over multiple `createSignal`.
- **Formatting** — Prettier: no semicolons, print width 120. Run `bun run script/format.ts`
  when needed.

## Language support (i18n)

- **Never hardcode user-visible English** in production code. Always use an i18n key for visible
  copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and
  displayed errors.
- **English is the read-only source of truth.** Never change existing English text or keys to
  make translation easier.
- Keep locale/grammar logic behind the shared typed i18n API (`language.t(...)`,
  `language.plural(...)`). Feature code must not inspect locales, call `Intl.PluralRules`, or
  assemble plural-category keys.
- If you add or change user-visible copy, add the English key and run
  `bun run translate:app -- all` (or the affected locales) before merge. The `frontend/gui` i18n
  parity tests enforce this.
- Do not translate from model knowledge alone — verify terminology against the corpora and
  language authorities listed in `frontend/gui/AGENTS.md`.

## Documentation

Keep docs in sync with code. If a change alters behavior, config, the API, or a workflow, update
the matching docs in the same change.

- `CONTEXT.md` — the domain glossary. Update it when you introduce or change a core concept.
- `specs/` — design specs. Read the relevant spec before implementing in that area; add one for
  net-new design.
- Per-package `README.md` — update when a package's usage or scripts change.
- `CONTRIBUTING.md` / `README.md` — update when the dev workflow or contribution rules change.
- Never hand-edit generated files (SDK output, generated types, brand assets). Regenerate them.

## Skills

Load the relevant skill before working in its area:

- `effect` — writing or migrating Effect v4 / effect-smol code.
- `context-compaction` — session compaction and context-window management.
- `rtl-aware-development` — any RTL/LTR behavior in web, desktop, CSS, menus, or the Electron
  title bar.

Design/branding skills (`design`, `ui-styling`, `ui-ux-pro-max`, `brand`, `banner-design`,
`slides`, `design-system`) are available for UI and visual work.

## Shipping & process

- All changes ship through `main`. Feature branches land via merge into `main` after
  verification; never publish releases, tags, or packaged artifacts straight from a feature
  branch.
- Desktop artifacts (AppImage/deb/dmg/nsis) are produced from `main` by CI; local packages are
  for verification only.
- Keep PRs small and focused. Every PR references an issue (`Fixes #123` / `Closes #123`).
- PR titles follow conventional commits, optionally scoped: `feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:` — e.g. `fix(desktop): resolve crash on startup`.
- Net-new UI/core features require a design review with the core team first — open an issue and
  wait for approval.
- Explain how you verified non-UI changes; include before/after screenshots or video for UI
  changes.
- No AI-generated walls of text in PRs or issues — short, focused, in your own words.

## Brand assets

- Never hand-edit generated brand files. Update `branding/source/2026-lockup.png` and run
  `bun run script/generate-brand.ts`.
