import { useEffect, useState } from 'react'

// Si nunca llega "settled" (p. ej. se cortó el stream), el parpadeo se apaga
// solo pasado este tiempo.
const ALERT_MAX_MS = 60000

const BLINK_CSS = `
@keyframes mini-alert-blink {
  0%, 49% { box-shadow: inset 0 0 0 8px #ff1744; background: rgba(255, 23, 68, 0.25); }
  50%, 100% { box-shadow: inset 0 0 0 8px #ffea00; background: rgba(255, 234, 0, 0.2); }
}
`

// Vista de la ventana miniatura "siempre encima": solo muestra el stream de
// vista previa que el proceso principal ya empuja a todas las ventanas, y
// parpadea mientras el detector reporta un camión en movimiento.
export function MiniPreview(): React.JSX.Element {
  const [frame, setFrame] = useState<string | null>(null)
  const [alert, setAlert] = useState(false)

  useEffect(() => {
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.body.style.background = '#000'
    return window.api.camera.onPreviewFrame((base64) => {
      setFrame(`data:image/jpeg;base64,${base64}`)
    })
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clearTimer = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const unsubscribe = window.api.camera.onLog((entry) => {
      if (entry.type === 'truck-detected') {
        clearTimer()
        setAlert(true)
        timer = setTimeout(() => setAlert(false), ALERT_MAX_MS)
      } else if (
        entry.type === 'settled' ||
        (entry.type === 'info' && entry.message.includes('detenida'))
      ) {
        clearTimer()
        setAlert(false)
      }
    })
    return () => {
      clearTimer()
      unsubscribe()
    }
  }, [])

  return (
    <div
      style={
        {
          position: 'relative',
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          color: '#aaa',
          fontFamily: 'sans-serif',
          fontSize: 14,
          cursor: 'move',
          userSelect: 'none',
          // Permite arrastrar la ventana (no tiene barra de título).
          WebkitAppRegion: 'drag'
        } as React.CSSProperties
      }
    >
      <style>{BLINK_CSS}</style>
      {frame ? (
        <img
          src={frame}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        'Conectando…'
      )}
      {alert && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            animation: 'mini-alert-blink 0.5s linear infinite'
          }}
        />
      )}
    </div>
  )
}
