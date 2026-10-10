import type {
  AutoWeighStatus,
  CameraLogEntry,
  DetectionStatus
} from '../../main/camera/cameraService'

interface Props {
  status: DetectionStatus
  log: CameraLogEntry[]
  onStart: () => void
  onStop: () => void
  onEnableAutoWeigh: () => void
  onDisableAutoWeigh: () => void
}

const COLORS: Record<CameraLogEntry['type'], string> = {
  'truck-detected': '#2563eb',
  settled: '#16a34a',
  identified: '#7c3aed',
  frame: '#999',
  error: 'crimson',
  info: '#555'
}

const AUTO_WEIGH_LABELS: Record<AutoWeighStatus, { text: string; color: string }> = {
  active: { text: '● activo', color: '#16a34a' },
  waiting: { text: '◐ en espera (fuera de horario)', color: '#d97706' },
  off: { text: '○ apagado', color: '#999' }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

export function DetectionPanel({
  status,
  log,
  onStart,
  onStop,
  onEnableAutoWeigh,
  onDisableAutoWeigh
}: Props): React.JSX.Element {
  const autoLabel = AUTO_WEIGH_LABELS[status.autoWeigh]
  const detectionText = !status.running
    ? '○ detenida'
    : status.manual
      ? '● activa'
      : '● activa (por pesaje automático)'
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16 }}>Detección de movimiento</h2>
      <p style={{ fontSize: 13, color: '#555', margin: '0 0 8px' }}>
        Avisa con alerta sonora en Pesos Bellavista cuando llega un camión, a cualquier hora.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={onStart} disabled={status.manual}>
          Iniciar detección
        </button>
        <button onClick={onStop} disabled={!status.manual}>
          Detener detección
        </button>
        <span
          style={{ alignSelf: 'center', fontSize: 13, color: status.running ? '#16a34a' : '#999' }}
        >
          {detectionText}
        </span>
      </div>

      <h2 style={{ fontSize: 16 }}>Pesaje automático</h2>
      <p style={{ fontSize: 13, color: '#555', margin: '0 0 8px' }}>
        Reconoce el camión al detenerse en la romana y abre su pesaje pendiente en Pesos Bellavista.
        Funciona solo de 07:00 a 18:00 (hora del PC); fuera de ese horario se pausa y vuelve a
        partir al día siguiente.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={onEnableAutoWeigh} disabled={status.autoWeigh !== 'off'}>
          Activar pesaje automático
        </button>
        <button onClick={onDisableAutoWeigh} disabled={status.autoWeigh === 'off'}>
          Desactivar pesaje automático
        </button>
        <span style={{ alignSelf: 'center', fontSize: 13, color: autoLabel.color }}>
          {autoLabel.text}
        </span>
      </div>
      <div
        style={{
          height: 220,
          overflowY: 'auto',
          border: '1px solid #ccc',
          padding: 8,
          fontFamily: 'monospace',
          fontSize: 12,
          background: '#fafafa'
        }}
      >
        {log.length === 0 && <div style={{ color: '#999' }}>Sin eventos todavía.</div>}
        {log.map((entry, i) => (
          <div key={i} style={{ color: COLORS[entry.type] }}>
            [{formatTime(entry.timestamp)}] {entry.type}: {entry.message}
          </div>
        ))}
      </div>
    </div>
  )
}
