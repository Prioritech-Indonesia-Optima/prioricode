import { memo, useMemo, useState } from "react"
import type {
  AssistantBlock,
  AssistantPart,
  CompactionBlock,
  PermissionBlock,
  QuestionBlock,
  QuestionItem,
  RevertBlock,
  SystemBlock,
  TranscriptBlock,
  UserBlock,
  PermissionReply,
} from "../../core/fold/transcript"
import { computePatch, extractFencedDiff } from "../../lib/diff"
import { useGui } from "../../react/queries"
import { cn } from "../../lib/cn"
import { DiffStats, DiffView } from "./DiffView"
import { Markdown } from "./Markdown"

function StateDot({ state }: { state: "running" | "success" | "error" | "done" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "running"
          ? "animate-pulse bg-amber-400"
          : state === "success" || state === "done"
            ? "bg-emerald-500"
            : "bg-red-500",
      )}
    />
  )
}

const TOOL_SUMMARY_KEYS = ["path", "filePath", "pattern", "command", "url", "query", "description", "subject"]

function summarizeToolInput(part: Extract<AssistantPart, { type: "tool" }>): string | undefined {
  if (part.input === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(part.input)
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>
      for (const key of TOOL_SUMMARY_KEYS) {
        const value = record[key]
        if (typeof value === "string" && value.length > 0) return value.length > 90 ? `${value.slice(0, 90)}…` : value
      }
    }
  } catch {
    // input is still streaming JSON; the raw head shows in the details body.
  }
  return undefined
}

function PartRow({ part }: { part: AssistantPart }) {
  if (part.type === "text") {
    return <Markdown text={part.text} settled={!part.streaming} />
  }
  if (part.type === "reasoning") {
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Thinking{part.streaming ? "…" : ""}</summary>
        <p dir="auto" className="whitespace-pre-wrap ps-2 pt-1">
          {part.text}
        </p>
      </details>
    )
  }
  if (part.type === "shell") {
    return (
      <details className="text-xs" open={part.state === "running"}>
        <summary className="flex cursor-pointer select-none items-center gap-2 rounded border border-border bg-muted px-2 py-1 font-mono">
          <StateDot state={part.state} />
          <bdi dir="ltr" className="truncate">
            {part.command}
          </bdi>
        </summary>
        {part.output !== undefined && (
          <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap ps-2 pt-1 font-mono">
            {part.output}
          </pre>
        )}
      </details>
    )
  }
  return <ToolPartRow part={part} />
}

const EDIT_TOOL_NAMES = new Set(["edit", "write", "apply_patch", "patch", "multiedit", "multi_edit"])

function derivePatch(part: Extract<AssistantPart, { type: "tool" }>): string | undefined {
  try {
    if (part.input !== undefined) {
      const parsed: unknown = JSON.parse(part.input)
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as Record<string, unknown>
        if (
          typeof record.path === "string" &&
          typeof record.oldString === "string" &&
          typeof record.newString === "string"
        ) {
          return computePatch(record.path, record.oldString, record.newString)
        }
        if (typeof record.path === "string" && typeof record.content === "string")
          return computePatch(record.path, "", record.content)
        if (typeof record.patch === "string") return record.patch
      }
    }
  } catch {
    // input still streaming; fall through to summary extraction
  }
  return extractFencedDiff(part.summary ?? part.progress)
}

function toolFilePath(part: Extract<AssistantPart, { type: "tool" }>): string | undefined {
  try {
    const parsed: unknown = part.input === undefined ? undefined : JSON.parse(part.input)
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>
      if (typeof record.path === "string") return record.path
      if (typeof record.filepath === "string") return record.filepath
    }
  } catch {
    return undefined
  }
  return undefined
}

function ToolPartRow({ part }: { part: Extract<AssistantPart, { type: "tool" }> }) {
  const { transport } = useGui()
  const summary = summarizeToolInput(part)
  const isEdit = EDIT_TOOL_NAMES.has(part.name)
  const patch = useMemo(() => (isEdit ? derivePatch(part) : undefined), [isEdit, part])
  const filePath = useMemo(() => (isEdit ? toolFilePath(part) : undefined), [isEdit, part])
  return (
    <details className="text-xs" open={part.state === "running"}>
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded border border-border bg-muted px-2 py-1">
        <StateDot state={part.state} />
        <span className="font-mono">{part.name}</span>
        {summary !== undefined && <span className="truncate text-muted-foreground">{summary}</span>}
        {patch !== undefined && <DiffStats patch={patch} />}
        {part.progress !== undefined && part.state === "running" && (
          <span className="truncate text-muted-foreground">— {part.progress}</span>
        )}
        {filePath !== undefined && transport.openFile !== undefined && (
          <button
            type="button"
            className="ms-auto shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              transport.openFile?.(filePath)
            }}
          >
            Open
          </button>
        )}
      </summary>
      <div className="grid gap-1 ps-2 pt-1">
        {patch !== undefined && <DiffView patch={patch} maxLines={24} className="mt-1" />}
        {part.input !== undefined && patch === undefined && (
          <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">
            {part.input}
          </pre>
        )}
        {part.summary !== undefined && (
          <p dir="auto" className="whitespace-pre-wrap">
            {part.summary}
          </p>
        )}
        {part.error !== undefined && (
          <p dir="auto" className="whitespace-pre-wrap text-destructive">
            {part.error}
          </p>
        )}
      </div>
    </details>
  )
}

