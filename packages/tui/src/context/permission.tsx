import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { useArgs } from "./args"
import { useRoute } from "./route"

export type PermissionMode = "default" | "ask-first" | "always-allow"

const ORDER: PermissionMode[] = ["default", "ask-first", "always-allow"]

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const args = useArgs()
    const route = useRoute()

    const currentSessionID = createMemo(() =>
      route.data.type === "session" ? route.data.sessionID : undefined,
    )

    const current = createMemo<PermissionMode>(() => {
      const id = currentSessionID()
      if (!id) return "default"
      return sync.data.session.find((session) => session.id === id)?.permissionMode ?? "default"
    })

    function set(mode: PermissionMode) {
      const id = currentSessionID()
      if (!id) return
      void sdk.client.session.update({ sessionID: id, permissionMode: mode })
    }

    if (args.auto) {
      const applied = new Set<string>()
      createEffect(() => {
        const id = currentSessionID()
        if (!id || applied.has(id)) return
        const session = sync.data.session.find((item) => item.id === id)
        if (!session) return
        if (session.permissionMode !== undefined && session.permissionMode !== null) return
        applied.add(id)
        set("always-allow")
      })
    }

    return {
      get mode() {
        return current()
      },
      set,
      cycle() {
        set(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length])
      },
    }
  },
})
