import { EventEmitter } from 'events'
import { MotionDetector } from './motionDetector'
import { appendSettleTiming, saveSettledCapture } from './captureArchive'
import type { CameraConfig } from './config'
import { activeHoursLabel, isWithinActiveHours, ACTIVE_FROM_HOUR } from './detectionSchedule'
import { grabSnapshotJpeg } from './rtsp'
import { TruckRecognizer, referencesDir } from '../recognition/recognizer'

export interface CameraLogEntry {
  type: 'truck-detected' | 'settled' | 'identified' | 'frame' | 'error' | 'info'
  message: string
  timestamp: number
  diff?: number
}

// 'active': dentro del horario y vigilando. 'waiting': encendido pero fuera de
// horario. 'off': apagado por el usuario.
export type AutoWeighStatus = 'active' | 'waiting' | 'off'

export interface DetectionStatus {
  // La detección de movimiento está corriendo (por cualquiera de los dos motivos).
  running: boolean
  // El usuario la inició con "Iniciar detección" (alerta sonora, sin horario).
  manual: boolean
  autoWeigh: AutoWeighStatus
}

const SCHEDULE_CHECK_MS = 30_000
// Sin camiones, la foto de la romana vacía que se usa de fondo se renueva cuando
// tiene más de esto (cada camión que se va ya deja una nueva).
const BACKGROUND_REFRESH_AFTER_MS = 20 * 60 * 1000
const BACKGROUND_RETRY_MS = 5 * 60 * 1000

export interface TruckIdentifiedEvent {
  plate: string
  margin: number
  timestamp: number
}

export interface TruckUnrecognizedEvent {
  reason: string
  // Patentes probables cuando duda entre dos camiones (la más parecida primero).
  candidates: string[]
  timestamp: number
}
const fromHourLabel = `${String(ACTIVE_FROM_HOUR).padStart(2, '0')}:00`

// Una sola detección de movimiento sirve a dos funciones:
// - "Iniciar detección": alerta sonora en Pesos Bellavista, a cualquier hora.
// - "Pesaje automático": solo dentro del horario; al asentarse el camión sigue el
//   reconocimiento y el pesaje en la otra app.
// La detección corre si cualquiera de las dos la necesita.
class CameraService extends EventEmitter {
  private detector: MotionDetector | null = null
  private config: CameraConfig | null = null
  private manualOn = false
  private autoWeighOn = false
  private scheduleTimer: NodeJS.Timeout | null = null
  private detectedAt: number | null = null
  private recognizer = new TruckRecognizer()
  private refreshingBackground = false
  private lastBackgroundAttempt = 0

  startDetection(config: CameraConfig): void {
    this.manualOn = true
    this.useConfig(config)
  }

  stopDetection(): void {
    this.manualOn = false
    this.reconcile()
  }

  enableAutoWeigh(config: CameraConfig): void {
    this.autoWeighOn = true
    if (!this.scheduleTimer) {
      this.scheduleTimer = setInterval(() => this.reconcile(), SCHEDULE_CHECK_MS)
    }
    this.log({
      type: 'info',
      message: isWithinActiveHours()
        ? `Pesaje automático activado (${activeHoursLabel()})`
        : `Pesaje automático activado; fuera de horario, parte solo a las ${fromHourLabel}`,
      timestamp: Date.now()
    })
    this.useConfig(config)
    void this.loadReferences()
  }

  private async loadReferences(): Promise<void> {
    try {
      const counts = await this.recognizer.load()
      const summary = Object.entries(counts)
        .map(([plate, n]) => `${plate} (${n})`)
        .join(', ')
      if (this.recognizer.isReady()) {
        this.log({
          type: 'info',
          message: `Camiones de referencia: ${summary}`,
          timestamp: Date.now()
        })
      } else {
        this.log({
          type: 'error',
          message: `Faltan fotos de referencia en ${referencesDir()} (una carpeta por patente y otra "vacia"): no se reconocerán camiones`,
          timestamp: Date.now()
        })
      }
    } catch (err) {
      this.log({
        type: 'error',
        message: `No se pudieron cargar las fotos de referencia: ${err instanceof Error ? err.message : err}`,
        timestamp: Date.now()
      })
    }
    this.lastBackgroundAttempt = 0
    void this.maybeRefreshBackground()
  }

  private autoWeighActive(): boolean {
    return this.autoWeighOn && isWithinActiveHours()
  }

  // Toma una foto nueva de la romana vacía si la que hay es vieja y no hay un
  // camión entrando. Si la foto sale con camión, no se usa.
  private async maybeRefreshBackground(): Promise<void> {
    const now = Date.now()
    if (!this.autoWeighActive() || !this.config || !this.recognizer.isReady()) return
    if (this.refreshingBackground || this.detectedAt !== null) return
    if (this.recognizer.backgroundAgeMs(now) < BACKGROUND_REFRESH_AFTER_MS) return
    if (now - this.lastBackgroundAttempt < BACKGROUND_RETRY_MS) return
    this.refreshingBackground = true
    this.lastBackgroundAttempt = now
    try {
      const jpeg = await grabSnapshotJpeg(this.config, 'main')
      if (this.recognizer.refreshBackground(jpeg)) {
        this.log({
          type: 'info',
          message: 'Foto de la romana vacía actualizada',
          timestamp: Date.now()
        })
      }
    } catch (err) {
      this.log({
        type: 'error',
        message: `No se pudo tomar la foto de la romana vacía: ${err instanceof Error ? err.message : err}`,
        timestamp: Date.now()
      })
    } finally {
      this.refreshingBackground = false
    }
  }

