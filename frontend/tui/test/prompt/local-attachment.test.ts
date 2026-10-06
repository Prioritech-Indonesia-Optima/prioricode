import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readLocalAttachment, readLocalAttachmentWith } from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"

function bmpBytes() {
  const bmp = Buffer.alloc(54 + 4)
  bmp.write("BM", 0)
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(1, 18)
  bmp.writeInt32LE(1, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  return bmp
}

async function withFile<T>(name: string, bytes: Uint8Array, run: (file: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), "prioricode-local-attachment-"))
  const file = path.join(dir, name)
  try {
    await writeFile(file, bytes)
    return await run(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function files(input: { mime: string; text?: string; bytes?: Uint8Array }): LocalFiles {
  return {
    mime: async () => input.mime,
    readText: async () => input.text ?? "",
    readBytes: async () => input.bytes ?? new Uint8Array(),
  }
}

describe("prompt local attachments", () => {
  test("reads SVG attachments as text", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")).toEqual({
      type: "text",
      mime: "image/svg+xml",
      content: "<svg />",
    })
  })

  test("reads image and PDF attachments as bytes", async () => {
    const content = new Uint8Array([1, 2, 3])
    expect(await readLocalAttachmentWith(files({ mime: "application/pdf", bytes: content }), "/tmp/file.pdf")).toEqual({
      type: "binary",
      mime: "application/pdf",
      content,
    })
  })

  test("attached .bmp copied files resolve by extension; .tif stays plain text", async () => {
    const attachment = await withFile("shot.bmp", bmpBytes(), readLocalAttachment)
    expect(attachment?.type).toBe("binary")
    if (attachment?.type === "binary") expect(attachment.mime).toBe("image/bmp")
    expect(await withFile("scan.tif", bmpBytes(), readLocalAttachment)).toBeUndefined()
  })

  test("ignores unsupported and unreadable local files", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "text/plain" }), "/tmp/file.txt")).toBeUndefined()
    expect(
      await readLocalAttachmentWith(
        {
          ...files({ mime: "image/png" }),
          readBytes: async () => Promise.reject(new Error("missing")),
        },
        "/tmp/missing.png",
      ),
    ).toBeUndefined()
  })
})
