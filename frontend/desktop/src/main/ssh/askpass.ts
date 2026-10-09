import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type AskpassSession = {
  env: Record<string, string>
  dispose: () => Promise<void>
}

const PROMPT_TIMEOUT_MS = 120_000

const POSIX_HELPER = `#!/bin/sh
D="$PRIORICODE_ASKPASS_DIR"
printf '%s' "$1" > "$D/request"
i=0
while [ ! -f "$D/response" ]; do
  i=$((i+1))
  [ "$i" -gt 480 ] && exit 1
  sleep 0.25
done
cat "$D/response"
printf '\\n'
rm -f "$D/response"
exit 0
`

const WIN_HELPER = `@echo off
setlocal enabledelayedexpansion
<nul set /p ="%~1"> "%PRIORICODE_ASKPASS_DIR%\\request"
:wait
if exist "%PRIORICODE_ASKPASS_DIR%\\response" goto respond
ping -n 1 -w 250 127.0.0.1 >nul
goto wait
:respond
type "%PRIORICODE_ASKPASS_DIR%\\response"
echo.
del "%PRIORICODE_ASKPASS_DIR%\\response"
endlocal
`

export async function createAskpassSession(
  onPrompt: (prompt: string) => Promise<string | null>,
): Promise<AskpassSession> {
  const dir = await mkdtemp(join(tmpdir(), "prioricode-askpass-"))
  const isWin = process.platform === "win32"
  const helper = join(dir, isWin ? "askpass.bat" : "askpass.sh")
  await writeFile(helper, isWin ? WIN_HELPER : POSIX_HELPER, { mode: 0o700 })
  if (!isWin) await chmod(helper, 0o700)
  const request = join(dir, "request")
  const response = join(dir, "response")

  let disposed = false
  let pending: Promise<unknown> = Promise.resolve()
  let lastRequest: string | null = null

  const handle = async () => {
    const text = await readFileText(request)
    if (text === null || text === lastRequest) return
    lastRequest = text
    const answer = await Promise.race([
      onPrompt(text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMPT_TIMEOUT_MS)),
    ])
    if (disposed) return
    await writeFile(response, answer ?? "", { mode: 0o600 })
    await rm(request, { force: true })
    lastRequest = null
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dir, () => {
      if (disposed) return
      pending = pending.then(handle).catch(() => undefined)
    })
  } catch {
    watcher = undefined
  }
  const poll = setInterval(() => {
    if (disposed) return
    pending = pending.then(handle).catch(() => undefined)
  }, 500)

  return {
    env: {
      SSH_ASKPASS: helper,
      SSH_ASKPASS_REQUIRE: "force",
      PRIORICODE_ASKPASS_DIR: dir,
    },
    dispose: async () => {
      disposed = true
      clearInterval(poll)
      watcher?.close()
      await pending.catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function readFileText(path: string) {
  try {
    return await (await import("node:fs/promises")).readFile(path, "utf8")
  } catch {
    return null
  }
}

type AuthPromptHandler = (prompt: string) => Promise<string | null>

let globalHandler: AuthPromptHandler = async () => null

export function setGlobalAuthPromptHandler(handler: AuthPromptHandler) {
  globalHandler = handler
}

export function requestAuthPrompt(prompt: string) {
  return globalHandler(prompt)
}
