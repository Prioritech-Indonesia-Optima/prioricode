import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { Workspace } from "@prioricode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~prioricode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<Workspace.ID | undefined>("~prioricode/WorkspaceRef", {
  defaultValue: () => undefined,
})
