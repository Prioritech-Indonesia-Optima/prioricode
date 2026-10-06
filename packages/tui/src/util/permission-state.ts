import type { PermissionRequest } from "@prioricode/sdk/v2"

// The sync store keeps each session's pending-permission queue sorted by
// request id because the permission.asked/replied reducers locate entries
// with a binary search. Bootstrap hydration must preserve that invariant.
export function groupPermissionsBySession(requests: PermissionRequest[]): Record<string, PermissionRequest[]> {
  const grouped: Record<string, PermissionRequest[]> = {}
  for (const request of requests) {
    const queue = grouped[request.sessionID]
    if (queue) queue.push(request)
    else grouped[request.sessionID] = [request]
  }
  for (const queue of Object.values(grouped)) queue.sort((a, b) => a.id.localeCompare(b.id))
  return grouped
}

// Bounded append for the per-session decision history.
export function appendDecision<T>(history: T[] | undefined, decision: T, limit: number): T[] {
  if (!history) return [decision]
  const next = [...history, decision]
  return next.length > limit ? next.slice(next.length - limit) : next
}
