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
  test("renders shell with detected host", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
    expect(container.textContent).toContain("PrioriCode")
    expect(container.textContent).toContain("web")
    await act(async () => {
      root.unmount()
    })
  })
})
