import { createContext, useContext, useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { AppTransport } from "../app/transport"
import type { ChatStore } from "../app/store"

export interface GuiBundle {
  transport: AppTransport
  store: ChatStore
}

export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

export const GuiContext = createContext<GuiBundle | null>(null)

export function useGui(): GuiBundle {
  const value = useContext(GuiContext)
  if (value === null) throw new Error("useGui outside GuiContext")
  return value
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function useSessions(search: string) {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["sessions", search],
    enabled: transport.client !== undefined,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const page = await transport.client!.sessions.list(
        { limit: 30, order: "desc", ...(search.length > 0 ? { search } : {}) },
        { signal },
      )
      return page.data
    },
  })
}

export function useActiveSessions() {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["sessions-active"],
    enabled: transport.client !== undefined,
    refetchInterval: 10_000,
    queryFn: async ({ signal }) => transport.client!.sessions.active({ signal }),
  })
}

export function useSessionInfo(sessionID: string | undefined) {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["session", sessionID],
    enabled: transport.client !== undefined && sessionID !== undefined,
    queryFn: async ({ signal }) => transport.client!.sessions.get({ sessionID: sessionID as string }, { signal }),
  })
}

export function useModelCatalog() {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["models"],
    enabled: transport.client !== undefined,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      (await transport.client!.models.list(locArg(transport), { signal })).data,
  })
}

export function useAgentCatalog() {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["agents"],
    enabled: transport.client !== undefined,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      (await transport.client!.agents.list(locArg(transport), { signal })).data,
  })
}

export function useIntegrations() {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["integrations"],
    enabled: transport.client !== undefined,
    queryFn: async ({ signal }) =>
      (await transport.client!.integrations.list(locArg(transport), { signal })).data,
  })
}

export function useIntegrationAttempt(attemptID: string | undefined) {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["integration-attempt", attemptID],
    enabled: transport.client !== undefined && attemptID !== undefined,
    refetchInterval: 2000,
    queryFn: async ({ signal }) =>
      (await transport.client!.integrations.attemptStatus({ attemptID: attemptID as string }, { signal })).data,
  })
}

function locArg(transport: { directory?: string }): { location: { directory: string } } | undefined {
  return transport.directory === undefined ? undefined : { location: { directory: transport.directory } }
}

export interface FileHit {
  path: string
  type: "file" | "directory"
}

export function useFileFind(query: string, enabled: boolean) {
  const { transport } = useGui()
  return useQuery({
    queryKey: ["fs-find", query, transport.directory ?? ""],
    enabled: enabled && transport.client !== undefined && query.length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const result = await transport.client!.files.find(
        { query, type: "file", limit: 30, ...(transport.directory === undefined ? {} : { location: { directory: transport.directory } }) },
        { signal },
      )
      const rows: FileHit[] = (result as unknown as { data?: FileHit[] }).data ?? (result as unknown as FileHit[])
      return rows
    },
  })
}

export function timeAgo(millis: number, now = Date.now()): string {
  const diff = Math.max(0, now - millis)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(millis).toLocaleDateString()
}
