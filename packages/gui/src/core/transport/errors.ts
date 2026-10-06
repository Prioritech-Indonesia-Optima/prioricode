import {
  ClientError,
  isMessageNotFoundError,
  isPermissionNotFoundError,
  isQuestionNotFoundError,
  isSessionNotFoundError,
} from "@prioricode/client"

export {
  ClientError,
  isMessageNotFoundError,
  isPermissionNotFoundError,
  isQuestionNotFoundError,
  isSessionNotFoundError,
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError
}

export function statusOf(error: unknown): number | undefined {
  if (!(error instanceof ClientError) || error.reason !== "UnexpectedStatus") return undefined
  const cause = error.cause as { status?: unknown } | undefined
  return typeof cause?.status === "number" ? cause.status : undefined
}

/**
 * A reply for a request that no longer exists (or is already settled) is a
 * successful no-op for the user. 404s arrive as declared tagged errors and
 * undeclared 409 busy races arrive as ClientError(UnexpectedStatus).
 */
export function isSettledReplyFailure(error: unknown): boolean {
  if (isPermissionNotFoundError(error) || isQuestionNotFoundError(error) || isSessionNotFoundError(error)) return true
  const status = statusOf(error)
  return status === 404 || status === 409
}

export function clientErrorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (error instanceof ClientError) {
    switch (error.reason) {
      case "Transport":
        return "Cannot reach the PrioriCode server. Check that it is running."
      case "UnexpectedStatus": {
        const status = statusOf(error)
        if (status === 401) return "Server rejected the credentials (401). Update the connection password."
        return `Server returned HTTP ${status ?? "error"}`
      }
      case "UnsupportedContentType":
        return "Server replied with an unexpected content type."
      case "MalformedResponse":
        return "Server sent a malformed response."
    }
  }
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined
  if (typeof record?.message === "string") return record.message
  if (typeof record?._tag === "string") return record._tag
  return "Unexpected error"
}
