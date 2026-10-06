import { shellEscape } from "../wsl/runtime"

export const SSH_BOOTSTRAP_MARKER = "PRIORICODE_SSH_BOOTSTRAP"
export const SSH_BOOTSTRAP_ERROR_MARKER = "PRIORICODE_SSH_BOOTSTRAP_ERROR"

export type SshBootstrapResult = {
  port: number
  version: string
  password: string
  reused: boolean
}

export type SshBootstrapError = {
  code: string
}

const BASE_ARGS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]

export function sshBaseArgs() {
  return [...BASE_ARGS]
}

export function probeArgs(alias: string) {
  return [...BASE_ARGS, alias, "true"]
}

export function bootstrapArgs(alias: string) {
  return [...BASE_ARGS, alias, "sh", "-s"]
}

export function stopArgs(alias: string) {
  return [...BASE_ARGS, alias, "sh", "-s"]
}

export function installArgs(alias: string, version: string) {
  return [
    ...BASE_ARGS,
    alias,
    "bash",
    "-lc",
    `curl -fsSL https://prioricode.ai/install | bash -s -- --version ${shellEscape(version)}`,
  ]
}

export function tunnelArgs(alias: string, localPort: number, remotePort: number) {
  return [
    ...BASE_ARGS,
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    alias,
  ]
}

export function bootstrapScript(password: string) {
  const escaped = shellEscape(password)
  return [
    "set -eu",
    'D="$HOME/.prioricode/ssh"',
    `ERR='${SSH_BOOTSTRAP_ERROR_MARKER}'`,
    'mkdir -p "$D"',
    "umask 077",
    "I=0",
    'while [ "$I" -lt 200 ]; do',
    '  if mkdir "$D/lock" 2>/dev/null; then break; fi',
    "  I=$((I+1)); sleep 0.25",
    "done",
    'if [ "$I" -ge 200 ]; then',
    '  rmdir "$D/lock" 2>/dev/null || true',
    `  mkdir "$D/lock" 2>/dev/null || { echo "$ERR busy"; exit 6; }`,
    "fi",
    `trap 'rmdir "$D/lock" 2>/dev/null || true' EXIT`,
    'BIN=""',
    'for c in "$HOME/.prioricode/bin/prioricode" "$HOME/.local/bin/prioricode" "$HOME/bin/prioricode" "/usr/local/bin/prioricode"; do',
    '  if [ -x "$c" ]; then BIN="$c"; break; fi',
    "done",
    'if [ -z "$BIN" ] && command -v prioricode >/dev/null 2>&1; then BIN="$(command -v prioricode)"; fi',
    `if [ -z "$BIN" ]; then echo "$ERR missing_binary"; exit 3; fi`,
    'V="$("$BIN" --version 2>/dev/null | sed -n \'1p\' || true)"',
    `V="$(printf '%s' "$V" | tr -cd 'A-Za-z0-9._+-')"`,
    'P=""',
    'if [ -f "$D/pid" ] && [ -f "$D/password" ] && kill -0 "$(cat "$D/pid")" 2>/dev/null; then',
    '  if [ -f "$D/port" ]; then P="$(cat "$D/port")"; fi',
    `  case "$P" in ''|*[!0-9]*) P="" ;; esac`,
    "  J=0",
    '  while [ -z "$P" ] && [ "$J" -lt 300 ]; do',
    `    X="$(sed -n 's|.*listening on https\\?://||p' "$D/log" 2>/dev/null | tail -n 1)"`,
    '    if [ -n "$X" ]; then',
    '      C="${X##*:}"',
    '      case "$C" in *[!0-9]*) C="" ;; esac',
    '      P="$C"',
    "    fi",
    '    [ -n "$P" ] && break',
    "    J=$((J+1)); sleep 0.1",
    "  done",
    '  if [ -n "$P" ]; then',
    '    PW="$(cat "$D/password")"',
    `    printf '${SSH_BOOTSTRAP_MARKER} {"port":%s,"version":"%s","password":"%s","reused":true}\n' "$P" "$V" "$PW"`,
    "    exit 0",
    "  fi",
    '  kill "$(cat "$D/pid")" 2>/dev/null || true',
    "fi",
    `PW=${escaped}`,
    'printf "%s" "$PW" > "$D/password"',
    ': > "$D/log"',
    'PRIORICODE_SERVER_USERNAME=prioricode PRIORICODE_SERVER_PASSWORD="$PW" PRIORICODE_CLIENT=desktop nohup "$BIN" --print-logs --log-level WARN serve --hostname 127.0.0.1 --port 0 >>"$D/log" 2>&1 &',
    'echo $! > "$D/pid"',
    "I=0",
    'P=""',
    'H=""',
    'while [ "$I" -lt 300 ]; do',
    `  X="$(sed -n 's|.*listening on https\\?://||p' "$D/log" 2>/dev/null | tail -n 1)"`,
    '  if [ -n "$X" ]; then',
    '    H="${X%%:*}"',
    '    C="${X##*:}"',
    '    case "$C" in *[!0-9]*) C="" ;; esac',
    '    if [ -n "$C" ]; then P="$C"; break; fi',
    "  fi",
    "  I=$((I+1))",
    "  sleep 0.1",
    "done",
    `if [ -z "$P" ]; then echo "$ERR no_port"; tail -n 20 "$D/log" 2>/dev/null || true; exit 5; fi`,
    `case "$H" in 127.0.0.1|localhost|\[::1\]) ;; *) kill "$(cat "$D/pid")" 2>/dev/null || true; echo "$ERR insecure_bind $H:$P"; exit 7 ;; esac`,
    'printf "%s" "$P" > "$D/port"',
    `printf '${SSH_BOOTSTRAP_MARKER} {"port":%s,"version":"%s","password":"%s","reused":false}\n' "$P" "$V" "$PW"`,
    "",
  ].join("\n")
}

