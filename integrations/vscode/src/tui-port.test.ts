import { describe, expect, it } from "bun:test"
import { discoverTuiPort, parseTuiPort, tuiStateDirectory } from "./tui-port"

describe("tuiStateDirectory", () => {
  it("matches the core state dir layout", () => {
    expect(tuiStateDirectory({ XDG_STATE_HOME: "/xdg" }, () => "/h")).toBe("/xdg/prioricode")
    expect(tuiStateDirectory({}, () => "/h")).toBe("/h/.local/state/prioricode")
  })
})

describe("parseTuiPort", () => {
  it("accepts valid entries", () => {
    expect(parseTuiPort('{"port":32176,"pid":42,"started":1}')).toEqual({ port: 32176, pid: 42 })
  })

  it("rejects garbage and out-of-range", () => {
    expect(parseTuiPort("nope")).toBeUndefined()
    expect(parseTuiPort('{"port":0,"pid":1}')).toBeUndefined()
    expect(parseTuiPort('{"port":70000,"pid":1}')).toBeUndefined()
    expect(parseTuiPort('{"port":32176}')).toBeUndefined()
    expect(parseTuiPort('{"port":"32176","pid":1}')).toBeUndefined()
  })
})

describe("discoverTuiPort", () => {
  const okFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch
  const errorFetch = (async () => new Response("no assets", { status: 500 })) as unknown as typeof fetch
  const deadFetch = (async () => {
    throw new Error("refused")
  }) as unknown as typeof fetch

  const deps = (file: string, fetchImpl: typeof fetch) => ({
    readFile: async () => file,
    stateDirectory: "/state",
    fetchImpl,
    timeoutMs: 100,
  })

  it("returns the port when any HTTP answer arrives", async () => {
    expect(await discoverTuiPort(deps('{"port":32176,"pid":1}', okFetch))).toBe(32176)
    expect(await discoverTuiPort(deps('{"port":32176,"pid":1}', errorFetch))).toBe(32176)
  })

  it("ignores stale files (dead port, unreadable file, garbage)", async () => {
    expect(await discoverTuiPort(deps('{"port":32176,"pid":1}', deadFetch))).toBeUndefined()
    expect(await discoverTuiPort(deps('{"port":99999,"pid":1}', okFetch))).toBeUndefined()
  })
})
