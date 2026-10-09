// tui-core test/build preload: register the same universal Solid transform the
// production CLI uses, but emit runtime helpers into our own bridge package.
// golden.test.tsx is the cross-engine parity gate: its oracle tree must be
// compiled against real @opentui/solid, so helper imports from our module are
// redirected back to OpenTUI for exactly that file.
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"

ensureSolidTransformPlugin({
  moduleName: "@prioricode/tui-core/solid",
  resolvePath: (specifier: string, opts?: { filename?: string }) => {
    if (opts?.filename?.includes("golden.test") && specifier === "@prioricode/tui-core/solid") return "@opentui/solid"
    if (opts?.filename?.includes("golden.test") && specifier === "@prioricode/tui-core/solid/jsx-runtime")
      return "@opentui/solid/jsx-runtime"
    return specifier
  },
})
