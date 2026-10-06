import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveAgent, selectionFromSessionInfo } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasCustomAgent([{ native: true }, {}])).toBe(false)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses the requested available agent", () => {
    expect(resolveAgent(agents, "custom")?.name).toBe("custom")
  })

  test("defaults to build", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
  })

  test("uses the first agent when build is unavailable", () => {
    expect(resolveAgent([{ name: "custom" }], "missing")?.name).toBe("custom")
  })
})

describe("selectionFromSessionInfo", () => {
  const valid = (model: { providerID: string; modelID: string }) => model.providerID === "alibaba-token-plan"

  test("seeds composer selection from server session info", () => {
    expect(
      selectionFromSessionInfo(
        { agent: "plan", model: { id: "qwen3.8-flash", providerID: "alibaba-token-plan", variant: "high" } },
        valid,
      ),
    ).toEqual({ agent: "plan", model: { providerID: "alibaba-token-plan", modelID: "qwen3.8-flash" }, variant: "high" })
  })

  test("drops invalid or disconnected models but keeps the agent", () => {
    expect(selectionFromSessionInfo({ agent: "build", model: { id: "x", providerID: "nope" } }, valid)).toEqual({
      agent: "build",
      model: undefined,
      variant: null,
    })
  })

  test("nothing selectable returns undefined so local state is untouched", () => {
    expect(selectionFromSessionInfo(undefined, valid)).toBeUndefined()
    expect(selectionFromSessionInfo({}, valid)).toBeUndefined()
    expect(selectionFromSessionInfo({ agent: "", model: null }, valid)).toBeUndefined()
  })

  test("missing variant hydrates as null", () => {
    const result = selectionFromSessionInfo(
      { agent: "build", model: { id: "m", providerID: "alibaba-token-plan" } },
      valid,
    )
    expect(result?.variant).toBeNull()
  })
})
