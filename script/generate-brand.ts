import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { BILINEAR, createICNS, createICO } from "png2icons"

const ROOT = path.resolve(import.meta.dir, "..")
const SOURCE = path.join(ROOT, "branding/source/2026-lockup.png")
const INK = { r: 28, g: 27, b: 23 }
const BG_THRESHOLD = 32

// Measured on branding/source/2026-lockup.png (2000x2000), 8px padding:
//   stem x 444-645, chevron x 691-1552 y 282-1198, wordmark text y 1512-1676
const MARK = { left: 436, top: 274, width: 1124, height: 932 }
const WORD = { left: 436, top: 1504, width: 1117, height: 180 }
const LOCK = { left: 436, top: 274, width: 1124, height: 1410 }

const UWP = [30, 44, 71, 89, 107, 142, 150, 284, 310]

async function out(rel: string, data: Buffer | string) {
  const file = path.join(ROOT, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
  console.log("wrote", rel)
}

function floodBackground(raw: Uint8Array, w: number, h: number) {
  const mask = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (i: number) => {
    if (mask[i]) return
    const o = i * 4
    if (raw[o] >= BG_THRESHOLD || raw[o + 1] >= BG_THRESHOLD || raw[o + 2] >= BG_THRESHOLD) return
    mask[i] = 1
    stack[sp++] = i
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (sp) {
    const i = stack[--sp]
    const x = i % w
    const y = (i - x) / w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  return mask
}

function clearEnclosedWhiteCounters(raw: Uint8Array, w: number, h: number, mask: Uint8Array) {
  const visited = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const isBlack = (i: number) => {
    const o = i * 4
    return raw[o] < BG_THRESHOLD && raw[o + 1] < BG_THRESHOLD && raw[o + 2] < BG_THRESHOLD
  }
  const isWhite = (i: number) => {
    const o = i * 4
    return raw[o] > 200 && raw[o + 1] > 200 && raw[o + 2] > 200
  }
  for (let start = 0; start < w * h; start++) {
    if (visited[start] || mask[start] || !isBlack(start)) continue
    let sp = 0
    stack[sp++] = start
    visited[start] = 1
    const component: number[] = []
    let touchesAmber = false
    while (sp) {
      const i = stack[--sp]
      component.push(i)
      const x = i % w
      const y = (i - x) / w
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const n = ny * w + nx
        if (isBlack(n)) {
          if (!visited[n] && !mask[n]) {
            visited[n] = 1
            stack[sp++] = n
          }
          continue
        }
        if (!isWhite(n)) touchesAmber = true
      }
    }
    if (touchesAmber) continue
    for (const i of component) mask[i] = 1
  }
}

function toInk(raw: Uint8Array) {
  const copy = Uint8Array.from(raw)
  for (let i = 0; i < copy.length; i += 4) {
    if (copy[i] > 200 && copy[i + 1] > 200 && copy[i + 2] > 200 && copy[i + 3] > 0) {
      copy[i] = INK.r
      copy[i + 1] = INK.g
      copy[i + 2] = INK.b
    }
  }
  return copy
}

function png(raw: Uint8Array, w: number, h: number) {
  return sharp(Buffer.from(raw), { raw: { width: w, height: h, channels: 4 } })
}

function svgWrap(buf: Buffer, w: number, h: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="data:image/png;base64,${buf.toString("base64")}"/></svg>\n`
}

async function tile(size: number, mark: Buffer, opts: { rounded?: boolean; fill?: number } = {}) {
  const rounded = opts.rounded ?? true
  const fill = opts.fill ?? 0.62
  const r = rounded ? Math.round(size * 0.225) : 0
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#000000"/></svg>`,
  )
  const meta = await sharp(mark).metadata()
  const mh = Math.round(size * fill)
  const mw = Math.round(mh * (meta.width! / meta.height!))
  const scaled = await sharp(mark).resize(mw, mh, { fit: "fill" }).png().toBuffer()
  return sharp(bg).composite([{ input: scaled, gravity: "centre" }]).png().toBuffer()
}

async function social(file: string, w: number, h: number, lockup: Buffer, bgOverride?: string) {
  let bg = bgOverride
  if (!bg) {
    const { data } = await sharp(path.join(ROOT, file)).raw().toBuffer({ resolveWithObject: true })
    bg = `#${data[0].toString(16).padStart(2, "0")}${data[1].toString(16).padStart(2, "0")}${data[2].toString(16).padStart(2, "0")}`
  }
  const lh = Math.round(h * 0.62)
  const meta = await sharp(lockup).metadata()
  const lw = Math.round(lh * (meta.width! / meta.height!))
  const scaled = await sharp(lockup).resize(lw, lh, { fit: "fill" }).png().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: scaled, gravity: "centre" }])
    .png()
    .toBuffer()
}

