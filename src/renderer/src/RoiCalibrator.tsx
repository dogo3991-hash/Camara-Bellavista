import { useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { RoiFraction } from '../../main/camera/config'

interface Props {
  imageSrc: string
  motionRoi: RoiFraction
  plateRoi: RoiFraction
  onChangeMotionRoi: (roi: RoiFraction) => void
  onChangePlateRoi: (roi: RoiFraction) => void
}

type Mode = 'motion' | 'plate'

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): RoiFraction {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  }
}

export function RoiCalibrator({
  imageSrc,
  motionRoi,
  plateRoi,
  onChangeMotionRoi,
  onChangePlateRoi
}: Props): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const [mode, setMode] = useState<Mode>('motion')
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)

  function toFraction(clientX: number, clientY: number): { x: number; y: number } {
    const rect = imgRef.current!.getBoundingClientRect()
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height)
    }
  }

  function handleMouseDown(e: MouseEvent): void {
    const point = toFraction(e.clientX, e.clientY)
    setDragStart(point)
    setDragCurrent(point)
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!dragStart) return
    setDragCurrent(toFraction(e.clientX, e.clientY))
  }

  function handleMouseUp(): void {
    if (dragStart && dragCurrent) {
      const roi = rectFrom(dragStart, dragCurrent)
      if (roi.w > 0.01 && roi.h > 0.01) {
        if (mode === 'motion') onChangeMotionRoi(roi)
        else onChangePlateRoi(roi)
      }
    }
    setDragStart(null)
    setDragCurrent(null)
  }

  const draftRoi = dragStart && dragCurrent ? rectFrom(dragStart, dragCurrent) : null

  function rectStyle(roi: RoiFraction, color: string): CSSProperties {
    return {
      position: 'absolute',
      left: `${roi.x * 100}%`,
      top: `${roi.y * 100}%`,
      width: `${roi.w * 100}%`,
      height: `${roi.h * 100}%`,
      border: `2px solid ${color}`,
      boxSizing: 'border-box',
      pointerEvents: 'none'
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#555' }}>
        Dibujá arrastrando sobre la foto. <strong style={{ color: '#2563eb' }}>Azul</strong>: zona
        de la romana donde detectar movimiento.{' '}
        <strong style={{ color: '#f97316' }}>Naranja</strong>: zona donde aparece la patente.
      </p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <label>
          <input type="radio" checked={mode === 'motion'} onChange={() => setMode('motion')} /> Zona
          de movimiento
        </label>
        <label>
          <input type="radio" checked={mode === 'plate'} onChange={() => setMode('plate')} /> Zona
          de patente
        </label>
      </div>
      <div
        style={{ position: 'relative', display: 'inline-block', userSelect: 'none', width: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setDragStart(null)
          setDragCurrent(null)
        }}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Calibración de zonas"
          style={{ width: '100%', display: 'block' }}
          draggable={false}
        />
        <div style={rectStyle(motionRoi, '#2563eb')} />
        <div style={rectStyle(plateRoi, '#f97316')} />
        {draftRoi && <div style={rectStyle(draftRoi, mode === 'motion' ? '#2563eb' : '#f97316')} />}
      </div>
    </div>
  )
}