  private recognize(jpeg: Buffer, timestamp: number): void {
    if (!this.recognizer.isReady()) return
    let result
    try {
      result = this.recognizer.identify(jpeg, timestamp)
    } catch (err) {
      this.log({
        type: 'error',
        message: `Error al reconocer el camión: ${err instanceof Error ? err.message : err}`,
        timestamp: Date.now()
      })
      return
    }
    if (result.kind === 'empty') {
      this.log({ type: 'info', message: 'Romana vacía', timestamp: Date.now() })
    } else if (result.kind === 'identified') {
      this.log({
        type: 'identified',
        message: `Camión reconocido: ${result.plate} (margen ${result.margin.toFixed(2)}x)`,
        timestamp: Date.now()
      })
      const event: TruckIdentifiedEvent = { plate: result.plate, margin: result.margin, timestamp }
      this.emit('truck-identified', event)
    } else {
      this.log({
        type: 'error',
        message: `Camión no reconocido: ${result.reason}`,
        timestamp: Date.now()
      })
      const event: TruckUnrecognizedEvent = {
        reason: result.reason,
        candidates: result.candidates ?? [],
        timestamp
      }
      this.emit('truck-unrecognized', event)
    }
  }

  disableAutoWeigh(): void {
    this.autoWeighOn = false
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer)
      this.scheduleTimer = null
    }
    this.log({ type: 'info', message: 'Pesaje automático desactivado', timestamp: Date.now() })
    this.reconcile()
  }

  getStatus(): DetectionStatus {
    return {
      running: this.isRunning(),
      manual: this.manualOn,
      autoWeigh: !this.autoWeighOn ? 'off' : isWithinActiveHours() ? 'active' : 'waiting'
    }
  }

  isRunning(): boolean {
    return this.detector?.isRunning() ?? false
  }

  // Una config nueva (IP, zona, etc.) obliga a reiniciar la detección con ella.
  private useConfig(config: CameraConfig): void {
    this.config = config
    if (this.isRunning()) this.stopDetector()
    this.reconcile()
  }

  private reconcile(): void {
    const autoNeedsIt = this.autoWeighOn && isWithinActiveHours()
    const shouldRun = this.manualOn || autoNeedsIt
    if (shouldRun && !this.isRunning() && this.config) {
      this.start(this.config)
    } else if (!shouldRun && this.isRunning()) {
      this.stopDetector()
      if (this.autoWeighOn) {
        this.log({
          type: 'info',
          message: `Fuera de horario (${activeHoursLabel()}): pesaje automático en pausa hasta las ${fromHourLabel}`,
          timestamp: Date.now()
        })
      }
    }
    this.emit('status', this.getStatus())
    void this.maybeRefreshBackground()
  }

  private start(config: CameraConfig): void {
    if (this.detector) {
      this.detector.stop()
      this.detector.removeAllListeners()
    }
    this.detectedAt = null

    const detector = new MotionDetector(config)
    detector.on('frame', ({ diff, timestamp }: { diff: number; timestamp: number }) => {
      this.log({ type: 'frame', message: `diff=${diff.toFixed(1)}`, timestamp, diff })
    })
    detector.on('truck-detected', () => {
      this.detectedAt = Date.now()
      this.log({
        type: 'truck-detected',
        message: 'Movimiento sostenido detectado',
        timestamp: this.detectedAt
      })
      this.emit('truck-detected')
    })
    detector.on('settled', () => {
      const timestamp = Date.now()
      const detectedAt = this.detectedAt
      this.detectedAt = null
      const seconds = detectedAt
        ? ` (${((timestamp - detectedAt) / 1000).toFixed(0)} s después de detectar)`
        : ''
      this.log({
        type: 'settled',
        message: `Camión asentado${seconds}`,
        timestamp
      })
      if (detectedAt) {
        appendSettleTiming(detectedAt, timestamp).catch(() => {
          // Solo es un registro de diagnóstico; no debe interrumpir la detección.
        })
      }
      saveSettledCapture(config, timestamp)
        .then(({ path, jpeg }) => {
          this.log({ type: 'info', message: `Captura guardada: ${path}`, timestamp: Date.now() })
          if (this.autoWeighActive()) this.recognize(jpeg, timestamp)
        })
        .catch((err) =>
          this.log({
            type: 'error',
            message: `No se pudo guardar la captura: ${err?.message ?? err}`,
            timestamp: Date.now()
          })
        )
    })
    detector.on('error', (message: string) => {
      this.log({ type: 'error', message, timestamp: Date.now() })
    })

    this.detector = detector
    detector.start()
    this.log({ type: 'info', message: 'Detección de movimiento iniciada', timestamp: Date.now() })
  }

  private stopDetector(): void {
    this.detector?.stop()
    this.detectedAt = null
    this.log({ type: 'info', message: 'Detección de movimiento detenida', timestamp: Date.now() })
  }

  private log(entry: CameraLogEntry): void {
    this.emit('log', entry)
  }
}

export const cameraService = new CameraService()
