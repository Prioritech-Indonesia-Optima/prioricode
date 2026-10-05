import { useEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { PermissionReply, TranscriptBlock } from "../../core/fold/transcript"
import { BlockRow } from "./BlockRow"

export interface MessageListProps {
  blocks: TranscriptBlock[]
  onPermissionReply: (requestID: string, reply: PermissionReply) => void
  onQuestionReply: (requestID: string, answers: string[][]) => void
  onQuestionReject: (requestID: string) => void
}

/**
 * Virtualized transcript. Rows are memoized by block identity — the fold keeps
 * unchanged blocks referentially stable, so a token delta re-renders exactly one
 * row. Pin-to-bottom uses vertical metrics only and is therefore RTL-neutral.
 */
export function MessageList(props: MessageListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)

  const virtualizer = useVirtualizer({
    count: props.blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 10,
    getItemKey: (index) => props.blocks[index]?.id ?? index,
  })

  useEffect(() => {
    const element = parentRef.current
    if (element === null) return
    const onScroll = () => {
      pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    }
    element.addEventListener("scroll", onScroll, { passive: true })
    return () => element.removeEventListener("scroll", onScroll)
  }, [])

  const blockCount = props.blocks.length
  const lastBlock = blockCount > 0 ? props.blocks[blockCount - 1] : undefined
  const lastSignature =
    lastBlock === undefined
      ? ""
      : lastBlock.kind === "assistant"
        ? `${lastBlock.status}:${lastBlock.parts.map((part) => ("text" in part ? part.text.length : "output" in part ? (part.output?.length ?? 0) : 0)).join(",")}`
        : lastBlock.kind

  useEffect(() => {
    if (!pinned.current || blockCount === 0) return
    virtualizer.scrollToOffset(virtualizer.getTotalSize() + 10_000, { behavior: "auto" })
  }, [blockCount, lastSignature, virtualizer])

  const items = virtualizer.getVirtualItems()
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {items.map((item) => {
          const block = props.blocks[item.index]
          if (block === undefined) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
              className="px-3 py-1"
            >
              <BlockRow
                block={block}
                onPermissionReply={props.onPermissionReply}
                onQuestionReply={props.onQuestionReply}
                onQuestionReject={props.onQuestionReject}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EmptyTranscript() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
      <p className="text-base font-medium text-foreground">PrioriCode</p>
      <p>Ask anything about this workspace.</p>
    </div>
  )
}
