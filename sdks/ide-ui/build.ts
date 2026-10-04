import { copyFile } from "node:fs/promises"
import esbuild from "esbuild"

const production = process.argv.includes("--production")

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "PrioriCodeChat",
  target: "es2020",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "browser",
  outfile: "dist/ide-chat.js",
  logLevel: "silent",
})

await copyFile("src/styles.css", "dist/ide-chat.css")

console.log(`built dist/ide-chat.js${production ? " (production)" : ""}`)
