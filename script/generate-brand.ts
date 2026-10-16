import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { BILINEAR, createICNS, createICO } from "png2icons"

const ROOT = path.resolve(import.meta.dir, "..")
const EMBLEM = path.join(ROOT, "branding/source/emblem.png")
const INK = { r: 28, g: 27, b: 23 }
const BG_THRESHOLD = 32
const DARK_BG_THRESHOLD = 60

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

function floodDarkBackground(raw: Uint8Array, w: number, h: number) {
  const mask = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (i: number) => {
    if (mask[i]) return
    const o = i * 4
    if (raw[o] > DARK_BG_THRESHOLD || raw[o + 1] > DARK_BG_THRESHOLD || raw[o + 2] > DARK_BG_THRESHOLD) return
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

function toWhite(raw: Uint8Array) {
  const copy = Uint8Array.from(raw)
  for (let i = 0; i < copy.length; i += 4) {
    if (copy[i + 3] > 0) {
      const lum = 0.299 * copy[i] + 0.587 * copy[i + 1] + 0.114 * copy[i + 2]
      if (lum > 100) {
        copy[i] = 255
        copy[i + 1] = 255
        copy[i + 2] = 255
      }
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
  const maxDim = Math.round(size * fill)
  const aspect = meta.width! / meta.height!
  let mw: number, mh: number
  if (aspect > 1) {
    mw = maxDim
    mh = Math.round(mw / aspect)
  } else {
    mh = maxDim
    mw = Math.round(mh * aspect)
  }
  const scaled = await sharp(mark).resize(mw, mh, { fit: "fill" }).png().toBuffer()
  return sharp(bg)
    .composite([{ input: scaled, gravity: "centre" }])
    .png()
    .toBuffer()
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

async function processDarkSource(file: string) {
  const { data: raw, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const mask = floodDarkBackground(raw, w, h)
  const cut = Uint8Array.from(raw)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) if (mask[i]) cut[p + 3] = 0
  const white = toWhite(cut)
  const trimmed = await png(cut, w, h).trim().png().toBuffer()
  const trimmedWhite = await png(white, w, h).trim().png().toBuffer()
  return { trimmed, trimmedWhite, w, h }
}

// Center a transparent buffer in a square canvas (size = its larger dimension).
// Used to turn the wide icon-only P into a square mark for favicons and headers.
async function square(buf: Buffer) {
  const meta = await sharp(buf).metadata()
  const size = Math.max(meta.width!, meta.height!)
  return sharp({ create: { width: size, height: size, channels: 4, background: "#00000000" } })
    .composite([{ input: buf, gravity: "centre" }])
    .png()
    .toBuffer()
}

// Find the row that splits the mark (P + swoosh) from the wordmark below it, by
// locating the largest empty horizontal band in the interior of the lockup.
async function markSplitRow(buf: Buffer, w: number, h: number) {
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const content = (i: number) => {
    const o = i * 4
    return data[o + 3] > 40 && !(data[o] > 200 && data[o + 1] > 200 && data[o + 2] > 200)
  }
  let best = { start: 0, len: 0 }
  let run = 0
  let start = 0
  for (let y = 0; y < h; y++) {
    let c = 0
    for (let x = 0; x < w; x++) if (content(y * w + x)) c++
    if (c < 5) {
      if (run === 0) start = y
      run++
    } else {
      if (run > best.len && start > 0 && start + run < h) best = { start, len: run }
      run = 0
    }
  }
  return best.len ? best.start + Math.floor(best.len / 2) : Math.round(h * 0.61)
}

async function main() {
  // The emblem source is the full clean lockup (mark + wordmark). The raw
  // wordmark source is the full brand sheet, not a wordmark — never use it as a logo.
  const emblem = await processDarkSource(EMBLEM)

  // The mark (and the full lockup) is the emblem.
  const markWhite = emblem.trimmedWhite
  const markInk = emblem.trimmed

  // Icon-only P (no wordmark), square, for slots that render "PrioriCode" as
  // text too and use a square box: the favicon, the landing header, the
  // VitePress logo, and the Mintlify navbar.
  const markMeta = await sharp(markInk).metadata()
  const markW = markMeta.width!
  const markH = markMeta.height!
  const splitRow = await markSplitRow(markInk, markMeta.width!, markMeta.height!)
  const crop = { left: 0, top: 0, width: markMeta.width!, height: splitRow }
  const iconInk = await square(await sharp(markInk).extract(crop).trim().png().toBuffer())
  const iconWhite = await square(await sharp(markWhite).extract(crop).trim().png().toBuffer())

  // Social share uses the clean lockup.
  const lockWhite = markWhite

  const iconMaster = await tile(1024, markWhite)

  // branding/
  await out("branding/mark-icon-ink.png", iconInk)
  await out("branding/mark-icon-white.png", iconWhite)
  const brandMark512 = await tile(512, markWhite, { rounded: false, fill: 0.78 })
  const brandMarkLight512 = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#00000000" } })
    .composite([
      { input: await sharp(markInk).resize(400, 400, { fit: "contain" }).png().toBuffer(), gravity: "centre" },
    ])
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
    for (const size of UWP)
      await out(`${dir}/Square${size}x${size}Logo.png`, await tile(size, markWhite, { rounded: false }))
    await out(`${dir}/StoreLogo.png`, await tile(50, markWhite, { rounded: false }))
    await rm(path.join(ROOT, dir, "android"), { recursive: true, force: true })
    await rm(path.join(ROOT, dir, "ios"), { recursive: true, force: true })
  }

  // social / OG images
  const img = "frontend/ui/src/assets/images"
  await out(`${img}/social-share.png`, await social(`${img}/social-share.png`, 1280, 721, lockWhite))
  await out(`${img}/social-share-zen.png`, await social(`${img}/social-share-zen.png`, 1200, 630, lockWhite))
  await out(
    `${img}/social-share-black.png`,
    await social(`${img}/social-share-black.png`, 1280, 721, lockWhite, "#000000"),
  )

  // The OAuth page logo is the clean mark lockup, not the raw wordmark source
  // (which is the full brand sheet).
  const oauthWhite = await sharp(markWhite).resize(480).png().toBuffer()
  const oauthInk = await sharp(markInk).resize(480).png().toBuffer()
  await out(
    "backend/core/src/oauth/wordmark.ts",
    `export const WORDMARK_WHITE = "data:image/png;base64,${oauthWhite.toString("base64")}"\nexport const WORDMARK_INK = "data:image/png;base64,${oauthInk.toString("base64")}"\n`,
  )

  // docs (mintlify) + cloud console raster-wrapper svgs.
  // Mintlify shows the site `name` next to the logo, so it gets the icon-only P
  // (the full lockup would read "prioricode" twice). Starlight's logo replaces
  // the title, so it gets the full lockup. The raw wordmark source is the full
  // brand sheet, not a wordmark — never use it as a logo.
  const iconMeta = await sharp(iconInk).metadata()
  const iconW = iconMeta.width!
  const iconH = iconMeta.height!
  await out("docs/mintlify/logo/light.svg", svgWrap(iconInk, iconW, iconH))
  await out("docs/mintlify/logo/dark.svg", svgWrap(iconWhite, iconW, iconH))
  await out("docs/mintlify/favicon.svg", svgWrap(favTile96, 96, 96))
  await out("docs/web/src/assets/logo-light.svg", svgWrap(markInk, markW, markH))
  await out("docs/web/src/assets/logo-dark.svg", svgWrap(markWhite, markW, markH))
  const consoleAsset = "cloud/console/app/src/asset"
  await out(`${consoleAsset}/logo-ornate-light.svg`, svgWrap(markInk, markW, markH))
  await out(`${consoleAsset}/logo-ornate-dark.svg`, svgWrap(markWhite, markW, markH))
  await out(`${consoleAsset}/lander/logo-light.svg`, svgWrap(markInk, markW, markH))
  await out(`${consoleAsset}/lander/logo-dark.svg`, svgWrap(markWhite, markW, markH))

  console.log("brand generation complete")
}

await main()
