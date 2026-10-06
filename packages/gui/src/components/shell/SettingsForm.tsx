import { useState } from "react"
import { readStoredTarget, writeStoredTarget } from "../../app/transport"

export function SettingsForm(props: { onSaved: () => void }) {
  const stored = readStoredTarget()
  const [baseUrl, setBaseUrl] = useState(stored?.baseUrl ?? "")
  const [password, setPassword] = useState(stored?.password ?? "")
  const [directory, setDirectory] = useState(stored?.directory ?? "")
  return (
    <form
      className="grid gap-2 rounded-md border border-border bg-card p-3 text-xs"
      onSubmit={(event) => {
        event.preventDefault()
        writeStoredTarget({
          baseUrl: baseUrl.trim(),
          password: password.length > 0 ? password : undefined,
          directory: directory.trim().length > 0 ? directory.trim() : undefined,
        })
        props.onSaved()
      }}
    >
      <label className="grid gap-1">
        <span className="text-muted-foreground">Server URL</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://127.0.0.1:4096"
          className="rounded border border-input bg-background px-2 py-1 text-foreground"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">Project directory</span>
        <input
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="/absolute/path/to/your/project"
          className="rounded border border-input bg-background px-2 py-1 text-foreground"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">Password (leave empty if server is unauthenticated)</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-input bg-background px-2 py-1 text-foreground"
        />
      </label>
      <button type="submit" className="justify-self-start rounded bg-primary px-3 py-1 text-primary-foreground">
        Save &amp; connect
      </button>
    </form>
  )
}
