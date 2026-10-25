import { describe, expect, it } from "bun:test"

import { TransportReason } from "../../src/schema/errors"

describe("TransportReason.retryable", () => {
  const retryableOf = (message: string, kind?: string) => TransportReason.make({ message, kind }).retryable

  it("is retryable for explicit timeouts", () => {
    expect(retryableOf("Request timed out", "Timeout")).toBe(true)
  })

  it("is retryable for aggregated low-level socket failures (kind=TransportError)", () => {
    expect(retryableOf("connection refused", "TransportError")).toBe(true)
  })

  it("is retryable when the message names a known transient marker", () => {
    expect(retryableOf("getaddrinfo ENOTFOUND api.example.com")).toBe(true)
    expect(retryableOf("ECONNRESET")).toBe(true)
    expect(retryableOf("socket closed unexpectedly")).toBe(true)
  })

  it("is NOT retryable for generic or permanent transport problems", () => {
    expect(retryableOf("HTTP transport failed")).toBe(false)
    expect(retryableOf("authentication failed", "Unauthorized")).toBe(false)
  })
})
