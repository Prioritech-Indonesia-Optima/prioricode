interface ImportMetaEnv {
  readonly PRIORICODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:prioricode-server" {
  export namespace Server {
    export const listen: typeof import("../../../prioricode/dist/types/src/node").Server.listen
    export type Listener = import("../../../prioricode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../prioricode/dist/types/src/node").Config.get
    export type Info = import("../../../prioricode/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../prioricode/dist/types/src/node").bootstrap
}
