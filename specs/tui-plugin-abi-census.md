# TUI Plugin ABI Census

Sizes the Phase 2 compatibility shim for the `@prioricode/tui-core` engine
rewrite (see `plans/tui-engine-rewrite.md`). Recorded during Phase 0.

## Where plugins come from

| Source | Population | Evidence |
| --- | --- | --- |
| In-repo smoke plugin | 1 | `.prioricode/plugins/tui-smoke.tsx` |
| User-level plugins | 0 | `~/.config/prioricode/plugins/` does not exist on this machine (`~/.config/prioricode/` holds only `prioricode.jsonc` and `skills/`) |
| npm-published external plugins | unknown | The public API `@opencode-ai/plugin/tui` (`.prioricode/node_modules/@opencode-ai/plugin/dist/tui.d.ts`) is a real published contract; its consumer population is not enumerable from this repo |

Because the external population is unknown, the shim is mandatory rather than
optional (locked decision from the plan).

## ABI layers leaking OpenTUI

Layer A — plain data/state API (no OpenTUI types). Safe across engines.

Layer B — OpenTUI **types** in public signatures:

- `@opentui/core`: `CliRenderer`, `KeyEvent`, `Renderable`, `SlotMode`
  (re-exported verbatim from `@opencode-ai/plugin/dist/tui.d.ts`)
- `@opentui/keymap`: `Binding`, `Keymap`, `KeyLike`, `KeySequencePart`,
  `KeyStringifyInput`, `StringifyOptions`
- `@opentui/keymap/extras`: `BindingConfig`, `BindingLookup`, `BindingValue`,
  `CreateBindingLookupOptions`, `KeySequenceFormatPart`,
  `SequenceBindingLike`
- `@opentui/solid`: `JSX`, `SolidPlugin`; plugins declare
  `/** @jsxImportSource @opentui/solid */`

Layer C — OpenTUI **values** called or constructed by plugins:

- `@opencode-ai/plugin/tui` runtime exports: `stringifyKeySequence`,
  `stringifyKeyStroke` (`@opentui/keymap`), `formatCommandBindings`,
  `formatKeySequence` (`@opentui/keymap/extras`)
- `createBindingLookup()` factory typed against
  `BindingConfig<Renderable, KeyEvent>`
- `tui-smoke.tsx` uses `RGBA` (constructor) and `VignetteEffect`
  (renderer effect) from `@opentui/core`, plus `useTerminalDimensions`
  (`@opentui/solid`) and `useBindings`/`useKeymapSelector`
  (`@opentui/keymap/solid`)

## Host-internal plugin machinery

`frontend/tui/src/plugin/` (`runtime.tsx`, `api.ts`, `slots.tsx`,
`adapters.tsx`, `command-shim.ts`) wires plugin slots/routes/keymap into the
Solid app; it consumes Layer B/C types from the public contract, so it must be
re-targeted onto `tui-core` types together with the shim.

## Shim implications for Phase 2

1. `@prioricode/tui-core` must re-export names equivalent to the Layer B/C
   surface: `Renderable`, `KeyEvent`, `CliRenderer`, `SlotMode`, `RGBA`,
   `Keymap`, `Binding`, `BindingConfig`, `BindingLookup`, plus the four
   keymap stringification/formatting functions and `createBindingLookup`.
2. Solid JSX import source: external plugins compile against
   `@opentui/solid`'s JSX namespace. The shim either aliases that package to
   the new reconciler package (dual-mode JSX transform in the plan, Phase 7)
   or provides a compatibility package exporting the same `JSX` + hooks
   (`useTerminalDimensions`, `useBindings`, `useKeymapSelector`).
3. Layer C renderer effects (`VignetteEffect`) and renderer methods have no
   cheap re-export: the engine must implement behavior-compatible equivalents
   or the deprecated surface must keep delegating to a vendored OpenTUI
   renderer during the window.
4. Hooks with context coupling (`useRenderer`, `useKeymap`) resolve through
   the engine's Solid contexts; the shim must provide same-named contexts so
   third-party `.tsx` plugins mount unchanged.
5. Deprecation window: ship shim in the same release as the engine flip
   (`PRIORICODE_TUI_ENGINE` flag), warn on Layer C usage at load, remove only
   after the window closes — external plugin population being unknown makes
   the warn-log the discovery mechanism for real-world usage.

## Snapshot of known import surface (evidence)

```text
.prioricode/plugins/tui-smoke.tsx
  1: /** @jsxImportSource @opentui/solid */
  2: import { useTerminalDimensions, type JSX } from "@opentui/solid"
  3: import { useBindings, useKeymapSelector } from "@opentui/keymap/solid"
  4: import { RGBA, VignetteEffect, type KeyEvent, type Renderable } from "@opentui/core"
  5: import { createBindingLookup, type BindingConfig } from "@opentui/keymap/extras"
```
