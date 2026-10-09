import { nativeT } from "../native-translations"

export function isValidSshAlias(value: string) {
  if (!value) return false
  if (value !== value.trim()) return false
  if (value.startsWith("-")) return false
  if (/\s/.test(value)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  return value.length <= 512
}

const PATTERNS: Array<{ test: RegExp; key: Parameters<typeof nativeT>[0] }> = [
  {
    test: /Permission denied \(publickey|Too many authentication failures|no supported authentication methods|Received disconnect.*No supported authentication/i,
    key: "desktop.ssh.error.authDenied",
  },
  {
    test: /Could not resolve hostname|Name or service not known|nodename nor servname provided|Temporary failure in name resolution/i,
    key: "desktop.ssh.error.hostUnresolved",
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|offering a different key/i,
    key: "desktop.ssh.error.hostKeyChanged",
  },
  {
    test: /Connection timed out|Connection refused|Network is unreachable|No route to host|Connection closed by/i,
    key: "desktop.ssh.error.unreachable",
  },
]

export function isForeignForwardFailure(output: string) {
  return /remote port forwarding failed for listen port/i.test(output)
}

export function isLocalBindFailure(output: string) {
  return /cannot listen to port: \d+|bind \[127\.0\.0\.1\]:\d+:|local port forwarding failed/i.test(output)
}

export function sshBootstrapCodeOf(error: unknown): string | null {
  if (error instanceof Error) {
    const code = (error as unknown as { sshBootstrapCode?: unknown }).sshBootstrapCode
    if (typeof code === "string") return code
  }
  return null
}

export function classifySshFailure(output: string, alias: string, code: number | null) {
  for (const pattern of PATTERNS) {
    if (pattern.test.test(output)) return nativeT(pattern.key, { host: alias })
  }
  return nativeT("desktop.ssh.error.probeFailed", { host: alias, code: code ?? "null" })
}
