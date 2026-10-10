/** @jsxImportSource @prioricode/tui-core/solid */
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { For, Show } from "solid-js"
import { testRender } from "../src/solid/testing"
import { createLayoutEngine } from "../src/layout/engine"

await createLayoutEngine()

test("renders a signal-driven text through the solid bridge", async () => {
  const [count, setCount] = createSignal(3)
  const app = await testRender(
    () => (
      <box>
        <text wrap="none">items {count()}</text>
      </box>
    ),
    { width: 30, height: 4 },
  )
  try {
    const frame = await app.waitForFrame((f) => f.includes("items 3"))
    expect(frame).toContain("items 3")
    setCount(42)
    const next = await app.waitForFrame((f) => f.includes("items 42"))
    expect(next).toContain("items 42")
  } finally {
    app.dispose()
  }
})

test("For list renders each row", async () => {
  const app = await testRender(
    () => (
      <box flexDirection="column" width={20} height={5}>
        <For each={["a", "b", "c"]}>{(letter) => <text wrap="none">row {letter}</text>}</For>
      </box>
    ),
    { width: 30, height: 6 },
  )
  try {
    const frame = await app.waitForFrame((f) => f.includes("row c"))
    expect(frame).toContain("row a")
    expect(frame).toContain("row c")
  } finally {
    app.dispose()
  }
})

test("Show toggles subtree", async () => {
  const [on, setOn] = createSignal(true)
  const app = await testRender(
    () => (
      <box>
        <Show when={on()}>
          <text wrap="none">visible</text>
        </Show>
      </box>
    ),
    { width: 20, height: 3 },
  )
  try {
    expect(await app.waitForFrame((f) => f.includes("visible"))).toContain("visible")
    setOn(false)
    await Bun.sleep(20)
    app.renderer.renderNow()
    expect(app.charFrame()).not.toContain("visible")
  } finally {
    app.dispose()
  }
})

test("nested styled spans inherit text color", async () => {
  const app = await testRender(
    () => (
      <text wrap="none" fg="#ff0000">
        plain<span style={{ fg: "#0000ff" }}>blue</span>after
      </text>
    ),
    { width: 40, height: 3 },
  )
  try {
    const frame = await app.waitForFrame((f) => f.includes("plainblueafter"))
    expect(frame).toContain("plainblueafter")
  } finally {
    app.dispose()
  }
})
