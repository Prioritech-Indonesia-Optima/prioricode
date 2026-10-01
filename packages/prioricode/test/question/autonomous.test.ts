import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { SessionProjector } from "@prioricode/core/session/projector"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Fiber, Layer } from "effect"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Question.node,
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const oneQuestion = [
  {
    question: "Should I create a new branch or commit to the current one?",
    header: "Branching",
    options: [
      { label: "New branch", description: "Create a feature branch first" },
      { label: "Current branch", description: "Commit where I am" },
    ],
  },
]

it.instance("an autonomous session self-answers a question with the first option and never blocks", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const question = yield* Question.Service
    const autonomous = yield* Effect.acquireRelease(
      sessions.create({ title: "unattended", metadata: { autonomous: true } }),
      (info) => sessions.remove(info.id).pipe(Effect.ignore),
    )

    // No human listener is attached; the ask must resolve on its own.
    const answers = yield* question.ask({ sessionID: autonomous.id, questions: oneQuestion })
    expect(answers).toEqual([["New branch"]])
    expect(yield* question.list()).toEqual([])
  }),
)

it.instance("a subagent of an autonomous session inherits self-answering", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const question = yield* Question.Service
    const parent = yield* Effect.acquireRelease(
      sessions.create({ title: "unattended-parent", metadata: { autonomous: true } }),
      (info) => sessions.remove(info.id).pipe(Effect.ignore),
    )
    const child = yield* Effect.acquireRelease(
      sessions.create({ title: "child", parentID: parent.id }),
      (info) => sessions.remove(info.id).pipe(Effect.ignore),
    )

    expect(yield* sessions.effectiveAutonomous(child.id)).toBe(true)
    const answers = yield* question.ask({ sessionID: child.id, questions: oneQuestion })
    expect(answers).toEqual([["New branch"]])
    expect(yield* question.list()).toEqual([])
  }),
)

it.instance("a non-autonomous session still surfaces the question for a human", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const question = yield* Question.Service
    const chat = yield* Effect.acquireRelease(sessions.create({ title: "attended" }), (info) =>
      sessions.remove(info.id).pipe(Effect.ignore),
    )

    expect(yield* sessions.effectiveAutonomous(chat.id)).toBe(false)
    const fiber = yield* question.ask({ sessionID: chat.id, questions: oneQuestion }).pipe(Effect.forkChild)
    const pending = yield* pollWithTimeout(
      Effect.gen(function* () {
        const list = yield* question.list()
        return list.some((request) => request.sessionID === chat.id) ? list : undefined
      }),
      "attended question never surfaced as pending",
    )
    expect(pending.filter((request) => request.sessionID === chat.id)).toHaveLength(1)

    for (const request of pending) yield* question.reply({ requestID: request.id, answers: [["Current branch"]] })
    expect(yield* Fiber.join(fiber)).toEqual([["Current branch"]])
  }),
)
