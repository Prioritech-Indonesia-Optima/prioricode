# Plan: prioriTUI — own the terminal engine + a clipboard that actually works

## Context

The user wants to stop renting the TUI from OpenTUI and **own the engine** — "proper handling this time and proper view and design" — because the current TUI has real defects: (1) a width-overflow bug that renders a status label **vertically, one char per line** (the screenshot), (2) an unresponsive feel (60 fps ceiling + per-frame full-cell animation math + ~60 fps streaming re-renders), and (3) a **remote-session clipboard-image paste that "never worked"** and is "seriously pissed"-inducing.

Decisions already made with the user:
- **Build our own TUI framework** (rejected the name "prioriTUI"; working package name `@prioricode/tui-core`, brand TBD).
- **Own the whole stack including raw I/O** (hand-roll the terminal input parser + a mandatory OSC channel).
- **Full multi-transport clipboard** (OSC 5522 + a companion for iTerm/Windows Terminal/VS Code/tmux + file-drop fallback).
- **Plan for a plugin-ABI shim** (external-plugin population unknown; enumerate it in Phase 0).
- **Do not hold 0.2.0 hostage** — everything ships behind a flag; 0.2.x stays on OpenTUI.

Key constraints discovered:
- The TUI is a **SolidJS app** (`frontend/tui/`, 169 files, ~30.7k lines) rendered onto OpenTUI `CliRenderer`. JSX is compiled by a Bun plugin running `babel-preset-solid` (`jsxImportSource: @opentui/solid`). Solid's reconciler is re-targeted so its "DOM nodes" ARE OpenTUI `BaseRenderable`s.
- The **state layer is framework-agnostic and reusable as-is**: `context/*` (SolidJS stores), the SDK boundary (`@prioricode/sdk/v2`), event bus, `config/*`, `theme/index.ts` (1108 lines of data), `util/*`, `prompt/*` logic. Only the `jsxImportSource`, the renderer lifecycle (`app.tsx`), the keymap, and the renderable usage are OpenTUI-coupled.
- **Two TUI surfaces**: the full app (`app.tsx` `run()`, targetFps 60) and the `run`/`--mini` split-footer (`cli/src/cli/cmd/run/`, `screenMode: "split-footer"`, targetFps 30). They are separate process invocations but share the keymap + config + plugin runtime.
- **The width-overflow root cause** is a flex-squeeze, not a miscalculated width: in `component/prompt/index.tsx:1648-1734` and `component/status-bar.tsx:70-121`, the status row is `flexGrow={1}` with all *variable* content pinned (`flexShrink={0}` / `wrapMode="none"`) and the *constant* hint as the only shrinkable child → squeezed to ~0 width → terminal wraps one char per line. `wrapMode="none"` is the dominant mode (77 uses vs 50 `word`).
- **The perf root cause**: `createCliRenderer({ targetFps: 60 })` (`app.tsx:204`); two `live` `FrameBufferRenderable`s do per-frame full-cell math (`component/bg-pulse-render.ts` 3-ring distance field over width×height; `component/home-hero-render.ts` ~710 cells) and even *mutate* `renderer.targetFps` on mount (`home-hero.tsx:84-94`); streaming re-renders at ~60 fps (16 ms event batches in `context/sdk.tsx:54-80`).
- **The clipboard "never worked" is three stacked gates** at `component/prompt/index.tsx:471-474`: `!terminalEnvironment.multiplexer` (vetoes tmux before the already-written DCS wrapper can help) + `terminal_clipboard_enabled` defaulting to `false` (opt-in) + `wrapForMultiplexer` (`clipboard-terminal.ts:53-55`) defined but **never applied to the read path**. It is also only tested against a **fake** terminal object (`test/clipboard-terminal.test.ts`), so real-world failures were never caught. OSC 5522 only works on kitty/wezterm/ghostty, not through tmux, and not on iTerm/Windows Terminal/VS Code.
- **The plugin ABI leaks OpenTUI directly**: TUI plugins import `@opentui/*` themselves (verified in the in-repo smoke plugin `.prioricode/plugins/tui-smoke.tsx:1-6`: `RGBA`/`VignetteEffect` from `@opentui/core`, `useTerminalDimensions` from `@opentui/solid`, `useBindings`/`createBindingLookup` from `@opentui/keymap/*`). A from-scratch swap breaks them. `@opentui/keymap` is otherwise a generic `Keymap<Renderable, KeyEvent>` engine (only 2 of 11 src files touch `@opentui/core`).
- **Build/runtime transform is dual-mode**: build-time (`cli/script/build.ts:57` `createSolidTransformPlugin()`) **and** runtime (external plugins loaded at runtime via `cli/src/plugin/tui/runtime.ts` → `ensureRuntimePluginSupport`). Both the transform, the `bunfig.toml` preloads, and the `tsconfig.json` `jsxImportSource` must flip in lockstep.
- **SolidJS is also the substrate of the web frontends** (gui, desktop, ui, session-ui) — keeping SolidJS reactivity keeps the repo consistent and keeps the `babel-preset-solid` pipeline (and the `patches/solid-js@1.9.10.patch`) reusable.

