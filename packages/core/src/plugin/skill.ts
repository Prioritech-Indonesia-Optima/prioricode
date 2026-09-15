/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizePrioricodeContent from "./skill/customize-prioricode.md" with { type: "text" }

export const CustomizePrioricodeContent = customizePrioricodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-prioricode",
            description:
              "Use ONLY when the user is editing or creating prioricode's own configuration: prioricode.json, prioricode.jsonc, files under .prioricode/, or files under ~/.config/prioricode/. Also use when creating or fixing prioricode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring prioricode itself.",
            location: AbsolutePath.make("/builtin/customize-prioricode.md"),
            content: CustomizePrioricodeContent,
          }),
        }),
      )
    })
  }),
})
