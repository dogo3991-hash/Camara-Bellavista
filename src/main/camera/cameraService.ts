import { EventEmitter } from 'events'
import { MotionDetector } from './motionDetector'
import type { CameraConfig } from './config'
import { grabRoiJpeg } from './rtsp'
import { recognizePlate } from './plateOcr'

export interface CameraLogEntry {
  type: 'truck-detected' | 'settled' | 'plate' | 'frame' | 'error' | 'info'
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
        message: 'Camión asentado (listo para OCR)',
        timestamp: Date.now()
      })
      void this.runOcr(config)
    })
    detector.on('error', (message: string) => {
      this.log({ type: 'error', message, timestamp: Date.now() })
    })

    this.detector = detector
    detector.start()
    this.log({ type: 'info', message: 'Detección de movimiento iniciada', timestamp: Date.now() })
  }

  private async runOcr(config: CameraConfig): Promise<void> {
    try {
      const jpeg = await grabRoiJpeg(config, config.plateRoi, 'main')
      const { text, confidence } = await recognizePlate(jpeg)
      this.log({
        type: 'plate',
        message: `Patente leída: "${text}" (confianza ${confidence.toFixed(0)}%)`,
        timestamp: Date.now()
      })
      this.emit('plate-candidate', { text, confidence })
    } catch (err) {
      this.log({
        type: 'error',
        message: `OCR falló: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now()
      })
    }
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
