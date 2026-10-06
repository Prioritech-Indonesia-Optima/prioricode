export * as Database from "./database"

import { EffectDrizzleSqlite } from "@prioricode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel, InstallationLocal } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.PRIORICODE_DB) {
    if (Flag.PRIORICODE_DB === ":memory:" || isAbsolute(Flag.PRIORICODE_DB)) return Flag.PRIORICODE_DB
    return join(Global.Path.data, Flag.PRIORICODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    InstallationLocal ||
    process.env.PRIORICODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.PRIORICODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "prioricode.db")
  return join(Global.Path.data, `prioricode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
