export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}

export type SessionSelectionInfo = {
  agent?: string | null
  model?: { id: string; providerID: string; variant?: string | null } | null
}

export function selectionFromSessionInfo(
  info: SessionSelectionInfo | undefined,
  validModel: (model: { providerID: string; modelID: string }) => boolean,
): { agent?: string; model?: { providerID: string; modelID: string }; variant?: string | null } | undefined {
  if (!info) return
  const agent = typeof info.agent === "string" && info.agent ? info.agent : undefined
  const candidate = info.model ? { providerID: info.model.providerID, modelID: info.model.id } : undefined
  const model = candidate && validModel(candidate) ? candidate : undefined
  if (!agent && !model) return
  return { agent, model, variant: info.model?.variant ?? null }
}
