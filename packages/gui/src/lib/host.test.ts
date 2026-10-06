import { describe, expect, test } from "bun:test"
import { detectHost } from "./host"

describe("detectHost", () => {
  test("returns vscode when acquireVsCodeApi is present", () => {
    expect(detectHost("", { acquireVsCodeApi: () => ({ postMessage: () => {} }) })).toBe("vscode")
  })
  test("returns vscode for ?host=vscode query override", () => {
    expect(detectHost("?host=vscode", {})).toBe("vscode")
  })
  test("returns web by default", () => {
    expect(detectHost("", {})).toBe("web")
    expect(detectHost("?other=1", {})).toBe("web")
  })
})
