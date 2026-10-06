export * from "./client.js"
export * from "./server.js"

import { createPrioricodeClient } from "./client.js"
import { createPrioricodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createPrioricode(options?: ServerOptions) {
  const server = await createPrioricodeServer({
    ...options,
  })

  const client = createPrioricodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
