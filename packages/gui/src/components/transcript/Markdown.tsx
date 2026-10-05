import { useEffect, useMemo, useRef } from "react"
import { renderMarkdown } from "../../lib/markdown"
import { highlightCode } from "../../lib/highlight"
import { cn } from "../../lib/cn"

export function Markdown(props: { text: string; settled: boolean; className?: string }) {
  const html = useMemo(() => renderMarkdown(props.text), [props.text])
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = ref.current
    if (root === null) return
    let cancelled = false
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest<HTMLButtonElement>("[data-copy]")
      if (button === undefined || button === null) return
      const block = button.closest<HTMLElement>(".gui-code")
      const code = block?.querySelector("code, pre")?.textContent ?? ""
      void navigator.clipboard?.writeText(code).then(() => {
        button.textContent = "Copied"
        setTimeout(() => (button.textContent = "Copy"), 1500)
      })
    }
    root.addEventListener("click", onClick)
    return () => {
      cancelled = true
      root.removeEventListener("click", onClick)
      void cancelled
    }
  }, [html])

  useEffect(() => {
    const root = ref.current
    if (root === null || !props.settled) return
    let cancelled = false
    void (async () => {
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(".gui-code[data-lang]:not([data-highlighted])"))
      for (const block of blocks) {
        const source = block.querySelector("code")?.textContent ?? ""
        const out = await highlightCode(source, block.dataset.lang)
        if (cancelled || out === undefined) continue
        const fresh = document.createElement("div")
        fresh.innerHTML = out
        const old = block.querySelector("pre")
        for (const node of Array.from(fresh.children)) {
          if (old !== null) block.insertBefore(node, old)
          else block.appendChild(node)
        }
        if (old !== null) old.remove()
        block.dataset.highlighted = "1"
      }
    })()
    return () => {
      cancelled = true
    }
  }, [html, props.settled])

  return <div dir="auto" className={cn("gui-markdown text-sm", props.className)} dangerouslySetInnerHTML={{ __html: html }} ref={ref} />
}
