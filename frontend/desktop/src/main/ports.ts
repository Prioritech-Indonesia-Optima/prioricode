import { createServer } from "node:net"
import { nativeT } from "./native-translations"

export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error(nativeT("desktop.wsl.error.failedPort")))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}
