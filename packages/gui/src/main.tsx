import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { detectHost } from "./lib/host"
import "./styles/globals.css"

if (detectHost() === "web") {
  const dark = globalThis.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => document.documentElement.classList.toggle("dark", dark.matches)
  apply()
  dark.addEventListener?.("change", apply)
}

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
