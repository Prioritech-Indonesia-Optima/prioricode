import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const webviewTarget = process.env["GUI_TARGET"] === "webview"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_GUI_HIGHLIGHT": JSON.stringify(webviewTarget ? "false" : "true"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: webviewTarget ? 100_000_000 : 4096,
    rollupOptions: webviewTarget
      ? {
          output: {
            inlineDynamicImports: true,
            entryFileNames: "webview.js",
            assetFileNames: (info) => ((info.name ?? "").endsWith(".css") ? "webview.css" : "assets/[name]-[hash][extname]"),
          },
        }
      : undefined,
  },
  server: {
    port: 5273,
    proxy: {
      "/api": {
        target: process.env["VITE_API_TARGET"] ?? "http://127.0.0.1:4096",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
