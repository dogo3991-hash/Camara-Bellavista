import { WebSocketServer, type WebSocket } from 'ws'
import {
  cameraService,
  type TruckIdentifiedEvent,
  type TruckUnrecognizedEvent
} from './camera/cameraService'
import { startPreviewBroadcast, stopPreviewBroadcast } from './camera/previewBroadcaster'

export const WS_PORT = 4545

let wss: WebSocketServer | null = null

function broadcast(payload: Record<string, unknown>): void {
  if (!wss) return
  const data = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data)
    }
  }
}

export function startWsServer(onPreviewFrame?: (base64Jpeg: string) => void): void {
  if (wss) return

  wss = new WebSocketServer({ port: WS_PORT })

  wss.on('connection', (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: 'hello' }))
  })

  wss.on('error', (err) => {
    console.error('wsServer error:', err)
  })

  cameraService.on('truck-detected', () => {
    broadcast({ type: 'truck-detected', timestamp: Date.now() })
  })

  // Pesaje automático: Pesos Bellavista abre el pesaje en espera de esa patente.
  cameraService.on('truck-identified', (event: TruckIdentifiedEvent) => {
    broadcast({ type: 'truck-identified', ...event })
  })

  cameraService.on('truck-unrecognized', (event: TruckUnrecognizedEvent) => {
    broadcast({ type: 'truck-unrecognized', ...event })
  })

  startPreviewBroadcast({
    onFrame: (base64Jpeg) => {
      broadcast({ type: 'preview-frame', jpeg: base64Jpeg })
      onPreviewFrame?.(base64Jpeg)
    }
  })
}

export function stopWsServer(): void {
  stopPreviewBroadcast()
  wss?.close()
  wss = null
}
