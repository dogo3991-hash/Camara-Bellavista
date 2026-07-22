import { loadConfig, type CameraConfig } from './config'
import { startMjpegStream, type PersistentStreamHandle } from './persistentStream'

const PREVIEW_FPS = 5
// Chequeo liviano (no abre conexión a la cámara) para detectar que la config
// recién se guardó o cambió, y ahí sí reconectar el stream persistente —
// reemplaza al polling anterior que reconectaba por cada frame.
const CONFIG_WATCH_MS = 5000

export interface PreviewBroadcasterOptions {
  // Se llama con cada frame nuevo (base64 jpeg) — el llamador decide a quién
  // se lo reenvía (clientes WebSocket, la ventana local de calibración, etc.).
  onFrame: (base64Jpeg: string) => void
}

let stream: PersistentStreamHandle | null = null
let watchTimer: ReturnType<typeof setInterval> | null = null
let activeKey: string | null = null

function configKey(config: CameraConfig): string {
  return `${config.ip}|${config.user}|${config.password}`
}

function ensureStream(options: PreviewBroadcasterOptions): void {
  const config = loadConfig()
  if (!config.ip || !config.user) return

  const key = configKey(config)
  if (key === activeKey) return

  stream?.stop()
  activeKey = key
  stream = startMjpegStream(config, 'sub', PREVIEW_FPS, (jpeg) => {
    options.onFrame(jpeg.toString('base64'))
  })
}

export function startPreviewBroadcast(options: PreviewBroadcasterOptions): void {
  if (watchTimer) return
  ensureStream(options)
  watchTimer = setInterval(() => ensureStream(options), CONFIG_WATCH_MS)
}

export function stopPreviewBroadcast(): void {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
  stream?.stop()
  stream = null
  activeKey = null
}
