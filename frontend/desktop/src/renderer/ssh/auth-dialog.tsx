import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@prioricode/app"

type AuthRequest = { requestId: string; prompt: string }

export function SshAuthPromptHost() {
  const language = useLanguage()
  const [current, setCurrent] = createSignal<AuthRequest | null>(null)
  const [value, setValue] = createSignal("")
  const queue: AuthRequest[] = []

  onMount(() => {
    const off = window.api.sshAuth.onPrompt((payload) => {
      if (current()) queue.push(payload)
      else {
        setCurrent(payload)
        setValue("")
      }
    })
    onCleanup(off)
  })

  const done = (answer: string | null) => {
    const item = current()
    if (!item) return
    void window.api.sshAuth.respond(item.requestId, answer)
    setCurrent(queue.shift() ?? null)
    setValue("")
  }

  return (
    <Show when={current()}>
      {(item) => (
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div class="w-[360px] rounded-xl border border-pc-border-base bg-pc-bg-base p-4 shadow-xl">
            <div class="mb-2 text-[13px] font-medium text-pc-text-base">{language.t("ssh.auth.title")}</div>
            <div class="mb-3 whitespace-pre-wrap text-[12px] text-pc-text-muted" dir="auto">
              {item().prompt}
            </div>
            <input
              type="password"
              class="mb-3 w-full rounded-md border border-pc-border-base bg-pc-bg-deep px-2 py-1.5 text-[13px] text-pc-text-base outline-none focus:border-pc-gold-600"
              value={value()}
              onInput={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") done(value())
              }}
              autofocus
            />
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-[12px] text-pc-text-muted"
                onClick={() => done(null)}
              >
                {language.t("ssh.auth.cancel")}
              </button>
              <button
                type="button"
                class="rounded-md bg-pc-gold-600 px-3 py-1.5 text-[12px] text-white"
                onClick={() => done(value())}
              >
                {language.t("ssh.auth.submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
