/**
 * Shared durable Session operations used by the SessionV2 facade and by
 * Location-scoped fleet tools. Implementations depend only on leaf services
 * (database, event log, projector-backed store, project resolution, execution
 * coordinator), never on the LocationServiceMap: Location-scoped producers are
 * built *inside* the map, so anything they capture must not require the map itself.
 */
import { DateTime, Effect } from "effect"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import { PromptInput } from "@prioricode/schema/prompt-input"
import { AgentV2 } from "../agent"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import { Slug } from "../util/slug"
import { WorkspaceV2 } from "../workspace"
import { SessionV1 } from "../v1/session"
import { Prompt } from "./prompt"
import { NotFoundError, PromptConflictError } from "./error"
import { SessionEvent } from "./event"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionExecution } from "./execution"
import { SessionStore } from "./store"

export type SessionOperationsDeps = {
  readonly db: Database.Interface["db"]
  readonly events: EventV2.Interface
  readonly projects: ProjectV2.Interface
  readonly store: SessionStore.Interface
  readonly execution: SessionExecution.Interface
}

export type SessionCreateInput = {
  id?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  location: Location.Ref
  parentID?: SessionSchema.ID
  title?: string
}

export const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

export const makeSessionOperations = (deps: SessionOperationsDeps) => {
  const { db, events, projects, store, execution } = deps

  const get = Effect.fn("V2Session.get")(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session) return yield* new NotFoundError({ sessionID })
    return session
  })

  const create = Effect.fn("V2Session.create")(function* (input: SessionCreateInput) {
    const sessionID = input.id ?? SessionSchema.ID.create()
    const recorded = yield* store.get(sessionID)
    if (recorded) return recorded
    const project = yield* projects.resolve(input.location.directory)
    yield* db
      .insert(ProjectTable)
      .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const now = Date.now()
    const info = SessionV1.SessionInfo.make({
      id: sessionID,
      slug: Slug.create(),
      version: InstallationVersion,
      projectID: project.id,
      directory: input.location.directory,
      path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
      workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
      title: input.title ?? `New session - ${new Date(now).toISOString()}`,
      agent: input.agent,
      parentID: input.parentID,
      model: input.model
        ? {
            id: ModelV2.ID.make(input.model.id),
            providerID: input.model.providerID,
            variant: input.model.variant,
          }
        : undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
    })
    const projected = yield* events
      .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
      .pipe(
        Effect.as({ type: "created" } as const),
        Effect.catchDefect((defect) => {
          if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
            return Effect.die(defect)
          }
          // Concurrent creation lost the projection race. The existing Session identity wins.
          return store
            .get(sessionID)
            .pipe(
              Effect.flatMap((session) =>
                session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
              ),
            )
        }),
      )
    if (projected.type === "existing") return projected.session
    // TODO: Restore recorded sessions onto replacement synchronized workspaces in a future API slice.
    return yield* get(sessionID).pipe(Effect.orDie)
  })

  const prompt = Effect.fn("V2Session.prompt")((input) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        yield* get(input.sessionID)
        const prompt = resolvePrompt(input.prompt)
        const messageID = input.id ?? SessionMessage.ID.create()
        const delivery = input.delivery ?? "steer"
        const expected = { sessionID: input.sessionID, messageID, prompt, delivery }
        const admitted = yield* SessionInput.admit(db, events, {
          id: messageID,
          sessionID: input.sessionID,
          prompt,
          delivery,
        }).pipe(
          Effect.catchDefect((defect) =>
            defect instanceof SessionInput.LifecycleConflict
              ? new PromptConflictError({ sessionID: input.sessionID, messageID })
              : Effect.die(defect),
          ),
        )
        if (!SessionInput.equivalent(admitted, expected))
          return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
        if (input.resume !== false) yield* execution.wake(admitted.sessionID)
        return admitted
      }),
    ),
  )

  const switchAgent = Effect.fn("V2Session.switchAgent")(function* (input: {
    sessionID: SessionSchema.ID
    agent: string
  }) {
    yield* get(input.sessionID)
    yield* events.publish(SessionEvent.AgentSwitched, {
      sessionID: input.sessionID,
      messageID: SessionMessage.ID.create(),
      timestamp: yield* DateTime.now,
      agent: input.agent,
    })
  })

  const switchModel = Effect.fn("V2Session.switchModel")(function* (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) {
    const session = yield* get(input.sessionID)
    if (
      session.model?.providerID === input.model.providerID &&
      session.model.id === input.model.id &&
      (session.model.variant ?? "default") === (input.model.variant ?? "default")
    )
      return
    yield* events.publish(SessionEvent.ModelSwitched, {
      sessionID: input.sessionID,
      messageID: SessionMessage.ID.create(),
      timestamp: yield* DateTime.now,
      model: input.model,
    })
  })

  return { create, get, prompt, switchAgent, switchModel }
}

export type SessionOperations = ReturnType<typeof makeSessionOperations>
