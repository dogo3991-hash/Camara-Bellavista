import { useEffect, useState } from 'react'

// Vista de la ventana miniatura "siempre encima": solo muestra el stream de
// vista previa que el proceso principal ya empuja a todas las ventanas.
export function MiniPreview(): React.JSX.Element {
  const [frame, setFrame] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.body.style.background = '#000'
    return window.api.camera.onPreviewFrame((base64) => {
      setFrame(`data:image/jpeg;base64,${base64}`)
    })
  }, [])

  return (
    <div
      style={
        {
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
      {frame ? (
        <img
          src={frame}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        'Conectando…'
      )}
    </div>
  )
}