export function stopScript() {
  return [
    "set -eu",
    'D="$HOME/.prioricode/ssh"',
    'if [ -f "$D/pid" ]; then kill "$(cat "$D/pid")" 2>/dev/null || true; fi',
    'rm -f "$D/pid" "$D/port" "$D/password"',
    "",
  ].join("\n")
}

export const SSH_CHECK_MARKER = "PRIORICODE_SSH_CHECK"

const BINARY_CANDIDATES = [
  '"$HOME/.prioricode/bin/prioricode"',
  '"$HOME/.local/bin/prioricode"',
  '"$HOME/bin/prioricode"',
  '"/usr/local/bin/prioricode"',
]

function binaryProbeLines() {
  return [
    'BIN=""',
    `for c in ${BINARY_CANDIDATES.join(" ")}; do`,
    '  if [ -x "$c" ]; then BIN="$c"; break; fi',
    "done",
    'if [ -z "$BIN" ] && command -v prioricode >/dev/null 2>&1; then BIN="$(command -v prioricode)"; fi',
    `if [ -z "$BIN" ]; then echo '${SSH_BOOTSTRAP_ERROR_MARKER} missing_binary'; exit 3; fi`,
  ]
}

export function checkArgs(alias: string) {
  return [...BASE_ARGS, alias, "sh", "-s"]
}

export function checkScript() {
  return [
    "set -eu",
    ...binaryProbeLines(),
    'V="$("$BIN" --version 2>/dev/null | sed -n \'1p\' || true)"',
    `V="$(printf '%s' "$V" | tr -cd 'A-Za-z0-9._+-')"`,
    `P="$(printf '%s' "$BIN" | tr -cd 'A-Za-z0-9._/+-')"`,
    `printf '${SSH_CHECK_MARKER} {"version":"%s","path":"%s"}\\n' "$V" "$P"`,
    "",
  ].join("\n")
}

export type SshCheckResult = { version: string; path: string } | { code: string }

export function parseCheckMarker(output: string): SshCheckResult {
  for (const line of output.split(/\r?\n/)) {
    const error = line.indexOf(`${SSH_BOOTSTRAP_ERROR_MARKER} `)
    if (error !== -1) return { code: line.slice(error + SSH_BOOTSTRAP_ERROR_MARKER.length + 1).trim() || "unknown" }
    const marker = line.indexOf(`${SSH_CHECK_MARKER} `)
    if (marker === -1) continue
    try {
      const value = JSON.parse(line.slice(marker + SSH_CHECK_MARKER.length + 1)) as Record<string, unknown>
      if (typeof value.path !== "string" || !value.path) return { code: "bad_marker" }
      return { version: typeof value.version === "string" ? value.version : "", path: value.path }
    } catch {
      return { code: "bad_marker" }
    }
  }
  return { code: "no_marker" }
}

export function parseBootstrapMarker(output: string): SshBootstrapResult | SshBootstrapError {
  for (const line of output.split(/\r?\n/)) {
    const error = line.indexOf(`${SSH_BOOTSTRAP_ERROR_MARKER} `)
    if (error !== -1) return { code: line.slice(error + SSH_BOOTSTRAP_ERROR_MARKER.length + 1).trim() || "unknown" }
    const marker = line.indexOf(`${SSH_BOOTSTRAP_MARKER} `)
    if (marker === -1) continue
    try {
      const value = JSON.parse(line.slice(marker + SSH_BOOTSTRAP_MARKER.length + 1)) as Record<string, unknown>
      const port = typeof value.port === "number" && Number.isInteger(value.port) ? value.port : null
      const password = typeof value.password === "string" ? value.password : null
      if (!port || port < 1 || port > 65535 || !password) return { code: "bad_marker" }
      return {
        port,
        version: typeof value.version === "string" ? value.version : "",
        password,
        reused: value.reused === true,
      }
    } catch {
      return { code: "bad_marker" }
    }
  }
  return { code: "no_marker" }
}

const LISTENING_REGEX = /listening on https?:\/\/([^:/\s]+):(\d+)/

export function parseListeningLine(text: string): { hostname: string; port: number } | null {
  for (const line of text.split(/\r?\n/)) {
    const match = LISTENING_REGEX.exec(line)
    if (!match) continue
    return { hostname: match[1]!, port: Number.parseInt(match[2]!, 10) }
  }
  return null
}
