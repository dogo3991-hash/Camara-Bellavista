import type { CameraLogEntry } from '../../main/camera/cameraService'

interface Props {
  running: boolean
  log: CameraLogEntry[]
  onStart: () => void
  onStop: () => void
}

const COLORS: Record<CameraLogEntry['type'], string> = {
  'truck-detected': '#2563eb',
  settled: '#16a34a',
  frame: '#999',
  error: 'crimson',
  info: '#555'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

export function DetectionPanel({ running, log, onStart, onStop }: Props): React.JSX.Element {
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16 }}>Detección de movimiento</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={onStart} disabled={running}>
          Iniciar detección
        </button>
        <button onClick={onStop} disabled={!running}>
          Detener detección
        </button>
        <span style={{ alignSelf: 'center', fontSize: 13, color: running ? '#16a34a' : '#999' }}>
          {running ? '● activa' : '○ detenida'}
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
