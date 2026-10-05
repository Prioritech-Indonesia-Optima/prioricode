import { detectHost } from "./lib/host"

export function App() {
  const host = detectHost()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">PrioriCode</h1>
      <p className="text-muted-foreground">
        GUI shell running in the <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{host}</code> host.
      </p>
    </div>
  )
}
