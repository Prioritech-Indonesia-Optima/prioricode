import { DropdownMenu } from "radix-ui"
import { ChevronDown } from "lucide-react"
import { useGui, useAgentCatalog, useModelCatalog, type ModelRef } from "../../react/queries"

interface Current {
  agent?: string
  model?: ModelRef
}

export function AgentPicker(props: { current: Current }) {
  const { store } = useGui()
  const agents = useAgentCatalog()
  const visible = (agents.data ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
        <span className="max-w-[8rem] truncate">{props.current.agent ?? "agent"}</span>
        <ChevronDown size={12} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-50 min-w-[12rem] rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md">
          <DropdownMenu.Label className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Agent</DropdownMenu.Label>
          {visible.map((agent) => (
            <DropdownMenu.Item
              key={agent.id}
              onSelect={() => void store.setAgent(agent.id)}
              className="cursor-pointer rounded px-2 py-1 outline-none data-[highlighted]:bg-accent"
            >
              {agent.id}
              {agent.description !== undefined && (
                <span className="block truncate text-[10px] text-muted-foreground">{agent.description}</span>
              )}
            </DropdownMenu.Item>
          ))}
          {visible.length === 0 && <div className="px-2 py-1 text-muted-foreground">No agents listed.</div>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ModelPicker(props: { current: Current }) {
  const { store } = useGui()
  const models = useModelCatalog()
  const list = models.data ?? []
  const current = props.current.model
  const label =
    current === undefined
      ? "model"
      : (list.find((model) => model.id === current.id && model.providerID === current.providerID)?.name ??
        `${current.providerID}/${current.id}`)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
        <bdi dir="ltr" className="max-w-[10rem] truncate">
          {label}
        </bdi>
        <ChevronDown size={12} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-50 max-h-[24rem] min-w-[14rem] overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md">
          <DropdownMenu.Label className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Model</DropdownMenu.Label>
          {list.map((model) => (
            <DropdownMenu.Item
              key={`${model.providerID}/${model.id}`}
              onSelect={() => void store.setModel({ id: model.id, providerID: model.providerID })}
              className="cursor-pointer rounded px-2 py-1 outline-none data-[highlighted]:bg-accent"
            >
              <bdi dir="ltr">{model.name.length > 0 ? model.name : `${model.providerID}/${model.id}`}</bdi>
            </DropdownMenu.Item>
          ))}
          {list.length === 0 && <div className="px-2 py-1 text-muted-foreground">No models — connect a provider.</div>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