## Approach

Introduce a new framework package **`@prioricode/tui-core`** with six strictly-ordered layers (I/O → Layout → Text → Render → Primitives → Components) plus a **Solid bridge** (ported reconciler + jsx-runtime), a **re-targeted keymap**, and an **attachments (clipboard) subsystem**. The app (`@prioricode/tui`) and its `context/*` state layer are **untouched** — only the `jsxImportSource`, the renderer lifecycle, the keymap binding, and the renderable usage re-point. Everything ships behind a `PRIORICODE_TUI_ENGINE = "opentui" | "core"` flag so 0.2.x is never blocked and every cut-over is a one-env-var rollback.

Reuse the hard, known-good leaf libraries; hand-roll only what is actually broken or is the differentiator:

| Concern | Decision | Library / source |
|---|---|---|
| Flexbox math | **Reuse** | `yoga-layout` (WASM). App uses ~95% of flexbox (verified); OpenTUI proves it suffices. Fallback: hand-rolled constrained subset if the WASM artifact breaks the Bun single-binary build. |
| **Overflow-clamp + truncation invariant** (bug #1 fix) | **Hand-roll** | Post-layout pass: every box clamped to terminal bounds; `wrapMode="none"` text truncates to its allocated box, never spills. ~100-200 lines + `OverflowReport`. |
| Display width (EAW + ANSI) | **Reuse** | `string-width` (composes `get-east-asian-width` + `strip-ansi`). |
| Grapheme clustering | **Reuse** | `grapheme-splitter`. |
| Word/char wrap | **Reuse** | `wrap-ansi`. |
| ANSI strip / detect | **Reuse** | `strip-ansi` (already a dep), `ansi-regex`. |
| **Truncation (ellipsis) + SGR→attrs + cell grid** | **Hand-roll** | `wrap-ansi` doesn't truncate; the `Cell` grid is the `OptimizedBuffer` equivalent. |
| **Input parser (kitty/mouse/paste/OSC/DCS/resize)** | **Hand-roll** | The OSC-ingestion contract *is* the clipboard fix; must be owned + mandatory. ~500-900 lines, table-driven. |
| **Render loop (double-buffer, demand-driven, dirty-rect, opt-in animation)** (bug #2 fix) | **Hand-roll** | Replaces the `targetFps: 60` ceiling; 0 fps when idle. |
| **Output test oracle** | **Reuse** | `@xterm/headless` — feed our emitted escapes into a headless terminal, assert the cell grid. |
| Keymap engine | **Reuse / re-target** | `@opentui/keymap` (generic over `Renderable`/`KeyEvent`); port only if its addons are too coupled. |
| Reactivity + reconciler | **Reuse SolidJS + port the reconciler** | Port `@opentui/solid`'s reconciler (≈1-2k lines) to target our primitives. Keeps the 169 app files unchanged. |
| OSC 5522 state machine | **Reuse** | `createReadCollector`/`parseTerminalFrame` from `clipboard-terminal.ts` are correct; give them a mandatory `OscChannel`. |
| State layer, theme data, prompt logic, config | **Reuse as-is** | `context/*`, `theme/index.ts`, `prompt/*`, `util/*`, `config/*`. |

The three hardest parts (and their mitigations) are called out per-phase below: the Solid reconciler parity, the layout overflow invariant, and the demand-driven render loop.

## Phases

### Phase 0: Quick wins — ship the user-visible fixes now (independent of the rewrite)
- **Type:** fix
- **Files:** `frontend/tui/src/component/prompt/index.tsx`, `frontend/tui/src/component/status-bar.tsx`, `frontend/tui/src/clipboard-terminal.ts`, `frontend/tui/src/clipboard-scenario.ts`, `frontend/tui/test/clipboard-terminal.test.ts` (new real-PTY test), plus a new `frontend/tui/test/fixture/pty.ts`.
- **Changes:**
  - **Width-overflow (bug #1), current OpenTUI TUI:** in the prompt status row (`prompt/index.tsx:1648-1734`) and `status-bar.tsx`, pin the *constant* hint (`flexShrink={0}` + `wrapMode="none"`) and make the *variable* content the truncation target — compute a max width from `useTerminalDimensions()` and truncate the `turnHud` tool title and the retry message (currently truncated to a flat 80 chars at `:1682`) to fit. This is the exact inversion the new engine will make structural.
  - **Clipboard gates (bug #3):** (a) drop the `!terminalEnvironment.multiplexer` veto for terminals that support DCS passthrough (kitty/wezterm/ghostty with `allow-passthrough`); (b) apply `wrapForMultiplexer` to the OSC 5522/52 **read request** when `TMUX`/`STY` is set (it is currently defined but never called on the read path); (c) make it **on-by-default behind the silent `"."` targets probe** (no permission prompt, no stall) instead of `terminal_clipboard_enabled` defaulting to `false`.
  - **Real-PTY integration test:** add a `pty.ts` fixture that spawns a real PTY paired with an OSC 5522-speaking responder (and a tmux-in-the-loop negative test) so the protocol is tested against a real terminal, not a fake object. This is the #1 fix for "never worked."
  - **Plugin population census:** enumerate the real external TUI plugins (npm-published + `~/.config/prioricode/plugins/` + any registry) and record which use Layer B/C (renderer methods, `VignetteEffect`, OpenTUI JSX). Output: a short note in `specs/` that sizes the Phase 2 shim.
- **Dependencies:** none.
- **Success criterion:** No vertical text at 80/100/120 cols (screenshot repro gone). Remote Ctrl+V image paste works on kitty/wezterm/ghostty **including through tmux**, on by default, with no false permission prompt and no multi-second stall. The real-PTY test is green.
- **Verification:** `bun test --cwd frontend/tui --timeout 30000 test/clipboard-terminal.test.ts` and `bun test --cwd frontend/tui --timeout 30000` (full suite); `bunx tsgo --noEmit -p frontend/tui/tsconfig.json`.
- **Risk:** The OpenTUI flex-squeeze fix is a band-aid (the real fix is Phase 1's invariant). / **Mitigation:** it is explicitly a stopgap that ships value now and is superseded by the structural fix; keep it small and localized.

### Phase 1: `@prioricode/tui-core` foundation (no app change)
- **Type:** creation
- **Files:** new package `frontend/tui-core/` (`package.json`, `tsconfig.json`, `bunfig.toml`) with `src/{io,layout,text,render,primitives,components,solid,keymap,attachments}/` and `test/`. Public surface re-exported from `src/index.ts`.
- **Changes:**
  - **`io/` (hand-rolled, the owned I/O):** `Terminal` device owning raw mode, the input parser (kitty keyboard protocol incl. negotiation + legacy fallback, SGR/urxvt mouse, bracketed paste, focus, SIGWINCH + programmatic resize), and a **mandatory, non-optional `OscChannel`** (`on(code, h)`, `onDcs(h)`, `request(code, payload)`, `capability: { osc5522, osc52, dcs }` — "unsupported" is a *reported* state, never a silent drop). Ordered `InputChannel.use(handler)` middleware replaces `prependInputHandler`. Screen modes (`main-screen`/`alt-screen`/`split-footer`) + `externalOutputMode` (`passthrough`/`capture-stdout`) are config.
  - **`layout/`:** Yoga (WASM) flexbox + the **overflow-clamp + truncation invariant** post-pass with an `OverflowReport` (the bug #1 fix, made structural).
  - **`text/`:** `string-width`/`grapheme-splitter`/`wrap-ansi`/`strip-ansi`/`ansi-regex` composition + hand-rolled truncation (ellipsis), SGR→attrs mapper, and the `Cell` grid.
  - **`render/`:** double-buffered `CellGrid`, **demand-driven** frame scheduler (0 fps when idle, coalesces dirty marks into one repaint), dirty-rect `diff(prev)`, escape emitter, and **opt-in per-component animation** (`onFrame(cb)` at a capped fps; replaces `live` + the global `targetFps`/`maxFps` mutation).
  - **`primitives/`:** `Box`, `Text` (shrinkable-by-default, truncates), `Span`, `Input`, `Textarea`, `ScrollBox`, `Select` (+ `Code`/`Diff`/`Markdown` stubs or OpenTUI-backed per Phase 5 scope).
  - **`components/`:** `Dialog`, `Toast`, `Spinner`, `List`, `Prompt`, `Overlay` (the "proper view and design" surface — where the visual system lives).
  - **`solid/` (the bridge):** port `@opentui/solid`'s reconciler + `jsx-runtime` + hooks (`useRenderer`, `useTerminalDimensions`, `useKeyboard`, `Portal`, `extend`) targeting our primitives. Preserve the `text`/`content` prop-stringification interception. `jsxImportSource` for the framework = `@prioricode/tui-core/solid`.
  - **`keymap/`:** re-target `@opentui/keymap` to our `Renderable`/`KeyEvent` (port the engine only if the addons are too coupled).
  - **`attachments/`:** the transport interface + broker (Phase 5 lands the concrete transports; the interface + broker land here).
  - **Test harness:** `testRender`-equivalent + a **golden-buffer suite** (render identical JSX in both engines, diff cell output via the `@xterm/headless` oracle) + a **real-PTY** I/O test (key matrix, kitty, mouse, resize, suspend).
- **Dependencies:** none (Phase 0 is independent and may land in parallel).
- **Success criterion:** `tui-core` renders a static box/text/span tree **byte-identical** to OpenTUI for the same content; layout has **zero `OverflowReport` violations** at all widths (property test: "no box overflows for any width ≥ min-content"); **zero renders when idle** (frame-counter test); golden-buffer + real-PTY suites green.
- **Verification:** `bun test --cwd frontend/tui-core --timeout 30000`; `bunx tsgo --noEmit -p frontend/tui-core/tsconfig.json`.
- **Risk:** (a) Solid reconciler parity — a bug here breaks everything at once. / **Mitigation:** port (don't rewrite) `@opentui/solid`'s reconciler; the golden-buffer suite is the gate. (b) The hand-rolled input parser is the highest-risk new code. / **Mitigation:** the real-PTY + xterm-headless oracle is built *in this phase*, before any app cut-over. (c) Yoga WASM artifact in the Bun single-binary. / **Mitigation:** confirm the build in this phase; fall back to the hand-rolled constrained subset if it breaks.

### Phase 2: Plugin-ABI shim (protect external plugins before any cut-over)
- **Type:** creation
- **Files:** new `@prioricode/tui-abi` (or extend `backend/plugin/src/tui.ts`), `cli/src/plugin/tui/runtime.ts`, `.prioricode/plugins/tui-smoke.tsx` (regression), `specs/plugin-abi.md`.
- **Changes:** Introduce a **framework-neutral** plugin surface: a `Renderer` interface exposing only the methods plugins actually call (from the Phase 0 census: `addPostProcessFn`/`removePostProcessFn`, `setTerminalTitle`, dimensions, …), neutral `KeyEvent`/`Binding`/`Keymap`, a neutral `JSX` namespace, and a `Color` type. Ship an **OpenTUI-backed adapter** (proven against the real smoke plugin) and a **prioriTUI-backed adapter**; gate by a `tui_abi_version` the host advertises. A plugin built for the old ABI runs against the OpenTUI adapter until recompiled. The runtime plugin transform (`ensureRuntimePluginSupport`) must resolve both `@opentui/solid` and `@prioricode/tui-core/solid` during the overlap.
- **Dependencies:** Phase 1 (needs the prioriTUI types to back the new adapter).
- **Success criterion:** The real smoke plugin loads and runs unchanged against **both** adapters; a build test compiles a fixture through each transform mode; the external-plugin census is resolved (shim sized to the real population).
- **Verification:** `bun test --cwd cli --timeout 30000` (plugin-loader tests); `bunx tsgo --noEmit -p backend/plugin/tsconfig.json`.
- **Risk:** The Layer B/C leak (runtime `VignetteEffect`, `addPostProcessFn`) may be larger than the census suggests. / **Mitigation:** if the adapter surface is too large, give the prioriTUI `Renderer` an intentional OpenTUI-compatible method surface for the transition (removable after the deprecation window).

### Phase 3: Cut over prompt + status bar + home (first shippable slice)
- **Type:** modification
- **Files:** `frontend/tui/src/app.tsx` (engine flag + `tui-core` `Terminal`/`Renderer` wiring), `frontend/tui/src/component/prompt/index.tsx`, `frontend/tui/src/component/status-bar.tsx`, `frontend/tui/src/routes/home.tsx`, `frontend/tui/src/component/home-hero.tsx` (kill/cheapen the per-frame painter), `frontend/tui/tsconfig.json` + `bunfig.toml` (dual `jsxImportSource` resolvable).
- **Changes:** Render the **prompt + status bar** (shared by home and session; contains both bug sites) and the **home screen** via `tui-core` behind `PRIORICODE_TUI_ENGINE=core`. Remove/cheapen the `home-hero` per-frame full-cell painter (perf win). The Phase 0 band-aid becomes redundant (the invariant makes it structural). Flag off = today's OpenTUI, byte-for-byte.
- **Dependencies:** Phase 1, Phase 2.
- **Success criterion:** Home + prompt render via `tui-core` with the flag on; width-overflow is gone *structurally*; home is snappy (frame counter stays low — no per-frame hero math); **flag off reproduces current OpenTUI exactly** (regression suite green). This is the first production proof that a user feels.
- **Verification:** `bun test --cwd frontend/tui --timeout 30000`; manual: run the TUI with `PRIORICODE_TUI_ENGINE=core` and `=opentui`, confirm the prompt/status/home render correctly at 80/100/120 cols and the flag-off path is unchanged.
- **Risk:** Reconciler parity on the prompt (the most complex component: extmarks, autocomplete, parts). / **Mitigation:** the prompt is cut over *first* on purpose — it's the highest-value, highest-risk seam, so it's proven before the big session view; golden-buffer suite covers it.

### Phase 4: Cut over the session view (the big one + streaming perf)
- **Type:** modification
- **Files:** `frontend/tui/src/routes/session/index.tsx` (2744 lines), `routes/session/{permission,question,sidebar,subagent-footer,dialog-*}.tsx`, `frontend/tui/src/context/sdk.tsx` (streaming batch), `component/bg-pulse-render.ts` (opt-in animation).
- **Changes:** Render the streaming session view via `tui-core`. Batch/coalesce streaming updates + dirty-cell diff so only changed cells repaint (the real perf test). `bg-pulse` (retry dialog) becomes an opt-in `onFrame` animation scoped to its own sub-buffer (no global `targetFps` mutation).
- **Dependencies:** Phase 3.
- **Success criterion:** Session view renders via `tui-core`; streaming is smooth (frame counter stays low during a stream — no 60 fps jank); only changed cells are written (diff proven); long sessions don't degrade; permission/question cards + subagent footer + dialogs render correctly.
- **Verification:** `bun test --cwd frontend/tui --timeout 30000`; manual: stream a long response and a tool-heavy turn under `=core`, confirm no jank and correct rendering.
- **Risk:** The 2744-line session view has the most edge cases (scroll, revert, sticky-scroll, selection). / **Mitigation:** cut it over as its own phase with its own e2e; the scrollbox/selection primitives are proven in Phase 3.

### Phase 5: Cut over dialogs + sidebar + the attachments (clipboard) subsystem
- **Type:** modification + creation
- **Files:** `frontend/tui/src/ui/dialog*.tsx`, `component/dialog-*.tsx`, `routes/session/sidebar.tsx`, `frontend/tui-core/src/attachments/{transport,broker}.ts`, `frontend/tui/src/component/prompt/paste-store.ts`, `frontend/tui/src/clipboard-scenario.ts`, `frontend/tui/src/component/prompt/index.tsx` (paste command → broker), new `frontend/tui/src/attachments/companion.ts` (VS Code extension transport), real-PTY attachment tests.
- **Changes:**
  - Cut over the remaining dialogs + sidebar (stub `markdown`/`code` as wrapped text or keep them OpenTUI-backed behind the flag; keep the diff viewer on OpenTUI for now). Flag defaults to `core`.
  - **Attachments subsystem (the clipboard rebuild):** a framework-agnostic **broker** that orders transports by capability and returns the first that yields content. Transports: **`osc-5522`** (kitty/wezterm/ghostty; reuses `createReadCollector`/`parseTerminalFrame`, now fed by the **mandatory** `Terminal.osc` — no more silent no-op), **`companion`** (the VS Code extension, already referenced in `clipboard-scenario.ts:93` — the smallest high-value companion for iTerm/Windows Terminal/VS Code/tmux), **`file-drop`** (universal fallback: path → `Attachment`). **Capability probe is non-blocking and cached** (≤300 ms before fallback; no multi-second stall). The prompt's `prompt.paste` command calls the broker instead of the gated `readTerminalClipboard`.
- **Dependencies:** Phase 4.
- **Success criterion:** All screens render via `tui-core`; flag can default to `core`; full e2e suite green. Remote image paste works on kitty/wezterm/ghostty (incl. tmux) **and** via the VS Code companion on the other terminals; the real-PTY attachment tests (incl. a tmux negative test) are green; no multi-second stall on any terminal.
- **Verification:** `bun test --cwd frontend/tui --timeout 30000` (incl. the real-PTY attachment tests); `bun test --cwd frontend/tui-core --timeout 30000`; manual: paste an image from the local clipboard into a remote session on a kitty terminal and on a VS Code terminal.
- **Risk:** The companion transport is a new surface (auth/transport). / **Mitigation:** the VS Code extension reuses the existing `/tui/attach` channel; keep the clipboard-bytes discipline (images land in the `0700`/`0600` store, attached by path, user sees what's sent). **Do not ship a standing local loopback helper in v1** (highest-trust component; the remote TUI can't spawn on the client anyway) — defer it as a separately-reviewed security surface.

### Phase 6: Cut over the `run`/`--mini` split-footer (deferred, bespoke)
- **Type:** modification
- **Files:** `cli/src/cli/cmd/run/{runtime.lifecycle,footer,scrollback.*,splash,theme}.ts(x)`, `frontend/tui-core/src/io/screen-mode.ts` (the surface abstraction: append-only scrollback writer + footer cell grid).
- **Changes:** Port the split-footer surface to `tui-core`: in `split-footer` mode, `Terminal.output` exposes an append-only **scrollback** writer (routed to the real terminal's native scrollback) and a **footer** cell grid (the only repaintable region). `RunFooter` becomes an app component driving the footer grid through the same Solid bridge. Re-implement the `resetSplitFooterForReplay`/`writeToScrollback`/resize re-save lifecycle.
- **Dependencies:** Phase 5.
- **Success criterion:** `prioricode --mini` / `run` renders via `tui-core`; scrollback is immutable/append-only, the footer repaints correctly on resize; no dropped/duplicated scrollback lines.
- **Verification:** `bun test --cwd cli --timeout 30000`; manual: run `--mini`, stream output, resize, and confirm scrollback + footer behave.
- **Risk:** The split-footer is the most bespoke OpenTUI machinery (`screenMode: "split-footer"`, `externalOutputMode: "capture-stdout"`, `TreeSitterClient` scrollback highlighting) and the least user-visible. / **Mitigation:** it's deliberately last; if it's too costly, it can stay on OpenTUI behind the neutral keymap indefinitely without blocking the rest.

### Phase 7: Remove OpenTUI
- **Type:** modification
- **Files:** `frontend/tui/package.json`, `cli/package.json`, root `package.json` catalog, `cli/script/build.ts`, `frontend/tui/bunfig.toml`, `cli/bunfig.toml`, `frontend/tui/tsconfig.json`, `cli/tsconfig.json`, `patches/` (SolidJS patch only if SolidJS is dropped — it is **not**, so the patch stays), `backend/plugin/src/tui.ts` (drop the OpenTUI-backed adapter after the deprecation window).
- **Changes:** Drop the `@opentui/*` deps (and the 8 `libopentui` native binaries from the build matrix), the `@opentui/solid` preload, and flip the `jsxImportSource` default to `@prioricode/tui-core/solid`. Remove the OpenTUI-backed plugin adapter once the deprecation window closes.
- **Dependencies:** Phases 3-6 all cut over; the plugin deprecation window elapsed.
- **Success criterion:** No `@opentui/*` import remains in `frontend/tui` or `cli`; the build no longer fetches the OpenTUI native binaries; full e2e + typecheck green; external plugins run against the prioriTUI adapter.
- **Verification:** `rg "@opentui" frontend/tui/src cli/src` returns nothing; `bun test --cwd frontend/tui --timeout 30000` and `bun test --cwd cli --timeout 30000`; `bunx tsgo --noEmit` across the workspace; a full release build (`cli/script/build.ts`) succeeds for all targets.
- **Risk:** A missed `@opentui` reference or a plugin still on the old ABI. / **Mitigation:** the `rg` gate + the deprecation window; this is a 0.3.0 change, not a patch.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| External TUI plugin breakage (ABI leaks OpenTUI types + runtime `VignetteEffect`/`addPostProcessFn` + JSX) | High | Severe | Phase 2 shim (OpenTUI-backed adapter proven against the real smoke plugin) lands **before** any cut-over; version-gated; deprecation window. Phase 0 census sizes it. |
| Solid reconciler parity bug (breaks everything at once) | Med | High | Port `@opentui/solid`'s reconciler (don't rewrite); golden-buffer suite (identical JSX → identical cells via xterm-headless) is the gate for Phase 3. |
| Layout overflow invariant regressions (flexGrow/shrink/minWidth × `wrapMode="none"` × clamp) | Med | High | Dedicated layout suite with the exact `prompt/index.tsx:1648-1734` repro at multiple widths + property test ("no box overflows for any width ≥ min-content") + `OverflowReport` that fails tests on violation. |
| Demand-driven render loop correctness (flicker, missed cells, cursor across scroll/resize, split-footer) | Med | High | xterm-headless oracle as a frame-by-frame diff; streaming-flood test (repaint count scales with changed cells, not fps); the split-footer is isolated to Phase 6. |
| Hand-rolled input parser misses a terminal edge case (kitty/mouse/paste/tmux/Windows/resize) | High | High | Real-PTY integration matrix (kitty/wezterm/ghostty/xterm/Windows Terminal/WSL, ±tmux) built in Phase 1, before cut-over; reuse `string-width`/`Intl.Segmenter` for width/segmentation rather than reinventing. |
| Dual-mode JSX transform break (build + runtime plugin transform + bunfig + tsconfig must flip in lockstep) | Med-High | High | Keep SolidJS (reuses `babel-preset-solid`); change `moduleName`/`resolvePath`, not the transformer; a build test compiles a fixture through **each** transform mode; flip all knobs in one reviewed commit (Phase 7). |
| Clipboard "proper this time" re-introduces the fake-test blind spot | Med | Med-High | Real-PTY + real/emulated-terminal integration tests (incl. a tmux negative test) are a hard gate in Phase 0 and Phase 5; capability probe is non-blocking + cached (≤300 ms). |
| Split-footer port underestimation (bespoke OpenTUI machinery) | Med | Med | Deferred to Phase 6; can stay on OpenTUI behind the neutral keymap indefinitely without blocking the rest. |
| Yoga WASM artifact breaks the Bun single-binary build | Low | Med | Confirmed in Phase 1; fall back to the hand-rolled constrained flexbox subset (the app uses a bounded subset). |
| 0.2.0 held hostage | Low | High | Every cut-over is behind `PRIORICODE_TUI_ENGINE` (default `opentui`); 0.2.x ships entirely on OpenTUI; the default flips only at 0.3.0 after Phase 4 is stable. |

## Rollback
- Per-phase commits are natural rollback points.
- **Phases 3-6 (cut-overs):** a bad cut-over is a one-env-var rollback — set `PRIORICODE_TUI_ENGINE=opentui` (the flag-off path is byte-for-byte the current OpenTUI behavior, verified by the regression suite each phase).
- **Phase 7 (removal):** if it fails, `git reset --hard <pre-Phase-7-commit>` restores the OpenTUI deps + dual `jsxImportSource`; the plugin deprecation window means external plugins are unaffected until the window closes.
- **Phase 0 (quick wins):** independent of the rewrite; if the OpenTUI band-aid misbehaves, revert just that commit — it does not touch `tui-core`.

## Verification (End-to-End)
After all phases:
- `bun test --cwd frontend/tui-core --timeout 30000` (framework: golden-buffer, layout invariant, render-loop, real-PTY I/O, attachments).
- `bun test --cwd frontend/tui --timeout 30000` (app: full suite incl. real-PTY attachment tests).
- `bun test --cwd cli --timeout 30000` (CLI: plugin-loader, split-footer).
- `bunx tsgo --noEmit` across the workspace (typecheck).
- `rg "@opentui" frontend/tui/src cli/src` → empty (Phase 7 done).
- Full release build: `bun --cwd cli run build` (all 12 targets) succeeds with no OpenTUI native-binary fetch.
- **What "done" looks like:** (1) no vertical text at any terminal width — the overflow is structurally impossible (invariant + `OverflowReport`); (2) the TUI is snappy — 0 fps when idle, only changed cells repaint, no per-frame full-cell animation; (3) remote-session local-clipboard image paste **works** on kitty/wezterm/ghostty (incl. tmux) and via the VS Code companion on the rest, with no multi-second stall and no silent failure; (4) the engine is ours — `@prioricode/tui-core` owns I/O, layout, render, primitives, components, the Solid bridge, and the keymap, with the app's `context/*` state layer and the plugin ABI intact; (5) 0.2.x was never blocked — every cut-over shipped behind the flag.

## Appendix: Phase 0 empirical findings (measured, tmux 3.4 + util-linux script + Bun PTY)

- OSC 5522 read round-trip (encode → write → responder → collect) works over a
  real raw PTY; the state machine in `clipboard-terminal.ts` is correct — the
  historic failure was the three stacked gates + fake-terminal-only testing.
- tmux behavior matrix (`allow-passthrough on`, `escape-time 0`):
  - Pane output wrapped in DCS `ESC Ptmux; … ESC \` is forwarded **unwrapped**
    to the outer stream; unwrapped pane OSC is **eaten** by tmux. So
    `wrapForMultiplexer` on the write path is mandatory and sufficient for the
    request half.
  - Unknown OSC bytes written to the tmux client stdin (a terminal's reply)
    are relayed **verbatim into the pane input stream**, so the read collector
    receives responses without any wrapper handling.
  - Net: OSC 5522 reads through tmux work when the user config has
    `allow-passthrough on`; without it the read degrades to timeout + hint.
- Test-harness gotchas (baked into `test/fixture/`): the pane must `stty raw
  -echo` (OSC units carry no newline; canonical mode blocks forever); pane
  output emitted before `attach` exists is lost (attach replays the painted
  screen, not raw bytes) → gate readiness by polling with repeated probe
  requests, not a startup marker; tmux server env does not reliably inherit
  the booting client's env → embed variables in the pane command.
- Layout bug confirmed structurally: with `flexShrink=0` content at 78–79
  columns (80 terminal), the unpinned `esc interrupt` hint is squeezed to 1–2
  columns and wraps one character per line. Fix (pin hint + shrink/clip +
  dynamic truncate) is guarded at 80/100/120 in
  `test/cli/tui/status-row-overflow.test.tsx`.


## Appendix: execution progress log (2026-10-09)

- **Phase 0 — DONE, shipped** (commit b4368e9e). User-visible fixes: status-row overflow pin/truncate + `overflow` guards; clipboard default-on, protocol-terminal gated, DCS-wrapped for tmux; real-PTY + real-tmux integration tests; plugin census (`specs/tui-plugin-abi-census.md`); empirical tmux findings (above).
- **Phase 1 — DONE** (commits bb24659f/c7340785). `frontend/tui-core` (@prioricode/tui-core): hand-rolled input parser + OSC channel + Terminal device (raw mode via stty, kitty negotiation, SIGWINCH), Yoga-WASM layout with overflow-clamp invariant + OverflowReport, double-buffered cell renderer with demand-driven scheduler (idle 0fps test green) + post-process pipeline, Box/Text/Span/TextNode primitives matching OpenTUI borders/insets, universal Solid bridge (`solid-js/universal` + tui-core-local babel preload transform emitting into our runtime), layered keymap w/ leader chains, attachments interface + cascade broker. **Golden-buffer parity vs real OpenTUI** proven via subprocess oracle; 91 tests, tsgo clean.
- **Phase 2 — DONE** (commit c7340785). `backend/tui-abi` (@prioricode/tui-abi): neutral `EngineSurface` (renderer/keymap/color/vignette/binding-lookup/formatting) + `TUI_ABI_VERSION`. tui-core compat layer byte-matches OpenTUI's RGBA + `createBindingLookup.gather` semantics against the real packages in tests.
- **Phase 6 (clipboard transports) — ALREADY SHIPPED** in the current product: OSC5522 (+tmux) via Phase 0; VS Code companion (`integrations/vscode`, push `/tui/attach` → `tui.prompt.attach` event → prompt attach); local native clipboard; pasted-file-path attachments (`pasted-filepath.ts` + `local-attachment.ts`, tested). The engine-neutral broker for the cutover landed in tui-core Phase 1.
- **Phases 3-5, 7 (app cut-over + OpenTUI removal) — NOT STARTED.** Honest gap analysis: tui-core still lacks `Input`/`Textarea` (extmarks, selection, cursor), `ScrollBox`, `Select`, `Portal`/overlay+zIndex, mouse hit-testing, focus management, syntax-highlighted `Code`/`Diff`/`Markdown`, and the split-footer mode. The 170-file app migration is gated on those primitives. Recommendation: build primitives in vertical slices (each with OpenTUI cross-tests) on a flag-off default; the 0.2.x band-aids from Phase 0 remain the shipped UX meanwhile.
