import type { TuiPlugin, TuiPluginApi, TuiSidebarTodoItem } from "@prioricode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { TodoItem, TodoPhaseHeader } from "../../component/todo-item"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const [groups, setGroups] = createStore<Record<string, boolean>>({})
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  const phases = createMemo(() => {
    const out: { phase: string | undefined; items: TuiSidebarTodoItem[] }[] = []
    for (const item of list()) {
      const last = out[out.length - 1]
      if (last && last.phase === item.phase) last.items.push(item)
      else out.push({ phase: item.phase, items: [item] })
    }
    return out
  })

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={phases()}>
            {(group) => (
              <box>
                <Show when={group.phase}>
                  {(phase) => (
                    <box onMouseDown={() => setGroups(phase(), (value) => (value !== false ? false : true))}>
                      <TodoPhaseHeader
                        label={phase()}
                        done={group.items.filter((item) => item.status === "completed").length}
                        total={group.items.length}
                        open={groups[phase()] !== false}
                      />
                    </box>
                  )}
                </Show>
                <Show when={!group.phase || groups[group.phase] !== false}>
                  <For each={group.items}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
