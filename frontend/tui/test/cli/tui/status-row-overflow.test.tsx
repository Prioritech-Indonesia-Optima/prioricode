// Guards the flex mechanics behind the busy-status-row width fix: a pinned
// (flexShrink=0, wrapMode=none) constant hint must survive a long variable
// middle child when the middle box is the shrinkable, clipped one. The old
// row had every variable child flexShrink=0, so the only shrinkable element
// was the "esc interrupt" hint itself — squeezed to ~0 width it wrapped one
// character per line (the reported vertical-text bug).
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Locale } from "../../../src/util/locale"

const HINT = "esc interrupt"
const LONG_MESSAGE =
  'API Error: 429 data: {"error":{"message":"This model\'s maximum context length is 200000 tokens. Please reduce the length of the messages.","type":"invalid_request_error"}}'

function StatusRow(props: { width: number }) {
  const hintWidth = () => 13
  const contentWidth = () => Math.max(24, props.width - hintWidth() - 10)
  const capped = () => Math.min(80, Math.max(24, contentWidth() - 40))
  const message = () => (LONG_MESSAGE.length > capped() ? LONG_MESSAGE.slice(0, capped()) + "…" : LONG_MESSAGE)
  return (
    <box flexDirection="row" width={props.width}>
      <box minWidth={0} flexShrink={1} flexDirection="row" gap={1} overflow="hidden">
        <box flexShrink={0} marginLeft={1}>
          <text wrapMode="none">[⋯]</text>
        </box>
        <box flexDirection="row" minWidth={0} flexShrink={1}>
          <text wrapMode="none">
            {Locale.truncateMiddle("tool-name-that-is-quite-long-1234567890", Math.max(12, contentWidth() - 10))}
          </text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text wrapMode="none">{message()}</text>
        </box>
      </box>
      <text flexShrink={0} wrapMode="none">
        {HINT}
      </text>
    </box>
  )
}

for (const width of [80, 100, 120]) {
  test(`status row keeps the interrupt hint on one line at ${width} cols`, async () => {
    const app = await testRender(() => <StatusRow width={width} />, { width, height: 5 })
    try {
      await Bun.sleep(50)
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(lines.some((line) => line.includes(HINT))).toBe(true)
      // vertical-text regression signature: isolated single characters
      expect(lines.some((line) => line.trim() === "i" || line.trim() === "t")).toBe(false)
      expect(lines.some((line) => line.includes(LONG_MESSAGE))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })
}

test("the old unbounded structure reproduces the vertical hint", async () => {
  const app = await testRender(
    () => (
      <box flexDirection="row" width={80}>
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text wrapMode="none">{LONG_MESSAGE.slice(0, 79)}</text>
        </box>
        <text>{HINT}</text>
      </box>
    ),
    { width: 80, height: 16 },
  )
  try {
    await Bun.sleep(50)
    const lines = app.captureCharFrame().split("\n")
    const singleCharLines = lines.filter((line) => /^[a-z]$/.test(line.trim()))
    expect(singleCharLines.length).toBeGreaterThan(4)
  } finally {
    app.renderer.destroy()
  }
})
