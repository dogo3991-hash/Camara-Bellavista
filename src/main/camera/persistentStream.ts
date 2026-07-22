import { spawn, type ChildProcess } from 'child_process'
import ffmpegPathRaw from 'ffmpeg-static'
import type { CameraConfig, RoiFraction } from './config'
import { buildRtspUrl, grabRoiRawGray, type RawGrayFrame, type StreamKind } from './rtsp'

// Mismo motivo que en rtsp.ts: en la app empaquetada, la ruta real en disco está
// desempaquetada del asar (asarUnpack en electron-builder.yml).
const ffmpegPath = ffmpegPathRaw?.replace('app.asar', 'app.asar.unpacked') ?? null

const RECONNECT_DELAY_MS = 3000

export interface PersistentStreamHandle {
  stop: () => void
}

// Reemplaza al modelo anterior de "un proceso de ffmpeg por frame" (conectar,
// decodificar un frame, cerrar) por uno persistente: conecta una sola vez y va
// entregando frames de forma continua mientras dure la sesión, igual que VLC.
// Si el proceso se cae (cámara reinicia, corte de red), se reintenta solo tras
// una espera corta — pero eso pasa rara vez, no en cada frame como antes.
function spawnManaged(
  args: string[],
  onChunk: (chunk: Buffer) => void,
  onError?: (message: string) => void
): PersistentStreamHandle {
  let proc: ChildProcess | null = null
  let stopped = false

  function launch(): void {
    if (stopped) return
    if (!ffmpegPath) {
      onError?.('ffmpeg-static no encontró el binario de ffmpeg')
      return
    }
    proc = spawn(ffmpegPath, args)
    proc.stdout?.on('data', onChunk)
    proc.stderr?.on('data', () => {
      // Se ignora el log de ffmpeg acá — solo importa si el proceso falla o se cierra.
    })
    proc.on('error', (err) => {
      onError?.(err.message)
      scheduleRestart()
    })
    proc.on('close', () => {
      proc = null
      scheduleRestart()
    })
  }

  function scheduleRestart(): void {
    if (stopped) return
    setTimeout(launch, RECONNECT_DELAY_MS)
  }

  launch()

  return {
    stop: () => {
      stopped = true
      proc?.kill('SIGKILL')
      proc = null
    }
  }
}

function roiFilterExpr(roi: RoiFraction): string {
  const w = `iw*${roi.w}`
  const h = `ih*${roi.h}`
  const x = `iw*${roi.x}`
  const y = `ih*${roi.y}`
  return `crop=${w}:${h}:${x}:${y}`
}

/**
 * Stream continuo de frames en escala de grises para la detección de movimiento.
 * `rawvideo` no tiene marcadores de límite de frame (a diferencia de MJPEG), así
 * que hace falta conocer el tamaño exacto de cada frame de antemano para poder
 * trocear el flujo de bytes — por eso primero se toma un solo frame de prueba
 * (reusando `grabRoiRawGray`) para conocer el alto real (el ancho ya se pide
 * fijo, pero el alto depende del aspecto de la cámara), y recién ahí se arranca
 * el stream persistente con `scale` fijo (ancho y alto exactos, no `-1`).
 */
export function startRawGrayStream(
  config: CameraConfig,
  roi: RoiFraction,
  targetWidth: number,
  fps: number,
  onFrame: (frame: RawGrayFrame) => void,
  onError: (message: string) => void
): PersistentStreamHandle {
  let stopped = false
  let inner: PersistentStreamHandle | null = null

  async function init(): Promise<void> {
    try {
      const probe = await grabRoiRawGray(config, roi, targetWidth)
      if (stopped) return
      const { width, height } = probe
      const frameSize = width * height
      if (frameSize === 0) throw new Error('No se pudo determinar el tamaño del frame')

      const url = buildRtspUrl(config, 'sub')
      const filter = `${roiFilterExpr(roi)},scale=${width}:${height},format=gray`
      let buffer = Buffer.alloc(0)

      inner = spawnManaged(
        [
          '-rtsp_transport',
          'tcp',
          '-i',
          url,
          '-vf',
          filter,
          '-r',
          String(fps),
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          'pipe:1'
        ],
        (chunk) => {
          buffer = Buffer.concat([buffer, chunk])
          while (buffer.length >= frameSize) {
            const data = Buffer.from(buffer.subarray(0, frameSize))
            buffer = buffer.subarray(frameSize)
            onFrame({ data, width, height })
          }
        },
        onError
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      if (!stopped) setTimeout(init, RECONNECT_DELAY_MS)
    }
  }

  void init()

  return {
    stop: () => {
      stopped = true
      inner?.stop()
    }
  }
}

/**
 * Stream continuo de frames JPEG para la vista previa. MJPEG sí tiene
 * marcadores de límite de frame (SOI `FFD8` / EOI `FFD9`), así que se puede
 * trocear el flujo de bytes buscándolos, sin necesidad de conocer el tamaño de
 * antemano.
 */
export function startMjpegStream(
  config: CameraConfig,
  stream: StreamKind,
  fps: number,
  onFrame: (jpeg: Buffer) => void,
  onError?: (message: string) => void
): PersistentStreamHandle {
  const url = buildRtspUrl(config, stream)
  let buffer = Buffer.alloc(0)
  const SOI = Buffer.from([0xff, 0xd8])
  const EOI = Buffer.from([0xff, 0xd9])

  return spawnManaged(
    ['-rtsp_transport', 'tcp', '-i', url, '-r', String(fps), '-f', 'mjpeg', 'pipe:1'],
    (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const start = buffer.indexOf(SOI)
        if (start === -1) {
          buffer = Buffer.alloc(0)
          break
        }
        const end = buffer.indexOf(EOI, start + 2)
        if (end === -1) {
          if (start > 0) buffer = buffer.subarray(start)
          break
        }
        onFrame(Buffer.from(buffer.subarray(start, end + 2)))
        buffer = buffer.subarray(end + 2)
      }
    },
    onError
  )
}
