import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { useKV } from "./kv"
import { createSimpleContext } from "./helper"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const kv = useKV()
    const [store, setStore] = createStore<{ mode: PermissionMode; touched: boolean }>({
      mode: "normal",
      touched: false,
    })

    createEffect(() => {
      if (store.touched || !kv.ready) return
      const persisted: PermissionMode = args.auto ? "auto" : kv.get("permission_mode") === "auto" ? "auto" : "normal"
      setStore("mode", persisted)
    })

    function commit(mode: PermissionMode) {
      setStore({ mode, touched: true })
      kv.set("permission_mode", mode)
    }

    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        commit(mode)
      },
      toggle() {
        commit(store.mode === "auto" ? "normal" : "auto")
      },
    }
  },
})
