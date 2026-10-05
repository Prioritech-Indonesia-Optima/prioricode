import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "webview.js",
        assetFileNames: (info) => ((info.name ?? "").endsWith(".css") ? "webview.css" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  server: {
    port: 5273,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:4096",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
