import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@prioricode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~prioricode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~prioricode/WorkspaceRef", {
  defaultValue: () => undefined,
})