function UserRow({ block, onRevertTo }: { block: UserBlock; onRevertTo?: (messageID: string) => void }) {
  return (
    <div className="group flex items-start justify-end gap-1">
      {onRevertTo !== undefined && (
        <button
          type="button"
          title="Revert workspace to just before this message"
          onClick={() => onRevertTo(block.id)}
          className="mt-2 hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent group-hover:block"
        >
          ⟲ revert to here
        </button>
      )}
      <div dir="auto" className="max-w-[85%] rounded-lg bg-secondary px-3 py-2">
        <p className="whitespace-pre-wrap text-sm">{block.text}</p>
        {block.files.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {block.files.map((file, index) => (
              <span key={index} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {file.image ? "image" : "file"}: {file.name ?? file.mime}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatTokens(block: AssistantBlock): string | undefined {
  const bits: string[] = []
  const tokens = block.tokens
  if (tokens !== undefined) {
    if (tokens.input !== undefined) bits.push(`in ${tokens.input.toLocaleString()}`)
    if (tokens.output !== undefined) bits.push(`out ${tokens.output.toLocaleString()}`)
    if (tokens.reasoning !== undefined && tokens.reasoning > 0) bits.push(`think ${tokens.reasoning.toLocaleString()}`)
    const cache = (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0)
    if (cache > 0) bits.push(`cache ${cache.toLocaleString()}`)
  }
  if (block.cost !== undefined && block.cost > 0) bits.push(`$${block.cost.toFixed(4)}`)
  return bits.length === 0 ? undefined : bits.join(" · ")
}

function AssistantRow({ block }: { block: AssistantBlock }) {
  const tokenLine = block.status === "done" ? formatTokens(block) : undefined
  return (
    <div dir="auto" className="rounded-lg bg-card px-3 py-2">
      {(block.agent !== undefined || block.model !== undefined) && (
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">{block.agent ?? "agent"}</span>
          {block.model !== undefined && (
            <bdi dir="ltr" className="truncate">
              {block.model}
            </bdi>
          )}
        </div>
      )}
      <div className="grid gap-1.5">
        {block.parts.map((part) => (
          <PartRow
            key={part.type === "text" ? part.textID : part.type === "reasoning" ? part.reasoningID : part.callID}
            part={part}
          />
        ))}
      </div>
      {block.retryNote !== undefined && <p className="mt-1 text-xs text-amber-500">{block.retryNote}</p>}
      {block.error !== undefined && (
        <p dir="auto" className="mt-1 text-xs text-destructive">
          {block.error}
        </p>
      )}
      {tokenLine !== undefined && <p className="mt-1 text-[10px] text-muted-foreground">{tokenLine}</p>}
    </div>
  )
}

function PermissionRow({
  block,
  onReply,
}: {
  block: PermissionBlock
  onReply: (requestID: string, reply: PermissionReply) => void
}) {
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
      <div dir="auto" className="text-xs text-muted-foreground">
        Permission requested: <span className="font-mono">{block.action}</span>
        {block.filepath !== undefined && (
          <>
            <span> · </span>
            <bdi dir="ltr" className="font-mono">
              {block.filepath}
            </bdi>
          </>
        )}
      </div>
      {block.resources.length > 0 && (
        <pre dir="auto" className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
          {block.resources.join("\n")}
        </pre>
      )}
      {block.diffPreview !== undefined && block.resolved === undefined && (
        <div className="mt-2">
          <DiffView patch={block.diffPreview} maxLines={18} />
        </div>
      )}
      {block.resolved !== undefined ? (
        <div className="mt-1 text-xs text-muted-foreground">Resolved: {block.resolved}</div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
            onClick={() => onReply(block.id, "once")}
          >
            Allow once
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => onReply(block.id, "always")}
          >
            Always allow
          </button>
          <button
            type="button"
            className="rounded border border-destructive/60 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => onReply(block.id, "reject")}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

interface QuestionDraft {
  single: string | undefined
  multi: string[]
  custom: string
}

// Module-level drafts survive virtualization unmounts: a half-answered card
// scrolled off-screen keeps its selections until submitted or dismissed.
const questionDrafts = new Map<string, Record<number, QuestionDraft>>()

const emptyDraft = (): QuestionDraft => ({ single: undefined, multi: [], custom: "" })

const draftBook = (requestID: string): Record<number, QuestionDraft> => {
  let book = questionDrafts.get(requestID)
  if (book === undefined) {
    book = {}
    questionDrafts.set(requestID, book)
  }
  return book
}

function QuestionField(props: { requestID: string; index: number; question: QuestionItem; disabled: boolean }) {
  const [draft, setDraft] = useState<QuestionDraft>(() => draftBook(props.requestID)[props.index] ?? emptyDraft())
  const update = (next: QuestionDraft) => {
    draftBook(props.requestID)[props.index] = next
    setDraft(next)
  }
  return (
    <fieldset disabled={props.disabled} className="mb-3 border-0 p-0">
      <legend className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {props.question.header.length > 0 ? props.question.header : `Question ${props.index + 1}`}
      </legend>
      <p dir="auto" className="mb-1">
        {props.question.question}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {props.question.options.map((option, optionIndex) => {
          const active = props.question.multiple ? draft.multi.includes(option.label) : draft.single === option.label
          return (
            <button
              key={optionIndex}
              type="button"
              title={option.description}
              onClick={() => {
                if (props.question.multiple) {
                  const next = draft.multi.includes(option.label)
                    ? draft.multi.filter((label) => label !== option.label)
                    : [...draft.multi, option.label]
                  update({ ...draft, multi: next })
                } else {
                  update({ ...draft, single: draft.single === option.label ? undefined : option.label })
                }
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent",
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {props.question.custom !== false && (
        <input
          dir="auto"
          value={draft.custom}
          onChange={(event) => update({ ...draft, custom: event.target.value })}
          placeholder="Type an answer…"
          className="mt-2 w-full rounded border border-input bg-background px-2 py-1 text-xs"
        />
      )}
    </fieldset>
  )
}

function QuestionRow({
  block,
  onReply,
  onReject,
}: {
  block: QuestionBlock
  onReply: (requestID: string, answers: string[][]) => void
  onReject: (requestID: string) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
      {block.questions.map((question, index) => (
        <QuestionField
          key={index}
          requestID={block.id}
          index={index}
          question={question}
          disabled={block.resolved !== undefined}
        />
      ))}
      <div className="mt-2 flex items-center gap-2">
        {block.resolved !== undefined ? (
          <span className="text-xs text-muted-foreground">Resolved: {block.resolved}</span>
        ) : (
          <>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
              onClick={() => {
                const drafts = draftBook(block.id)
                const answers = block.questions.map((question, index) => {
                  const draft = drafts[index] ?? emptyDraft()
                  const labels =
                    question.multiple === true ? [...draft.multi] : draft.single !== undefined ? [draft.single] : []
                  if (draft.custom.trim().length > 0) labels.push(draft.custom.trim())
                  return labels
                })
                questionDrafts.delete(block.id)
                onReply(block.id, answers)
              }}
            >
              Submit answers
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => {
                questionDrafts.delete(block.id)
                onReject(block.id)
              }}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CompactionRow({ block }: { block: CompactionBlock }) {
  return (
    <details className="rounded border border-dashed border-border px-3 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {block.state === "running" ? "Compacting context…" : "Context compacted"}
        {block.reason !== undefined ? ` (${block.reason})` : ""}
      </summary>
      {block.text !== undefined && (
        <p dir="auto" className="whitespace-pre-wrap pt-1">
          {block.text}
        </p>
      )}
      {block.recent !== undefined && (
        <p dir="auto" className="whitespace-pre-wrap pt-1 opacity-75">
          {block.recent}
        </p>
      )}
    </details>
  )
}

function RevertRow({ block }: { block: RevertBlock }) {
  return (
    <details
      className="rounded border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
      open={block.state === "staged"}
    >
      <summary className="cursor-pointer select-none">
        {block.state === "staged" ? "Checkpoint staged" : "Checkpoint committed"} ·{" "}
        <bdi dir="ltr">{block.messageID}</bdi>
        {block.files !== undefined && block.files.length > 0 ? ` (${block.files.length} files)` : ""}
      </summary>
      {block.files !== undefined && block.files.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {block.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2">
              <span className="font-mono">{file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}</span>
              <bdi dir="ltr" className="truncate font-mono">
                {file.path}
              </bdi>
              <DiffStats patch={file.patch} additions={file.additions} deletions={file.deletions} />
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

function SystemRow({ block }: { block: SystemBlock }) {
  return (
    <div
      dir="auto"
      className={cn("px-1 text-center text-xs", block.tone === "error" ? "text-destructive" : "text-muted-foreground")}
    >
      {block.text}
    </div>
  )
}

export const BlockRow = memo(function BlockRow(props: {
  block: TranscriptBlock
  onPermissionReply: (requestID: string, reply: PermissionReply) => void
  onQuestionReply: (requestID: string, answers: string[][]) => void
  onQuestionReject: (requestID: string) => void
  onRevertTo?: (messageID: string) => void
}) {
  const { block } = props
  switch (block.kind) {
    case "user":
      return <UserRow block={block} onRevertTo={props.onRevertTo} />
    case "assistant":
      return <AssistantRow block={block} />
    case "permission":
      return <PermissionRow block={block} onReply={props.onPermissionReply} />
    case "question":
      return <QuestionRow block={block} onReply={props.onQuestionReply} onReject={props.onQuestionReject} />
    case "compaction":
      return <CompactionRow block={block} />
    case "revert":
      return <RevertRow block={block} />
    default:
      return <SystemRow block={block} />
  }
})
