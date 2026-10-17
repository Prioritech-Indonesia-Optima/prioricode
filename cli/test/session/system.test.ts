import { describe, expect, test } from "bun:test"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@prioricode/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import PROMPT_BASE from "../../src/session/prompt/base.txt"
import type { Provider } from "../../src/provider/provider"
import { MCP } from "../../src/mcp"
import { testEffect } from "../lib/effect"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  LayerNode.compile(SystemPrompt.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () =>
          Effect.succeed([
            {
              name: "guide-server",
              instructions: "Use lookup before mutate.",
              tools: [],
            },
            {
              name: "tool-server",
              instructions: "Prefer search before update.",
              tools: ["tool-server_search", "tool-server_update"],
            },
          ]),
      }),
    ],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ],
  ]),
)

describe("session.system", () => {
  test("base is the model-agnostic shared preamble", () => {
    expect(SystemPrompt.base).toBe(PROMPT_BASE)
    expect(SystemPrompt.base).toContain("You are PrioriCode")
    expect(SystemPrompt.base).toContain("Lead with the outcome")
    expect(SystemPrompt.base).toContain("Done means verified")
    expect(SystemPrompt.base).toContain("Tools act; your text communicates")
    expect(SystemPrompt.base).not.toContain("{{")
  })

  test("shared preamble stays model-agnostic", () => {
    for (const name of ["PrioriTech", "GPT", "Gemini", "Muse", "Claude", "Trinity", "Kimi", "Astra"]) {
      expect(PROMPT_BASE).not.toContain(name)
    }
  })

  test("provider selects the family delta", () => {
    const pick = (id: string, providerID = "test") =>
      SystemPrompt.provider({ api: { id }, providerID } as Provider.ProviderModel)[0]
    expect(pick("gpt-4o")).toContain("o-series")
    expect(pick("gpt-5")).toContain("GPT family")
    expect(pick("gpt-6")).toContain("Astra")
    expect(pick("claude-sonnet-4")).toContain("Claude")
    expect(pick("gemini-2.0")).toContain("Gemini")
    expect(pick("kimi-k2", "moonshotai")).toContain("Kimi")
    expect(SystemPrompt.provider({ api: { id: "unknown-model" } } as Provider.ProviderModel)[0]).toContain(
      "general-purpose",
    )
  })

  test("provider substitutes the Meta model name", () => {
    const meta = SystemPrompt.provider({ api: { id: "meta/muse-spark-preview" } } as Provider.ProviderModel)[0]
    expect(meta).toContain("Muse Spark")
    expect(meta).not.toContain("{{")
  })

  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("MCP output includes connected server instructions", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build)

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          '  <server name="tool-server">',
          "    Prefer search before update.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("MCP output omits servers when all advertised tools are denied", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build, Permission.fromConfig({ "tool-server_*": "deny" }))

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )
})