async function main() {
  const { data: raw, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const mask = floodBackground(raw, w, h)
  clearEnclosedWhiteCounters(raw, w, h, mask)
  const cut = Uint8Array.from(raw)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) if (mask[i]) cut[p + 3] = 0
  const ink = toInk(cut)

  const markWhite = await png(cut, w, h).extract(MARK).png().toBuffer()
  const markInk = await png(ink, w, h).extract(MARK).png().toBuffer()
  const wordWhite = await png(cut, w, h).extract(WORD).png().toBuffer()
  const wordInk = await png(ink, w, h).extract(WORD).png().toBuffer()
  const lockWhite = await png(cut, w, h).extract(LOCK).png().toBuffer()
  const lockInk = await png(ink, w, h).extract(LOCK).png().toBuffer()

  const iconMaster = await tile(1024, markWhite)

  // branding/
  const brandMark512 = await tile(512, markWhite, { rounded: false, fill: 0.78 })
  const brandMarkLight512 = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#00000000" } })
    .composite([{ input: await sharp(markInk).resize(398, 330, { fit: "fill" }).png().toBuffer(), gravity: "centre" }])
    .png()
    .toBuffer()
  await out("branding/mark-512x512.png", brandMark512)
  await out("branding/mark-512x512-light.png", brandMarkLight512)
  await out("branding/mark-192x192.png", await tile(192, markWhite, { rounded: false, fill: 0.78 }))
  await out("branding/mark-96x96.png", await tile(96, markWhite, { rounded: false, fill: 0.78 }))
  await out("branding/mark.svg", svgWrap(await sharp(markWhite).resize(512).png().toBuffer(), 512, 425))
  await out("branding/mark-light.svg", svgWrap(await sharp(markInk).resize(512).png().toBuffer(), 512, 425))

  // frontend/ui brand rasters (consumed by logo.tsx)
  const brand = "frontend/ui/src/assets/brand"
  await out(`${brand}/mark-white.png`, await sharp(markWhite).resize(1024).png().toBuffer())
  await out(`${brand}/mark-ink.png`, await sharp(markInk).resize(1024).png().toBuffer())
  await out(`${brand}/wordmark-white.png`, await sharp(wordWhite).resize(2048).png().toBuffer())
  await out(`${brand}/wordmark-ink.png`, await sharp(wordInk).resize(2048).png().toBuffer())
  await out(`${brand}/lockup-white.png`, await sharp(lockWhite).resize(1024).png().toBuffer())
  await out(`${brand}/lockup-ink.png`, await sharp(lockInk).resize(1024).png().toBuffer())
  await out(`${brand}/icon-master.png`, iconMaster)

  // favicons (gui/public symlinks point here; -v3 names kept in sync)
  const fav = "frontend/ui/src/assets/favicon"
  const favTile96 = await tile(96, markWhite)
  const favIco = createICO(await tile(256, markWhite), BILINEAR)
  if (!favIco) throw new Error("favicon.ico generation failed")
  const apple = await tile(180, markWhite, { rounded: false })
  const manifest192 = await tile(192, markWhite, { rounded: false })
  const manifest512 = await tile(512, markWhite, { rounded: false })
  for (const name of ["favicon.ico", "favicon-v3.ico"]) await out(`${fav}/${name}`, favIco)
  for (const name of ["favicon-96x96.png", "favicon-96x96-v3.png"]) await out(`${fav}/${name}`, favTile96)
  for (const name of ["favicon.svg", "favicon-v3.svg"]) await out(`${fav}/${name}`, svgWrap(favTile96, 96, 96))
  for (const name of ["apple-touch-icon.png", "apple-touch-icon-v3.png"]) await out(`${fav}/${name}`, apple)
  await out(`${fav}/web-app-manifest-192x192.png`, manifest192)
  await out(`${fav}/web-app-manifest-512x512.png`, manifest512)

  // desktop app icons, all channels share the tile
  for (const channel of ["dev", "beta", "prod"]) {
    const dir = `frontend/desktop/icons/${channel}`
    await out(`${dir}/icon.png`, await tile(512, markWhite))
    await out(`${dir}/dock.png`, await tile(256, markWhite))
    await out(`${dir}/32x32.png`, await tile(32, markWhite))
    await out(`${dir}/64x64.png`, await tile(64, markWhite))
    await out(`${dir}/128x128.png`, await tile(128, markWhite))
    await out(`${dir}/128x128@2x.png`, await tile(256, markWhite))
    const ico = createICO(await tile(256, markWhite), BILINEAR)
    if (!ico) throw new Error(`${dir}/icon.ico generation failed`)
    await out(`${dir}/icon.ico`, ico)
    const icns = createICNS(iconMaster, BILINEAR)
    if (!icns) throw new Error(`${dir}/icon.icns generation failed`)
    await out(`${dir}/icon.icns`, icns)
    for (const size of UWP) await out(`${dir}/Square${size}x${size}Logo.png`, await tile(size, markWhite, { rounded: false }))
    await out(`${dir}/StoreLogo.png`, await tile(50, markWhite, { rounded: false }))
    await rm(path.join(ROOT, dir, "android"), { recursive: true, force: true })
    await rm(path.join(ROOT, dir, "ios"), { recursive: true, force: true })
  }

  // social / OG images
  const img = "frontend/ui/src/assets/images"
  await out(`${img}/social-share.png`, await social(`${img}/social-share.png`, 1280, 721, lockWhite))
  await out(`${img}/social-share-zen.png`, await social(`${img}/social-share-zen.png`, 1200, 630, lockWhite))
  await out(`${img}/social-share-black.png`, await social(`${img}/social-share-black.png`, 1280, 721, lockWhite, "#000000"))

  const oauthWhite = await sharp(wordWhite).resize(480).png().toBuffer()
  const oauthInk = await sharp(wordInk).resize(480).png().toBuffer()
  await out(
    "backend/core/src/oauth/wordmark.ts",
    `export const WORDMARK_WHITE = "data:image/png;base64,${oauthWhite.toString("base64")}"\nexport const WORDMARK_INK = "data:image/png;base64,${oauthInk.toString("base64")}"\n`,
  )

  // docs (mintlify) + cloud console raster-wrapper svgs
  await out("docs/mintlify/logo/light.svg", svgWrap(wordInk, 1117, 180))
  await out("docs/mintlify/logo/dark.svg", svgWrap(wordWhite, 1117, 180))
  await out("docs/mintlify/favicon.svg", svgWrap(favTile96, 96, 96))
  const consoleAsset = "cloud/console/app/src/asset"
  await out(`${consoleAsset}/logo-ornate-light.svg`, svgWrap(wordInk, 1117, 180))
  await out(`${consoleAsset}/logo-ornate-dark.svg`, svgWrap(wordWhite, 1117, 180))
  await out(`${consoleAsset}/lander/logo-light.svg`, svgWrap(wordInk, 1117, 180))
  await out(`${consoleAsset}/lander/logo-dark.svg`, svgWrap(wordWhite, 1117, 180))

  console.log("brand generation complete")
}

await main()
