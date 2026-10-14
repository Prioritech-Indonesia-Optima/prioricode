import { ConfigV1 } from "@prioricode/core/v1/config/config"
import { SessionV1 } from "@prioricode/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

const COMPACTION_BUFFER = 20_000
const DEFAULT_CONTEXT_WINDOW = 256_000

export function effectiveContext(cfg: ConfigV1.Info, model: Provider.ProviderModel): number {
  if (model.limit.context > 0) return model.limit.context
  const fallback = cfg.compaction?.default_context
  if (fallback === 0) return 0
  return fallback ?? DEFAULT_CONTEXT_WINDOW
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.ProviderModel; outputTokenMax?: number }) {
  const context = effectiveContext(input.cfg, input.model)
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function triggerPoint(input: { cfg: ConfigV1.Info; model: Provider.ProviderModel; outputTokenMax?: number }) {
  const threshold = input.cfg.compaction?.threshold
  if (threshold === undefined) return usable(input)

  const context = effectiveContext(input.cfg, input.model)
  if (context === 0) return 0
  return Math.max(0, Math.floor((context * Math.min(threshold, 100)) / 100))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.ProviderModel
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false

  const context = effectiveContext(input.cfg, input.model)
  if (context === 0) return false

  const count =
    input.tokens.total ||
    input.tokens.input +
      input.tokens.output +
      input.tokens.reasoning +
      input.tokens.cache.read +
      input.tokens.cache.write
  return count >= triggerPoint(input)
}
