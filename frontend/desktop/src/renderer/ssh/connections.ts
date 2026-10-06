import type { SshServersState } from "@prioricode/app/ssh/types"

export function readySshConnections(state?: SshServersState, label = "SSH") {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.alias,
        label,
        type: "ssh" as const,
        host: item.config.alias,
        http: {
          url: item.runtime.url,
          username: item.runtime.username ?? undefined,
          password: item.runtime.password ?? undefined,
        },
      },
    ]
  })
}

export function availableSshStartupServer(defaultServer: string | null | undefined, state?: SshServersState) {
  const key = defaultServer ?? "sidecar"
  if (!key.startsWith("ssh:")) return key
  if (state?.servers.some((item) => item.config.id === key && item.runtime.kind === "ready")) return key
  return "sidecar"
}
