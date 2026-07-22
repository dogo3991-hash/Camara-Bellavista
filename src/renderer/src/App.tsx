import { useEffect, useRef, useState } from 'react'
import type { CameraConfig, RoiFraction } from '../../main/camera/config'
import type { CameraLogEntry } from '../../main/camera/cameraService'
import { RoiCalibrator } from './RoiCalibrator'
import { DetectionPanel } from './DetectionPanel'

const MAX_LOG_ENTRIES = 50

function trimmedConfig(c: CameraConfig): CameraConfig {
  return { ...c, ip: c.ip.trim(), user: c.user.trim(), password: c.password.trim() }
}

const EMPTY_CONFIG: CameraConfig = {
  ip: '',
  user: '',
  password: '',
  enabled: false,
  motionRoi: { x: 0, y: 0, w: 1, h: 1 },
  plateRoi: { x: 0, y: 0, w: 1, h: 1 },
  matchMaxDistance: 2,
  matchMinMargin: 2
}

function App(): React.JSX.Element {
  const [config, setConfig] = useState<CameraConfig>(EMPTY_CONFIG)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [detectionRunning, setDetectionRunning] = useState(false)
  const [log, setLog] = useState<CameraLogEntry[]>([])
  const configRef = useRef(config)

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    window.api.camera.getConfig().then(setConfig)
    window.api.camera.detectionStatus().then(setDetectionRunning)
    const unsubscribe = window.api.camera.onLog((entry) => {
      setLog((prev) => [entry, ...prev].slice(0, MAX_LOG_ENTRIES))
    })
    return unsubscribe
  }, [])

  // Refresca la foto sola cada 2s (apenas hay IP/usuario cargados, sin esperar
  // a que se apriete "Probar conexión") — no toca el texto de estado para no
  // parpadear; si un tick falla, se mantiene la última imagen buena.
  //
  // inFlightRef evita apilar pedidos: si la cámara tarda más de 2s en responder
  // (red del sitio más lenta), el intervalo espera a que termine el pedido actual
  // en vez de sumar una conexión RTSP más — muchas cámaras IP limitan cuántas
  // sesiones simultáneas aceptan, y apilar pedidos las hace dejar de responder.
  useEffect(() => {
    if (!config.ip || !config.user) return
    const inFlightRef = { current: false }
    const interval = setInterval(async () => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const base64 = await window.api.camera.testConnection(configRef.current)
        setSnapshot(`data:image/jpeg;base64,${base64}`)
      } catch {
        // Sin señal momentánea: se reintenta en el próximo tick.
      } finally {
        inFlightRef.current = false
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [config.ip, config.user, config.password])

  async function handleStartDetection(): Promise<void> {
    const trimmed = trimmedConfig(config)
    await window.api.camera.saveConfig(trimmed)
    await window.api.camera.startDetection(trimmed)
    setDetectionRunning(true)
  }

  async function handleStopDetection(): Promise<void> {
    await window.api.camera.stopDetection()
    setDetectionRunning(false)
  }

  async function handleTestConnection(): Promise<void> {
    setStatus('loading')
    setErrorMessage('')
    try {
      const base64 = await window.api.camera.testConnection(config)
      setSnapshot(`data:image/jpeg;base64,${base64}`)
      setStatus('ok')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSave(): Promise<void> {
    await window.api.camera.saveConfig(trimmedConfig(config))
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 640 }}>
      <h1>SLM Cámara Romana</h1>
      <p>Configuración de la cámara IP y prueba de conexión.</p>
      <p style={{ color: '#888', fontSize: 12 }}>Versión {__APP_VERSION__}</p>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label>
          IP de la cámara
          <input
            type="text"
            value={config.ip}
            onChange={(e) => setConfig({ ...config, ip: e.target.value })}
            placeholder="192.168.1.127"
            style={{ display: 'block', width: '100%', padding: 6 }}
          />
        </label>
        <label>
          Usuario
          <input
            type="text"
            value={config.user}
            onChange={(e) => setConfig({ ...config, user: e.target.value })}
            style={{ display: 'block', width: '100%', padding: 6 }}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={config.password}
            onChange={(e) => setConfig({ ...config, password: e.target.value })}
            style={{ display: 'block', width: '100%', padding: 6 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleTestConnection} disabled={status === 'loading'}>
            {status === 'loading' ? 'Probando…' : 'Probar conexión'}
          </button>
          <button onClick={handleSave}>Guardar configuración</button>
        </div>

        {status === 'error' && <p style={{ color: 'crimson' }}>Error: {errorMessage}</p>}
        {status === 'ok' && <p style={{ color: 'green' }}>Conexión exitosa.</p>}

        {snapshot && (
          <RoiCalibrator
            imageSrc={snapshot}
            motionRoi={config.motionRoi}
            plateRoi={config.plateRoi}
            onChangeMotionRoi={(roi: RoiFraction) => setConfig({ ...config, motionRoi: roi })}
            onChangePlateRoi={(roi: RoiFraction) => setConfig({ ...config, plateRoi: roi })}
          />
        )}
      </div>

      <DetectionPanel
        running={detectionRunning}
        log={log}
        onStart={handleStartDetection}
        onStop={handleStopDetection}
      />
    </div>
  )
}

export default App
