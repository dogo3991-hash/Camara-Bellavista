import { hostname } from 'os'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  cameraService,
  type TruckIdentifiedEvent,
  type TruckUnrecognizedEvent
} from './camera/cameraService'
import { startPreviewBroadcast, stopPreviewBroadcast } from './camera/previewBroadcaster'

export const WS_PORT = 4545

let wss: WebSocketServer | null = null
// Ventana de Pesos Bellavista que dio el turno del pesaje automático: si se cierra,
// el turno se pierde.
let lockSocket: WebSocket | null = null

// Pide el turno a Pesos Bellavista de este PC con el nombre del PC, que es lo que
// verán los otros PCs si quieren activarlo.
const AUTO_WEIGH_REQUEST = JSON.stringify({ type: 'auto-weigh-request', host: hostname() })

function denialNote(message: { holder?: unknown; reason?: unknown }): string {
  if (typeof message.reason === 'string') return message.reason
  if (typeof message.holder === 'string') {
    return `El pesaje automático está activo en el PC «${message.holder}»: desactívelo allá para usarlo en este.`
  }
  return 'Pesos Bellavista no dio el turno del pesaje automático.'
}

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
    if (cameraService.wantsAutoWeigh()) socket.send(AUTO_WEIGH_REQUEST)
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        // Pesos Bellavista avisa cada pesaje completado: la cámara aprende de esa foto.
        if (message?.type === 'weighing-completed' && typeof message.patente === 'string') {
          void cameraService.learnFrom(message.patente)
        } else if (message?.type === 'auto-weigh-query') {
          if (cameraService.wantsAutoWeigh()) socket.send(AUTO_WEIGH_REQUEST)
        } else if (message?.type === 'auto-weigh-granted') {
          lockSocket = socket
          cameraService.setAutoWeighLock(true)
        } else if (message?.type === 'auto-weigh-pending') {
          cameraService.setAutoWeighLock(false)
        } else if (message?.type === 'auto-weigh-denied') {
          cameraService.autoWeighDenied(denialNote(message))
        }
      } catch {
        // Mensaje malformado: se ignora.
      }
    })
    socket.on('close', () => {
      if (socket !== lockSocket) return
      lockSocket = null
      cameraService.setAutoWeighLock(false)
    })
  })

  wss.on('error', (err) => {
    console.error('wsServer error:', err)
  })

  cameraService.on('auto-weigh-request', () => {
    for (const client of wss?.clients ?? []) {
      if (client.readyState === client.OPEN) client.send(AUTO_WEIGH_REQUEST)
    }
  })

  cameraService.on('auto-weigh-release', () => {
    lockSocket = null
    broadcast({ type: 'auto-weigh-release' })
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
