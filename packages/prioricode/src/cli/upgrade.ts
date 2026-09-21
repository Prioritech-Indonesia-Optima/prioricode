import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@prioricode/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@prioricode/core/installation/version"
import { GlobalBus } from "@/bus/global"
import semver from "semver"

function notify(latest: string) {
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Installation.Event.UpdateAvailable.type,
      properties: { version: latest },
    },
  })
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.PRIORICODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.PRIORICODE_ALWAYS_NOTIFY_UPDATE) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  // Strictly-greater check (not string equality): a stale registry/channel
  // can hand us an *older* version, and getReleaseType treats anything that
  // isn't a major/minor bump as "patch" — which used to silently "upgrade"
  // downward. Unparseable versions are left to the manual command only.
  if (!semver.valid(InstallationVersion) || !semver.valid(latest) || !semver.gt(latest, InstallationVersion)) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    notify(latest)
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    // A silent background failure used to vanish without a trace; fall back to
    // the interactive update prompt so the user sees it and can retry manually.
    .catch(() => notify(latest))
}
