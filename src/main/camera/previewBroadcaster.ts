import { loadConfig } from './config'
import { grabSnapshotJpeg } from './rtsp'

const INTERVAL_MS = 1500

export interface PreviewBroadcasterOptions {
  hasClients: () => boolean
  broadcast: (payload: Record<string, unknown>) => void
}

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

async function tick(options: PreviewBroadcasterOptions): Promise<void> {
  if (inFlight) return
  if (!options.hasClients()) return

  const config = loadConfig()
  if (!config.ip || !config.user) return

  inFlight = true
  try {
    const jpeg = await grabSnapshotJpeg(config, 'sub', 4000)
    options.broadcast({ type: 'preview-frame', jpeg: jpeg.toString('base64') })
  } catch (err) {
    console.error('previewBroadcaster: no se pudo obtener snapshot:', err)
  } finally {
    inFlight = false
  }
}

export function startPreviewBroadcast(options: PreviewBroadcasterOptions): void {
  if (timer) return
  timer = setInterval(() => {
    void tick(options)
  }, INTERVAL_MS)
}

export function stopPreviewBroadcast(): void {
  if (timer) clearInterval(timer)
  timer = null
}
