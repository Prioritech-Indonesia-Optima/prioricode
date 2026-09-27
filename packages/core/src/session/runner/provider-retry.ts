export * as ProviderRetry from "./provider-retry"

import type { LLMError } from "@prioricode/llm"
import { ConfigLoop } from "../../config/loop"
import type { SessionEvent } from "../event"

export interface Settings {
  readonly maxAttempts: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterFactor: number
}

export const DEFAULT_SETTINGS: Settings = {
  maxAttempts: 5,
  initialDelayMs: 2_000,
  maxDelayMs: 30_000,
  jitterFactor: 0.25,
}

export const settings = (retry: ConfigLoop.Retry | undefined): Settings => ({
  maxAttempts: retry?.max_attempts ?? DEFAULT_SETTINGS.maxAttempts,
  initialDelayMs: retry?.initial_delay ?? DEFAULT_SETTINGS.initialDelayMs,
  maxDelayMs: retry?.max_delay ?? DEFAULT_SETTINGS.maxDelayMs,
  jitterFactor: boundedJitter(retry?.jitter ?? DEFAULT_SETTINGS.jitterFactor),
})

function boundedJitter(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.jitterFactor
  return Math.min(1, Math.max(0, value))
}

/** A failed provider turn may be re-attempted only while it is safely replayable: retryable error and no assistant output started. */
export function shouldRetry(error: LLMError, attempt: number, config: Settings) {
  return error.retryable && attempt < config.maxAttempts
}

/**
 * Delay before attempt `nextAttempt` (2..maxAttempts) after failed attempt
 * `nextAttempt - 1`. Honors provider `retryAfterMs`, otherwise exponentially
 * grows from the configured initial delay with bounded jitter.
 */
export function delay(
  error: LLMError,
  nextAttempt: number,
  config: Settings = DEFAULT_SETTINGS,
  random = Math.random(),
) {
  const provider = error.retryAfterMs
  if (provider !== undefined && Number.isFinite(provider)) return cap(provider, config)
  const base = config.initialDelayMs * Math.pow(2, Math.max(0, nextAttempt - 2))
  return cap(Math.ceil(base + base * config.jitterFactor * Math.min(1, Math.max(0, random))), config)
}

function cap(ms: number, config: Settings) {
  return Math.min(Math.max(0, Math.ceil(ms)), config.maxDelayMs)
}

/** Durable, replayable error payload recorded with each retry notice. */
export function eventError(error: LLMError): SessionEvent.RetryError {
  const reason = error.reason
  const status = "status" in reason ? reason.status : undefined
  const http = "http" in reason ? reason.http : undefined
  return {
    message: reason.message,
    isRetryable: true,
    ...(status === undefined ? {} : { statusCode: status }),
    ...(http?.response?.headers === undefined ? {} : { responseHeaders: http.response.headers }),
    ...(http?.body === undefined ? {} : { responseBody: http.body }),
    metadata: { module: error.module, method: error.method, reason: reason._tag },
  }
}
