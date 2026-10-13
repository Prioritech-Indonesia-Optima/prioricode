import type { SkillSource } from "@prioricode/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface SkillDraft {
  source(source: SkillSource): void
  list(): readonly SkillSource[]
}

export type SkillHooks = Hooks<{
  transform: SkillDraft
}>
