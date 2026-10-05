import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("App", () => {
  test("boots the web host shell and renders the composer", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
    for (let i = 0; i < 100 && container.querySelector("textarea") === null; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
    expect(container.textContent).toContain("PrioriCode")
    expect(container.querySelector("textarea")).not.toBeNull()
    expect(container.textContent).toContain("Connected")
    await act(async () => {
      root.unmount()
    })
  })
})
