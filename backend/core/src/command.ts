export * as Command from "./command"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Types } from "effect"
import { Command as CommandSchema } from "@prioricode/schema/command"
import { State } from "./state"

export const Info = CommandSchema.Info
export type Info = CommandSchema.Info

export type Data = {
  commands: Map<string, Types.DeepMutable<Info>>
}

export type Draft = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Types.DeepMutable<Info>) => void) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

// Tag must stay distinct from the legacy CLI `@prioricode/Command` service:
// same tag = same runtime identity, which silently shadows one of the two.
export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/Command") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const state = State.create<Data, Draft>({
      initial: () => ({ commands: new Map() }),
      draft: (draft) => ({
        list: () => Array.from(draft.commands.values()) as Info[],
        get: (name) => draft.commands.get(name),
        update: (name, update) => {
          const current = draft.commands.get(name) ?? ({ name, template: "" } as Types.DeepMutable<Info>)
          if (!draft.commands.has(name)) draft.commands.set(name, current)
          update(current)
          current.name = name
        },
        remove: (name) => {
          draft.commands.delete(name)
        },
      }),
    })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        return state.get().commands.get(name)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        return Array.from(state.get().commands.values())
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [] })
