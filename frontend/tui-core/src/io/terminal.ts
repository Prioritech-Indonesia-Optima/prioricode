import { createInputParser } from "./parser"
import { createOscChannel, encodeOsc, encodeDcsPassthrough, type OscChannel } from "./osc"
import type { InputEvent, OscCapabilities } from "../types"

export type TerminalMode = "main-screen" | "alt-screen" | "split-footer"

export type TerminalOptions = Readonly<{
  mode?: TerminalMode
  mouse?: boolean
  kittyKeyboard?: boolean
  write?: (data: string) => void
  onResize?: (columns: number, rows: number) => void
}>

export type InputHandler = (event: InputEvent) => boolean | void
export type ResizeHandler = (columns: number, rows: number) => void

export interface Terminal {
  readonly columns: number
  readonly rows: number
  readonly osc: OscChannel
  readonly capabilities: OscCapabilities
  readonly multiplexer: "tmux" | "screen" | undefined
  onInput(handler: InputHandler): () => void
  onResize(handler: ResizeHandler): () => void
  write(data: string): void
  requestOsc(code: number, payload: string): void
  setTitle(title: string): void
  enterAltScreen(): void
  exitAltScreen(): void
  enableMouse(enable: boolean): void
  start(): Promise<void>
  stop(): void
  feed(chunk: string): void
}

const KITTY_QUERY = "\x1b[?u"
const KITTY_PUSH = "\x1b[>3u"
const KITTY_POP = "\x1b[<0u"
const KITTY_RESPONSE = /\x1b\[\?(\d+)u/

class TerminalImpl implements Terminal {
  private handlers = new Set<InputHandler>()
  private resizeHandlers = new Set<ResizeHandler>()
  private readonly parser = createInputParser()
  readonly osc: OscChannel
  columns = 80
  rows = 24
  private running = false
  private readonly writeFn: (data: string) => void
  private cleanupRaw: (() => void) | undefined
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private readLoop: Promise<void> | undefined
  private kittyEnabled: boolean
  private mouseActive = false

  constructor(options: TerminalOptions) {
    this.writeFn = options.write ?? ((data) => void process.stdout.write(data))
    this.osc = createOscChannel()
    this.kittyEnabled = options.kittyKeyboard ?? true
    options.onResize && this.onResize(options.onResize)
  }

  get capabilities(): OscCapabilities {
    const term = `${process.env.TERM_PROGRAM ?? ""} ${process.env.TERM ?? ""}`
    return {
      osc5522: /kitty|wezterm|ghostty/i.test(term),
      osc52: true,
      dcs: this.multiplexer !== undefined,
    }
  }

  get multiplexer(): "tmux" | "screen" | undefined {
    if (process.env.TMUX) return "tmux"
    if (process.env.STY) return "screen"
    return undefined
  }

  onInput(handler: InputHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onResize(handler: ResizeHandler): () => void {
    this.resizeHandlers.add(handler)
    return () => this.resizeHandlers.delete(handler)
  }

  write(data: string): void {
    this.writeFn(data)
  }

  requestOsc(code: number, payload: string): void {
    const seq = encodeOsc(code, payload)
    this.writeFn(this.multiplexer ? encodeDcsPassthrough(seq) : seq)
  }

  setTitle(title: string): void {
    this.writeFn(`\x1b]0;${title.replace(/[\x00-\x1f\x07]/g, "")}\x07`)
  }

  enterAltScreen(): void {
    this.write("\x1b[?1049h")
  }

  exitAltScreen(): void {
    this.write("\x1b[?1049l")
  }

  enableMouse(enable: boolean): void {
    this.mouseActive = enable
    this.write(enable ? "\x1b[?1000h\x1b[?1003h\x1b[?1006h" : "\x1b[?1006l\x1b[?1003l\x1b[?1000l")
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.enterRawMode()
    if (this.kittyEnabled) this.write(`${KITTY_QUERY}${KITTY_PUSH}`)
    this.readSize()
    process.on("SIGWINCH", this.sigwinch)
    const stream = Bun.stdin.stream()
    this.reader = stream.getReader()
    const decoder = new TextDecoder()
    const reader = this.reader
    this.readLoop = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        this.feed(decoder.decode(value, { stream: true }))
      }
    })()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    process.off("SIGWINCH", this.sigwinch)
    if (this.kittyEnabled) this.write(`${KITTY_POP}`)
    if (this.mouseActive) this.enableMouse(false)
    try {
      void this.reader?.cancel()
    } catch {}
    this.cleanupRaw?.()
    this.cleanupRaw = undefined
    this.feedFrom(this.parser.flush())
  }

  feed(chunk: string): void {
    for (const match of chunk.matchAll(new RegExp(KITTY_RESPONSE, "g"))) {
      this.parser.setKittyFlags(Number.parseInt(match[1], 10) + 1)
    }
    if (KITTY_RESPONSE.test(chunk)) return
    this.feedFrom(this.parser.feed(chunk))
  }

  private feedFrom(events: InputEvent[]): void {
    for (const event of events) {
      if (event.kind === "osc") this.osc.feed({ ...event })
      else if (event.kind === "dcs") this.osc.feed(event)
      if (event.kind === "resize") {
        this.columns = event.columns
        this.rows = event.rows
        for (const handler of this.resizeHandlers) handler(event.columns, event.rows)
        continue
      }
      for (const handler of this.handlers) if (handler(event) === true) break
    }
  }

  private sigwinch = (): void => {
    this.readSize()
  }

  private readSize(): void {
    const nextColumns = process.stdout.columns ?? this.columns
    const nextRows = process.stdout.rows ?? this.rows
    if (nextColumns === this.columns && nextRows === this.rows) return
    this.columns = nextColumns
    this.rows = nextRows
    for (const handler of this.resizeHandlers) handler(nextColumns, nextRows)
  }

  private enterRawMode(): void {
    try {
      const previous = Bun.spawnSync({ cmd: ["stty", "-g"], stdin: "inherit", stdout: "pipe" }).stdout.toString().trim()
      Bun.spawnSync({ cmd: ["stty", "raw", "-echo"], stdin: "inherit", stdout: "ignore" })
      this.cleanupRaw = () => {
        if (!previous) return
        try {
          Bun.spawnSync({ cmd: ["stty", previous], stdin: "inherit", stdout: "ignore" })
        } catch {}
      }
    } catch {
      this.cleanupRaw = undefined
    }
  }
}

export function createTerminal(options?: TerminalOptions): Terminal {
  return new TerminalImpl(options ?? {})
}
