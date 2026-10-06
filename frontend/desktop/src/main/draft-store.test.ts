import { expect, test } from "bun:test"

// The draft store is built on `node:sqlite`, which ships with Electron's Node
// but not with the bun runtime used to run this suite. Import it dynamically so
// the file still loads here, and skip the test where the module is unavailable
// rather than failing the suite on a runtime-capability gap.
let createDesktopDraftStore: typeof import("./draft-store").createDesktopDraftStore | undefined
try {
  ;({ createDesktopDraftStore } = await import("./draft-store"))
} catch {
  createDesktopDraftStore = undefined
}

const it = createDesktopDraftStore ? test : test.skip

it("flushes the latest buffered draft and stores blobs", () => {
  const store = createDesktopDraftStore!(":memory:")
  store.set("prompt", "first")
  store.set("prompt", "latest")
  expect(store.get("prompt")).toBe("latest")
  store.flush()
  expect(store.get("prompt")).toBe("latest")

  const bytes = new TextEncoder().encode("image")
  const id = store.putBlob(bytes)
  expect(store.getBlob(id)).toEqual(bytes)
  store.close()
})
