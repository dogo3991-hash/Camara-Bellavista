import { EventEmitter } from 'events'
import { MotionDetector } from './motionDetector'
import type { CameraConfig } from './config'

export interface CameraLogEntry {
  type: 'truck-detected' | 'settled' | 'frame' | 'error' | 'info'
  message: string
  timestamp: number
  diff?: number
}

class CameraService extends EventEmitter {
  private detector: MotionDetector | null = null

  start(config: CameraConfig): void {
    if (this.detector) {
      this.detector.stop()
      this.detector.removeAllListeners()
    }

    const detector = new MotionDetector(config)
    detector.on('frame', ({ diff, timestamp }: { diff: number; timestamp: number }) => {
      this.log({ type: 'frame', message: `diff=${diff.toFixed(1)}`, timestamp, diff })
    })
    detector.on('truck-detected', () => {
      this.log({
        type: 'truck-detected',
        message: 'Movimiento sostenido detectado',
        timestamp: Date.now()
      })
      this.emit('truck-detected')
    })
    detector.on('settled', () => {
      this.log({
        type: 'settled',
        message: 'Camión asentado',
        timestamp: Date.now()
      })
    })
    detector.on('error', (message: string) => {
      this.log({ type: 'error', message, timestamp: Date.now() })
    })

    this.detector = detector
    detector.start()
    this.log({ type: 'info', message: 'Detección de movimiento iniciada', timestamp: Date.now() })
  }

  stop(): void {
    this.detector?.stop()
    this.log({ type: 'info', message: 'Detección de movimiento detenida', timestamp: Date.now() })
  }

  isRunning(): boolean {
    return this.detector?.isRunning() ?? false
  }

  private log(entry: CameraLogEntry): void {
    this.emit('log', entry)
  }
}

export const cameraService = new CameraService()
