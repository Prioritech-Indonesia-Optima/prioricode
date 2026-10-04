import type { SshHostProfile, SshPrioricodeCheck, SshServerRuntime } from "./types"

export const sshRuntimeRetryable = (runtime: SshServerRuntime) => runtime.kind === "failed" || runtime.kind === "stopped"

export function sshPrioricodeAction(check: SshPrioricodeCheck | undefined) {
  if (!check) return
  if (!check.resolvedPath) return "ssh.server.install"
  if (check.matchesDesktop === false) return "ssh.server.update"
}

export function sshHostMeta(profile: Pick<SshHostProfile, "alias" | "hostname" | "user" | "port">) {
  const host = profile.hostname && profile.hostname !== profile.alias ? profile.hostname : null
  const parts = [profile.user ? `${profile.user}@` : "", host ?? profile.alias, profile.port ? `:${profile.port}` : ""]
  return parts.join("")
}

export function sshServerIdFor(alias: string) {
  return `ssh:${alias}`
}
