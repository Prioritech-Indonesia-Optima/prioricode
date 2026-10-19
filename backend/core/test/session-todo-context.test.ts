import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SystemContext } from "@prioricode/core/system-context"
import { SessionTodoContext } from "@prioricode/core/session/todo-context"

describe("SessionTodoContext", () => {
  test("an empty reminder contributes no source; an unattended reminder anchors its baseline verbatim", async () => {
    expect(SessionTodoContext.context("")).toBe(SystemContext.empty)
    const withReminder = SystemContext.combine([SessionTodoContext.context("the list is stale")])
    expect(withReminder).not.toBe(SystemContext.empty)

    const generation = await Effect.runPromise(SystemContext.initialize(withReminder))
    expect(generation.baseline).toContain("the list is stale")
  })

  test("the reminder source renders update and removal text for turn-boundary drift", async () => {
    const context = SystemContext.combine([SessionTodoContext.context("old nag")])
    const generation = await Effect.runPromise(SystemContext.initialize(context))
    const next = SystemContext.combine([SessionTodoContext.context("new nag")])
    const updated = await Effect.runPromise(SystemContext.reconcile(next, generation.snapshot))
    expect(updated._tag).toBe("Updated")
    if (updated._tag === "Updated") expect(updated.text).toContain("new nag")

    const cleared = await Effect.runPromise(SystemContext.reconcile(SystemContext.empty, generation.snapshot))
    if (cleared._tag === "Updated") expect(cleared.text).toContain("no longer applies")
    else expect(cleared._tag).toBe("ReplacementReady")
  })
})
