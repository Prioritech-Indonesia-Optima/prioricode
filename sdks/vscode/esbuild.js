const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

function copyIdeAssets() {
  const source = path.join(__dirname, "..", "ide-ui", "dist")
  const target = path.join(__dirname, "dist")
  for (const file of ["ide-chat.js", "ide-chat.css"]) {
    const from = path.join(source, file)
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${file}: run 'bun run build:ui' (or build packages in sdks/ide-ui) before packaging`)
    }
    fs.copyFileSync(from, path.join(target, file))
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started")
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        console.error(`    ${location.file}:${location.line}:${location.column}:`)
      })
      console.log("[watch] build finished")
    })
  },
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  })
  const webviewCtx = await esbuild.context({
    entryPoints: ["src/chat/webview-ui.ts"],
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/webview.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  })
  if (watch) {
    await ctx.watch()
    await webviewCtx.watch()
  } else {
    await ctx.rebuild()
    await webviewCtx.rebuild()
    await ctx.dispose()
    await webviewCtx.dispose()
    copyIdeAssets()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
