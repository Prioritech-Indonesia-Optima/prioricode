import type { TuiPlugin, TuiPluginApi, TuiSidebarTodoItem } from "@prioricode/plugin/tui"
import { progress } from "@prioricode/core/session/todo-tree"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

const keyOf = (item: TuiSidebarTodoItem) => item.id ?? item.content

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const [closed, setClosed] = createStore<Record<string, boolean>>({})
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))

  // One row per item, positioned by its depth: parents collapse their subtree
  // and show step-level progress.
  const rows = createMemo(() =>
    list().map((item, index) => {
      const depth = item.depth ?? 0
      const next = list()[index + 1]
      const isParent = next !== undefined && (next.depth ?? 0) > depth
      let hidden = false
      for (let j = index - 1; j >= 0; j--) {
        const above = list()[j]!
        if ((above.depth ?? 0) < depth) {
          hidden = closed[keyOf(above)] === false
          break
        }
      }
      const value = isParent ? progress(list(), index) : undefined
      return {
        item,
        depth,
        isParent,
        hidden,
        isOpen: closed[keyOf(item)] !== false,
        done: value?.done ?? 0,
        total: value?.total ?? 0,
      }
    }),
  )

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
          <For each={rows()}>
            {(row) => (
              <Show when={!row.hidden}>
                {(_) => (
                  <box
                    flexDirection="row"
                    gap={0}
                    onMouseDown={
                      row.isParent
                        ? () => setClosed(keyOf(row.item), (value) => (value !== false ? false : true))
                        : undefined
                    }
                  >
                    <Show when={row.isParent}>
                      <text flexShrink={0} fg={theme().textMuted}>
                        {" ".repeat(row.depth * 2)}
                        {row.isOpen ? "▼" : "▶"}
                      </text>
                    </Show>
                    <TodoItem status={row.item.status} content={row.item.content} indent={row.depth * 2 + 2} />
                    <Show when={row.isParent}>
                      <text flexShrink={0} fg={theme().textMuted}>
                        {row.done}/{row.total}
                      </text>
                    </Show>
                  </box>
                )}
              </Show>
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
