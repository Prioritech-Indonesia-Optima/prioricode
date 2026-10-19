import { describe, expect, test } from "bun:test"
import { QuestionTool } from "@prioricode/core/tool/question"
import { SkillTool } from "@prioricode/core/tool/skill"
import { TaskTool } from "@prioricode/core/tool/task"
import { WebFetchTool } from "@prioricode/core/tool/webfetch"
import V1_QUESTION from "../../src/tool/question.txt"
import V1_SKILL from "../../src/tool/skill.txt"
import V1_TASK from "../../src/tool/task.txt"
import V1_WEBFETCH from "../../src/tool/webfetch.txt"

// The V1 (cli) tools read their descriptions from .txt files while the V2 core
// tools inline the same contract. Both runtimes ship these strings to models,
// so any drift means each runtime trains the agent on a different rulebook.
// This test pins the canonical text to one source per tool pair.
const pairs = [
  ["question", V1_QUESTION, QuestionTool.description],
  ["task", V1_TASK, TaskTool.description],
  ["webfetch", V1_WEBFETCH, WebFetchTool.description],
  ["skill", V1_SKILL, SkillTool.description],
] as const

describe("tool description parity", () => {
  for (const [name, v1, v2] of pairs) {
    test(`${name} description matches across runtimes`, () => {
      expect(v1.trim()).toBe(v2.trim())
    })
  }
})
