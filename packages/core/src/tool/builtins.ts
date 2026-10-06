export * as BuiltInTools from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Layer } from "effect"
import { BashTool } from "./bash"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GoalTool } from "./goal"
import { GrepTool } from "./grep"
import { PlanTool } from "./plan"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { SkillTool } from "./skill"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TaskTool is deliberately absent: it captures the run coordinator through
 * SessionExecution, and any Location-scoped node that captures it makes
 * buildLocationServiceMap construct SessionExecutionLocal inside its own
 * LayerMap body (a detected layer cycle). It is registered through the future
 * Session-scoped canonical tool registration designed in specs/v2/tools.md and
 * tool/AGENTS.md "Current Gaps". PlanTool is not affected: its durable writes
 * go through map-free leaves (Database, EventV2, SessionStore, QuestionV2), so
 * it registers normally here.
 */
export const node = makeLocationNode({
  name: "built-in-tools",
  layer: Layer.empty,
  deps: [
    ApplyPatchTool.node,
    BashTool.node,
    EditTool.node,
    GlobTool.node,
    GoalTool.node,
    GrepTool.node,
    PlanTool.node,
    QuestionTool.node,
    ReadTool.node,
    SkillTool.node,
    TodoWriteTool.node,
    WebFetchTool.node,
    WebSearchTool.node,
    WriteTool.node,
  ],
})
