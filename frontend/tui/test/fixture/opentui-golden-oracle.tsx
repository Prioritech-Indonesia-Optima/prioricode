/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"

async function frame(build: () => any, width: number, height: number): Promise<string[]> {
  const app = await testRender(build, { width, height })
  await Bun.sleep(150)
  const lines = app.captureCharFrame().split("\n")
  app.renderer.destroy()
  return lines
}

const goldens = {
  paddedBox: await frame(
    () => (
      <box border={["left", "right"]} paddingLeft={1} width={20} height={5}>
        <text width={17}>golden parity</text>
      </box>
    ),
    40,
    8,
  ),
  plainText: await frame(() => <text>plain line</text>, 40, 4),
  stackedBorders: await frame(
    () => (
      <box flexDirection="column" width={30} height={6} gap={1}>
        <box border={["top"]} width={28} height={2}>
          <text>first</text>
        </box>
        <box border={["bottom"]} width={28} height={2}>
          <text>second</text>
        </box>
      </box>
    ),
    40,
    9,
  ),
}

console.log(JSON.stringify(goldens))
