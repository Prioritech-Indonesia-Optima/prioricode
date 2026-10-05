import { useEffect, useMemo, useState } from "react"
import { Dialog } from "radix-ui"
import { useQueryClient } from "@tanstack/react-query"
import { useGui, useIntegrationAttempt, useIntegrations } from "../../react/queries"
import { clientErrorMessage } from "../../core/transport/errors"
import { SettingsForm } from "./SettingsForm"

interface ActiveAttempt {
  attemptID: string
  url: string
  instructions: string
  mode: "auto" | "code"
}

export function ServerDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-sm font-semibold">PrioriCode server &amp; providers</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            Connect model providers and adjust how this GUI reaches the PrioriCode server.
          </Dialog.Description>
          <div className="mt-3 grid gap-4">
            <ProvidersSection />
            <ServerSection />
          </div>
          <Dialog.Close className="mt-4 rounded border border-border px-3 py-1 text-xs hover:bg-accent">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ServerSection() {
  const { transport } = useGui()
  if (transport.kind === "web") {
    return (
      <div className="grid gap-2">
        <div className="text-xs font-medium uppercase text-muted-foreground">Connection</div>
        <SettingsForm onSaved={() => globalThis.location.reload()} />
      </div>
    )
  }
  return (
    <div className="text-xs text-muted-foreground">
      Connection is managed by the PrioriCode VS Code extension (daemon discovery or <code>prioricode.serverUrl</code>).
    </div>
  )
}

function ProvidersSection() {
  const { transport } = useGui()
  const integrations = useIntegrations()
  const items = useMemo(() => integrations.data ?? [], [integrations.data])
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">Providers</div>
      {integrations.isPending && <div className="text-xs text-muted-foreground">Loading providers…</div>}
      {items.length === 0 && !integrations.isPending && <div className="text-xs text-muted-foreground">No integrations published.</div>}
      {items.map((integration) => (
        <div key={integration.id} className="rounded border border-border p-2">
          <div className="text-xs font-medium">{integration.name}</div>
          <div className="mt-1 grid gap-2">
            {integration.methods.map((method) => (
              <MethodRow key={`${method.type}:${"id" in method ? method.id : ""}`} integrationID={integration.id} method={method} />
            ))}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-muted-foreground">{transport.statusDetail ?? ""}</div>
    </div>
  )
}

type IntegrationMethod = NonNullable<ReturnType<typeof useIntegrations>["data"]>[number]["methods"][number]

function MethodRow(props: { integrationID: string; method: IntegrationMethod }) {
  const { transport } = useGui()
  const queryClient = useQueryClient()
  const [keyValue, setKeyValue] = useState("")
  const [message, setMessage] = useState<string | undefined>()
  const [attempt, setAttempt] = useState<ActiveAttempt | undefined>()
  const [promptInputs, setPromptInputs] = useState<Record<string, string>>({})
  const attemptStatus = useIntegrationAttempt(attempt?.attemptID)

  useEffect(() => {
    const status = attemptStatus.data?.status
    if (status === undefined) return
    if (status === "complete") {
      setAttempt(undefined)
      setMessage("Connected.")
      void queryClient.invalidateQueries({ queryKey: ["models"] })
      void queryClient.invalidateQueries({ queryKey: ["integrations"] })
    }
    if (status === "failed") {
      setAttempt(undefined)
      setMessage(`Failed: ${(attemptStatus.data as { message?: string }).message ?? "unknown"}`)
    }
    if (status === "expired") {
      setAttempt(undefined)
      setMessage("Attempt expired.")
    }
  }, [attemptStatus.data, queryClient])

  if (props.method.type === "env") {
    return (
      <div className="text-[11px] text-muted-foreground">
        Available via environment: <bdi dir="ltr">{props.method.names.join(", ")}</bdi>
      </div>
    )
  }

  if (props.method.type === "key") {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={async (event) => {
          event.preventDefault()
          if (transport.client === undefined || keyValue.trim().length === 0) return
          try {
            await transport.client.integrations.connectKey({ integrationID: props.integrationID, key: keyValue.trim() })
            setKeyValue("")
            setMessage("Key saved.")
            void queryClient.invalidateQueries({ queryKey: ["models"] })
          } catch (error) {
            setMessage(clientErrorMessage(error))
          }
        }}
      >
        <input
          type="password"
          value={keyValue}
          onChange={(event) => setKeyValue(event.target.value)}
          placeholder={`${props.method.label ?? "API key"}`}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
        />
        <button type="submit" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
          Save
        </button>
      </form>
    )
  }

  const method = props.method
  const prompts = method.prompts ?? []
  const needsPrompts = prompts.length > 0
  const ready = prompts.every((prompt) => prompt.type !== "text" || (promptInputs[prompt.key]?.length ?? 0) > 0)

  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium">{method.label}</div>
      {needsPrompts && (
        <div className="grid gap-1">
          {prompts.map((prompt) =>
            prompt.type === "text" ? (
              <input
                key={prompt.key}
                value={promptInputs[prompt.key] ?? ""}
                onChange={(event) => setPromptInputs((current) => ({ ...current, [prompt.key]: event.target.value }))}
                placeholder={prompt.placeholder ?? prompt.message}
                className="rounded border border-input bg-background px-2 py-1 text-xs"
              />
            ) : (
              <select
                key={prompt.key}
                value={promptInputs[prompt.key] ?? ""}
                onChange={(event) => setPromptInputs((current) => ({ ...current, [prompt.key]: event.target.value }))}
                className="rounded border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="">Select…</option>
                {prompt.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ),
          )}
        </div>
      )}
      {attempt === undefined ? (
        <button
          type="button"
          disabled={transport.client === undefined || !ready}
          className="justify-self-start rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          onClick={async () => {
            if (transport.client === undefined) return
            try {
              const result = await transport.client.integrations.connectOauth({
                integrationID: props.integrationID,
                methodID: method.id,
                inputs: promptInputs,
              })
              const data = result.data
              setAttempt({ attemptID: data.attemptID, url: data.url, instructions: data.instructions, mode: data.mode })
              transport.openExternal(data.url)
            } catch (error) {
              setMessage(clientErrorMessage(error))
            }
          }}
        >
          Connect
        </button>
      ) : (
        <div className="grid gap-1 text-[11px]">
          <div className="text-muted-foreground">{attempt.instructions}</div>
          <button type="button" className="justify-self-start rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => transport.openExternal(attempt.url)}>
            Open sign-in URL again
          </button>
          {attempt.mode === "code" && <CodeAttemptForm attempt={attempt} onDone={(note) => setMessage(note)} />}
          <div>{attemptStatus.data?.status === "pending" ? "Waiting for authorization…" : ""}</div>
        </div>
      )}
      {message !== undefined && <div className="text-[11px] text-muted-foreground">{message}</div>}
    </div>
  )
}

function CodeAttemptForm(props: { attempt: ActiveAttempt; onDone: (note: string) => void }) {
  const { transport } = useGui()
  const [code, setCode] = useState("")
  return (
    <form
      className="flex gap-1"
      onSubmit={async (event) => {
        event.preventDefault()
        if (transport.client === undefined || code.trim().length === 0) return
        try {
          await transport.client.integrations.attemptComplete({ attemptID: props.attempt.attemptID, code: code.trim() })
          props.onDone("Code accepted; finishing…")
        } catch (error) {
          props.onDone(clientErrorMessage(error))
        }
      }}
    >
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Paste authorization code"
        className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
      />
      <button type="submit" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
        Submit
      </button>
    </form>
  )
}
