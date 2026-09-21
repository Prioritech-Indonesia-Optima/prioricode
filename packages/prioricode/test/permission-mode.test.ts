import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "@prioricode/core/v1/permission"
import { Permission } from "@/permission"

const agentAllowsAll: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

function evaluateWith(mode: "default" | "ask-first" | "always-allow", permission: string, pattern: string) {
  const ruleset = [...agentAllowsAll, ...Permission.permissionModeRules(mode)]
  return Permission.evaluate(permission, pattern, ruleset).action
}

describe("legacy permission mode rules", () => {
  test("default adds no rules", () => {
    expect(Permission.permissionModeRules("default")).toEqual([])
    expect(Permission.permissionModeRules(undefined)).toEqual([])
  })

  test("ask-first prompts for edit and bash but not reads", () => {
    expect(evaluateWith("ask-first", "edit", "src/index.ts")).toBe("ask")
    expect(evaluateWith("ask-first", "bash", "echo hi")).toBe("ask")
    expect(evaluateWith("ask-first", "read", "src/index.ts")).toBe("allow")
    expect(evaluateWith("ask-first", "external_directory", "/tmp/*")).toBe("allow")
  })

  test("always-allow auto-allows everything including external directories", () => {
    expect(evaluateWith("always-allow", "edit", "src/index.ts")).toBe("allow")
    expect(evaluateWith("always-allow", "bash", "echo hi")).toBe("allow")
    expect(evaluateWith("always-allow", "external_directory", "/home/user/*")).toBe("allow")
  })

  test("always-allow forces ask only for destructive bash", () => {
    expect(Permission.destructiveBashForcesAsk("always-allow", "bash", "rm -rf /")).toBe(true)
    expect(Permission.destructiveBashForcesAsk("always-allow", "bash", "mkfs.ext4 /dev/sda1")).toBe(true)
    expect(Permission.destructiveBashForcesAsk("always-allow", "bash", "echo hi")).toBe(false)
    expect(Permission.destructiveBashForcesAsk("always-allow", "edit", "rm -rf /")).toBe(false)
    expect(Permission.destructiveBashForcesAsk("default", "bash", "rm -rf /")).toBe(false)
    expect(Permission.destructiveBashForcesAsk(undefined, "bash", "rm -rf /")).toBe(false)
  })
})
