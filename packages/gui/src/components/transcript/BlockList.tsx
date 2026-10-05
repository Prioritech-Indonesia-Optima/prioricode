import type { PermissionReply, TranscriptBlock } from "../../core/fold/transcript"
import { cn } from "../../lib/cn"

function UserRow({ block }: { block: Extract<TranscriptBlock, { kind: "user" }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2">
        <p dir="auto" className="whitespace-pre-wrap text-sm">{block.text}</p>
        {block.files.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {block.files.map((file, index) => (
              <span key={index} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {file.image ? "🖼 " : "📎 "}
                {file.name ?? file.mime}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantRow({ block }: { block: Extract<TranscriptBlock, { kind: "assistant" }> }) {
  return (
    <div className="rounded-lg bg-card px-3 py-2">
      {block.agent !== undefined && (
        <div className="mb-1 text-[11px] text-muted-foreground">
          {block.agent}
          {block.model !== undefined ? ` · ${block.model}` : ""}
        </div>
      )}
      <div className="grid gap-2">
        {block.parts.map((part) => {
          if (part.type === "text") {
            return (
              <p key={part.textID} dir="auto" className="whitespace-pre-wrap text-sm">
                {part.text}
                {part.streaming && <span className="animate-pulse">▋</span>}
              </p>
            )
          }
          if (part.type === "reasoning") {
            return (
              <details key={part.reasoningID} className="text-xs text-muted-foreground">
                <summary>Thinking{part.streaming ? "…" : ""}</summary>
                <p dir="auto" className="whitespace-pre-wrap ps-2 pt-1">{part.text}</p>
              </details>
            )
          }
          if (part.type === "tool") {
            return (
              <div key={part.callID} className="flex items-center gap-2 rounded border border-border bg-muted px-2 py-1 text-xs">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    part.state === "running" ? "bg-amber-400" : part.state === "success" ? "bg-emerald-500" : "bg-red-500",
                  )}
                />
                <span className="font-mono">{part.name}</span>
                {part.summary !== undefined && <span className="truncate text-muted-foreground">{part.summary}</span>}
                {part.error !== undefined && <span className="truncate text-destructive">{part.error}</span>}
              </div>
            )
          }
          return (
            <details key={part.callID} className="text-xs">
              <summary className="cursor-pointer font-mono text-muted-foreground">$ {part.command}</summary>
              {part.output !== undefined && (
                <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap ps-2 pt-1 font-mono">{part.output}</pre>
              )}
            </details>
          )
        })}
      </div>
      {block.retryNote !== undefined && <p className="mt-1 text-xs text-amber-500">{block.retryNote}</p>}
      {block.error !== undefined && <p className="mt-1 text-xs text-destructive">{block.error}</p>}
    </div>
  )
}

function PermissionRow(props: {
  block: Extract<TranscriptBlock, { kind: "permission" }>
  onReply: (requestID: string, reply: PermissionReply) => void
}) {
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
      <div className="text-xs text-muted-foreground">
        Permission requested: <span className="font-mono">{props.block.action}</span>
      </div>
      {props.block.resources.length > 0 && (
        <pre dir="auto" className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">{props.block.resources.join("\n")}</pre>
      )}
      {props.block.resolved !== undefined ? (
        <div className="mt-1 text-xs text-muted-foreground">Resolved: {props.block.resolved}</div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground" onClick={() => props.onReply(props.block.id, "once")}>
            Allow once
          </button>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={() => props.onReply(props.block.id, "always")}>
            Always allow
          </button>
          <button type="button" className="rounded border border-destructive/60 px-2 py-1 text-xs text-destructive" onClick={() => props.onReply(props.block.id, "reject")}>
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

function QuestionRow(props: {
  block: Extract<TranscriptBlock, { kind: "question" }>
  onReply: (requestID: string, answers: string[][]) => void
  onReject: (requestID: string) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
      {props.block.questions.map((question, index) => (
        <div key={index} className="mb-2">
          <div className="text-xs text-muted-foreground">{question.header}</div>
          <div dir="auto">{question.question}</div>
          {props.block.resolved === undefined && (
            <div className="mt-1 flex flex-wrap gap-2">
              {question.options.map((option, optionIndex) => (
                <button
                  key={optionIndex}
                  type="button"
                  title={option.description}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  onClick={() => props.onReply(props.block.id, [question.options.map((_, at) => (at === optionIndex ? option.label : "")).filter((label) => label.length > 0)])}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        {props.block.resolved !== undefined ? (
          <span className="text-xs text-muted-foreground">Resolved: {props.block.resolved}</span>
        ) : (
          <button type="button" className="rounded border border-border px-2 py-1 text-xs text-muted-foreground" onClick={() => props.onReject(props.block.id)}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

export function BlockList(props: {
  blocks: TranscriptBlock[]
  onPermissionReply: (requestID: string, reply: PermissionReply) => void
  onQuestionReply: (requestID: string, answers: string[][]) => void
  onQuestionReject: (requestID: string) => void
}) {
  return (
    <div className="grid gap-2 p-3">
      {props.blocks.map((block) => {
        switch (block.kind) {
          case "user":
            return <UserRow key={block.id} block={block} />
          case "assistant":
            return <AssistantRow key={block.id} block={block} />
          case "permission":
            return <PermissionRow key={block.id} block={block} onReply={props.onPermissionReply} />
          case "question":
            return <QuestionRow key={block.id} block={block} onReply={props.onQuestionReply} onReject={props.onQuestionReject} />
          case "compaction":
            return (
              <div key={block.id} className="rounded border border-dashed border-border px-3 py-1 text-center text-xs text-muted-foreground">
                {block.state === "running" ? "Compacting context…" : "Context compacted"}
              </div>
            )
          case "revert":
            return (
              <div key={block.id} className="rounded border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                {block.state === "staged" ? `Checkpoint staged at ${block.messageID}` : `Checkpoint committed at ${block.messageID}`}
                {block.files !== undefined && block.files.length > 0 ? ` (${block.files.join(", ")})` : ""}
              </div>
            )
          default:
            return (
              <div
                key={block.id}
                className={cn("px-1 text-center text-xs", block.tone === "error" ? "text-destructive" : "text-muted-foreground")}
              >
                {block.text}
              </div>
            )
        }
      })}
    </div>
  )
}
