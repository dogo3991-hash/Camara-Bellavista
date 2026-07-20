import { EventEmitter } from 'events'
import type { CameraConfig } from './config'
import { grabRoiRawGray, type RawGrayFrame } from './rtsp'

export interface MotionDetectorOptions {
  pollIntervalMs?: number
  diffThreshold?: number
  sustainedFrames?: number
  settledFrames?: number
  cooldownMs?: number
  frameWidth?: number
}

type State = 'idle' | 'triggered' | 'cooldown'

function meanAbsDiff(a: RawGrayFrame, b: RawGrayFrame): number {
  const len = Math.min(a.data.length, b.data.length)
  if (len === 0) return 0
  let sum = 0
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a.data[i] - b.data[i])
  }
  return sum / len
}

export class MotionDetector extends EventEmitter {
  private config: CameraConfig
  private readonly opts: Required<MotionDetectorOptions>
  private timer: NodeJS.Timeout | null = null
  private running = false
  private previousFrame: RawGrayFrame | null = null
  private movingStreak = 0
  private stillStreak = 0
  private state: State = 'idle'
  private cooldownUntil = 0

  constructor(config: CameraConfig, opts: MotionDetectorOptions = {}) {
    super()
    this.config = config
    this.opts = {
      pollIntervalMs: opts.pollIntervalMs ?? 1000,
      diffThreshold: opts.diffThreshold ?? 12,
      sustainedFrames: opts.sustainedFrames ?? 3,
      settledFrames: opts.settledFrames ?? 3,
      cooldownMs: opts.cooldownMs ?? 30000,
      frameWidth: opts.frameWidth ?? 160
    }
  }

  updateConfig(config: CameraConfig): void {
    this.config = config
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.previousFrame = null
    this.movingStreak = 0
    this.stillStreak = 0
    this.state = 'idle'
    this.scheduleNext(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  isRunning(): boolean {
    return this.running
  }

  private scheduleNext(delay: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      const frame = await grabRoiRawGray(this.config, this.config.motionRoi, this.opts.frameWidth)
      const diff = this.previousFrame ? meanAbsDiff(this.previousFrame, frame) : 0
      this.previousFrame = frame
      this.emit('frame', { diff, timestamp: Date.now() })
      this.evaluate(diff)
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : String(err))
    } finally {
      this.scheduleNext(this.opts.pollIntervalMs)
    }
  }

  private evaluate(diff: number): void {
    const now = Date.now()

    if (this.state === 'cooldown') {
      if (now < this.cooldownUntil) return
      this.state = 'idle'
    }

    const moving = diff >= this.opts.diffThreshold

    if (this.state === 'idle') {
      if (moving) {
        this.movingStreak += 1
        if (this.movingStreak >= this.opts.sustainedFrames) {
          this.state = 'triggered'
          this.movingStreak = 0
          this.emit('truck-detected')
        }
      } else {
        this.movingStreak = 0
      }
      return
    }

    if (this.state === 'triggered') {
      if (moving) {
        this.stillStreak = 0
      } else {
        this.stillStreak += 1
        if (this.stillStreak >= this.opts.settledFrames) {
          this.state = 'cooldown'
          this.cooldownUntil = now + this.opts.cooldownMs
          this.stillStreak = 0
          this.emit('settled')
        }
      }
    }
  }
}
