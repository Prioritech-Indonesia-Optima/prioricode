import { expect, test } from "bun:test"
import { createCompatibleApi } from "./server-compat"

function makeFakes(protocol: "v1" | "v2") {
  const calls: [string, unknown][] = []
  const current = {
    session: {
      revert: { commit: async () => undefined },
      switchAgent: async (input: unknown) => {
        calls.push(["native.switchAgent", input])
      },
      switchModel: async (input: unknown) => {
        calls.push(["native.switchModel", input])
      },
    },
    permission: {},
    project: {},
    vcs: {},
    file: {},
    pty: {},
    integration: { connect: {}, oauth: {} },
  }
  const legacyClient = {
    v2: {
      session: {
        switchAgent: async (params: unknown) => {
          calls.push(["legacy.switchAgent", params])
        },
        switchModel: async (params: unknown) => {
          calls.push(["legacy.switchModel", params])
        },
      },
    },
  }
  const api = createCompatibleApi({
    protocol: Promise.resolve(protocol),
    current: current as never,
    legacy: () => legacyClient as never,
    directory: "/tmp/project",
  })
  return { api, calls }
}

test("v1 protocol routes switchAgent through the legacy v2 session group", async () => {
  const { api, calls } = makeFakes("v1")
  await api.session.switchAgent({ sessionID: "ses_1", agent: "build" })
  expect(calls).toEqual([["legacy.switchAgent", { sessionID: "ses_1", agent: "build" }]])
})

test("v1 protocol routes switchModel with the model ref shape", async () => {
  const { api, calls } = makeFakes("v1")
  await api.session.switchModel({
    sessionID: "ses_2",
    model: { id: "qwen3.8-flash", providerID: "alibaba-token-plan", variant: "high" },
  })
  expect(calls).toEqual([
    ["legacy.switchModel", { sessionID: "ses_2", model: { id: "qwen3.8-flash", providerID: "alibaba-token-plan", variant: "high" } }],
  ])
})

test("v2 protocol uses the native client without reshaping", async () => {
  const { api, calls } = makeFakes("v2")
  const input = { sessionID: "ses_3", agent: "plan" }
  await api.session.switchAgent(input)
  expect(calls).toEqual([["native.switchAgent", input]])
})
