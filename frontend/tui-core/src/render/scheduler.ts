export type FrameTask = () => void

interface Participant {
  task: FrameTask
  intervalMs: number
  lastRun: number
}

export class FrameScheduler {
  private participants = new Set<Participant>()
  private queued = false
  private timer: ReturnType<typeof setInterval> | undefined
  private draw: FrameTask | undefined
  private _frameCount = 0

  setDraw(task: FrameTask): void {
    this.draw = task
  }

  get frameCount(): number {
    return this._frameCount
  }

  requestRender(): void {
    if (!this.draw) return
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      if (!this.queued) return
      this.queued = false
      this.paint()
    })
  }

  private paint(): void {
    this._frameCount++
    this.draw?.()
  }

  onFrame(task: FrameTask, fps = 30): () => void {
    const participant: Participant = { task, intervalMs: 1000 / Math.max(1, fps), lastRun: 0 }
    this.participants.add(participant)
    this.ensureTimer()
    return () => {
      this.participants.delete(participant)
      this.ensureTimer()
    }
  }

  private ensureTimer(): void {
    if (this.participants.size === 0) {
      if (this.timer) clearInterval(this.timer)
      this.timer = undefined
      return
    }
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 16)
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref()
  }

  private tick(): void {
    const now = Date.now()
    let any = false
    for (const p of this.participants) {
      if (now - p.lastRun >= p.intervalMs) {
        p.lastRun = now
        p.task()
        any = true
      }
    }
    if (any) this.requestRender()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.participants.clear()
    this.draw = undefined
    this.queued = false
  }
}
