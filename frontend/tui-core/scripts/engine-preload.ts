// PRIORICODE_TUI_ENGINE=core preload for running the OpenTUI-built app on
// tui-core: rewrites the app's engine imports (both the compiled JSX runtime
// and hand-written @opentui/* specifiers) onto the compat surface. Used as:
//   bun --preload ./frontend/tui-core/scripts/engine-preload.ts <app>
// The default production path never loads this file.
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const aliases: Record<string, string> = {
  "@opentui/solid": "@prioricode/tui-core/solid",
  "@opentui/solid/jsx-runtime": "@prioricode/tui-core/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime": "@prioricode/tui-core/solid/jsx-dev-runtime",
  "@opentui/core": "@prioricode/tui-core/compat/core",
  "@opentui/keymap": "@prioricode/tui-core/compat/keymap",
  "@opentui/keymap/extras": "@prioricode/tui-core/compat/keymap",
  "@opentui/keymap/solid": "@prioricode/tui-core/compat/keymap",
  "@opentui/keymap/opentui": "@prioricode/tui-core/compat/keymap",
  "@opentui/keymap/addons/opentui": "@prioricode/tui-core/compat/keymap",
}

if (process.env.PRIORICODE_TUI_ENGINE === "core") {
  ensureSolidTransformPlugin({
    moduleName: "@prioricode/tui-core/solid",
    resolvePath: (specifier: string) => aliases[specifier] ?? specifier,
  })
}
