import { createContext, For, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { selectedForeground, useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "./border"
import { TextAttributes } from "@opentui/core"

export type ToastAction = {
  label: string
  run: () => void
}

export type ToastOptions = {
  id: number
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
  action?: ToastAction
}
type ToastInput = Omit<ToastOptions, "duration" | "id"> & { duration?: number }

const TOAST_STACK_LIMIT = 4

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.queue().length > 0}>
      <box
        position="absolute"
        flexDirection="column"
        alignItems="flex-start"
        gap={1}
        top={2}
        right={2}
        maxWidth={Math.max(1, Math.min(60, dimensions().width - 6))}
        zIndex={4000}
      >
        <For each={toast.queue()}>
          {(current) => (
            <box
              flexDirection="column"
              justifyContent="center"
              alignItems="flex-start"
              width="100%"
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={theme.backgroundPanel}
              borderColor={theme[current.variant]}
              border={["left", "right"]}
              customBorderChars={SplitBorder.customBorderChars}
              onMouseUp={() => toast.dismiss(current.id)}
            >
              <Show when={current.title}>
                <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
                  {current.title}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" width="100%">
                {current.message}
              </text>
              <Show when={current.action}>
                {(action) => (
                  <box
                    marginTop={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme[current.variant]}
                    onMouseUp={(event) => {
                      event.stopPropagation()
                      toast.dismiss(current.id)
                      action().run()
                    }}
                  >
                    <text fg={selectedForeground(theme, theme[current.variant])} attributes={TextAttributes.BOLD}>
                      {action().label}
                    </text>
                  </box>
                )}
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    queue: [] as ToastOptions[],
  })

  const timers = new Map<number, NodeJS.Timeout>()
  let nextId = 1

  function remove(id: number) {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    const index = store.queue.findIndex((item) => item.id === id)
    if (index !== -1) setStore("queue", (items) => items.filter((item) => item.id !== id))
  }

  const toast = {
    show(options: ToastInput) {
      const id = nextId++
      const item: ToastOptions = { ...options, id, duration: options.duration ?? 5000 }
      setStore("queue", (queue) => {
        const next = [...queue, item]
        const dropped = next.slice(Math.max(0, next.length - TOAST_STACK_LIMIT))
        for (const stale of queue) {
          if (!dropped.some((kept) => kept.id === stale.id)) {
            const timer = timers.get(stale.id)
            if (timer) {
              clearTimeout(timer)
              timers.delete(stale.id)
            }
          }
        }
        return dropped
      })
      timers.set(
        id,
        setTimeout(() => {
          remove(id)
        }, item.duration).unref(),
      )
      return id
    },
    dismiss(id?: number) {
      const target = id ?? store.queue[store.queue.length - 1]?.id
      if (target === undefined) return
      remove(target)
    },
    queue(): ToastOptions[] {
      return store.queue
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    clear() {
      for (const id of [...timers.keys()]) remove(id)
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
