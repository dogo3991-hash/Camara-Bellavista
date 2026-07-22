import { EventEmitter } from 'events'
import type { CameraConfig } from './config'
import type { RawGrayFrame } from './rtsp'
import { startRawGrayStream, type PersistentStreamHandle } from './persistentStream'

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
  private stream: PersistentStreamHandle | null = null
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
    // El stream persistente entrega frames al ritmo de este fps en vez de que
    // nosotros reconectemos por cada uno (ver persistentStream.ts).
    const fps = Math.max(1, Math.round(1000 / this.opts.pollIntervalMs))
    this.stream = startRawGrayStream(
      this.config,
      this.config.motionRoi,
      this.opts.frameWidth,
      fps,
      (frame) => this.onFrame(frame),
      (message) => this.emit('error', message)
    )
  }

  stop(): void {
    this.running = false
    this.stream?.stop()
    this.stream = null
  }

  isRunning(): boolean {
    return this.running
  }

  private onFrame(frame: RawGrayFrame): void {
    if (!this.running) return
    const diff = this.previousFrame ? meanAbsDiff(this.previousFrame, frame) : 0
    this.previousFrame = frame
    this.emit('frame', { diff, timestamp: Date.now() })
    this.evaluate(diff)
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
