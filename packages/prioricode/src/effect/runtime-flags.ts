import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("PRIORICODE_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@prioricode/RuntimeFlags", {
  autoShare: bool("PRIORICODE_AUTO_SHARE"),
  pure: bool("PRIORICODE_PURE"),
  disableDefaultPlugins: bool("PRIORICODE_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("PRIORICODE_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("PRIORICODE_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("PRIORICODE_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("PRIORICODE_DISABLE_CLAUDE_CODE"),
    direct: bool("PRIORICODE_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("PRIORICODE_DISABLE_CLAUDE_CODE"),
    direct: bool("PRIORICODE_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("PRIORICODE_ENABLE_EXA"),
    legacy: bool("PRIORICODE_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("PRIORICODE_ENABLE_PARALLEL"),
    legacy: bool("PRIORICODE_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("PRIORICODE_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("PRIORICODE_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("PRIORICODE_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("PRIORICODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("PRIORICODE_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("PRIORICODE_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("PRIORICODE_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("PRIORICODE_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("PRIORICODE_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("PRIORICODE_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("PRIORICODE_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("PRIORICODE_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("PRIORICODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("PRIORICODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("PRIORICODE_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("PRIORICODE_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("PRIORICODE_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@prioricode/core/effect/layer-node"
