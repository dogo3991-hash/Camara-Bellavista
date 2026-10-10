import { useEffect, useState } from 'react'
import type { KnownTruck, TruckPhotoThumb } from '../../main/recognition/recognizer'

const STATUS_LABELS: Record<KnownTruck['status'], { text: string; color: string }> = {
  activo: { text: '● se reconoce', color: '#16a34a' },
  juntando: { text: '◐ juntando fotos', color: '#d97706' },
  pausado: { text: '○ pausado', color: '#999' }
}

const MIN_PHOTOS = 3

const cell: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #eee' }

// Camiones que la cámara sabe reconocer. Aprende sola: cada pesaje completado en
// Pesos Bellavista guarda la foto del camión como referencia de su patente.
export function KnownTrucksPanel(): React.JSX.Element {
  const [trucks, setTrucks] = useState<KnownTruck[]>([])
  const [openPlate, setOpenPlate] = useState<string | null>(null)
  const [photos, setPhotos] = useState<TruckPhotoThumb[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    const refresh = (): void => {
      window.api.camera.knownTrucks().then(setTrucks)
    }
    refresh()
    return window.api.camera.onKnownChanged(refresh)
  }, [])

  useEffect(() => {
    if (!openPlate) return
    let cancelled = false
    window.api.camera.truckPhotos(openPlate).then((list) => {
      if (!cancelled) setPhotos(list)
    })
    return () => {
      cancelled = true
    }
  }, [openPlate, trucks])

  function togglePhotos(plate: string): void {
    setConfirmDelete(null)
    setPhotos([])
    setOpenPlate(openPlate === plate ? null : plate)
  }

  async function handleDelete(plate: string, file: string): Promise<void> {
    if (confirmDelete !== file) {
      setConfirmDelete(file)
      return
    }
    setConfirmDelete(null)
    await window.api.camera.deleteTruckPhoto(plate, file)
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16 }}>Camiones conocidos</h2>
      <p style={{ fontSize: 13, color: '#555', margin: '0 0 8px' }}>
        Cada pesaje completado en Pesos Bellavista guarda la foto del camión como referencia. Desde
        la {MIN_PHOTOS}.ª foto el camión se reconoce solo. Si una foto quedó con la patente
        equivocada, bórrala.
      </p>
      {trucks.length === 0 ? (
        <div style={{ color: '#999', fontSize: 13 }}>Todavía no hay camiones de referencia.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#555' }}>
              <th style={cell}>Patente</th>
              <th style={cell}>Fotos</th>
              <th style={cell}>Estado</th>
              <th style={cell} />
            </tr>
          </thead>
          <tbody>
            {trucks.map((truck) => {
              const label = STATUS_LABELS[truck.status]
              return (
                <tr key={truck.plate}>
                  <td style={{ ...cell, fontWeight: 600 }}>{truck.plate}</td>
                  <td style={cell}>
                    {truck.status === 'juntando'
                      ? `${truck.photos} de ${MIN_PHOTOS}`
                      : truck.photos}
                  </td>
                  <td style={{ ...cell, color: label.color }}>{label.text}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => togglePhotos(truck.plate)}>
                      {openPlate === truck.plate ? 'Ocultar fotos' : 'Ver fotos'}
                    </button>{' '}
                    <button
                      onClick={() =>
                        window.api.camera.setTruckPaused(truck.plate, truck.status !== 'pausado')
                      }
                    >
                      {truck.status === 'pausado' ? 'Reanudar' : 'Pausar'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {openPlate && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 8,
            marginTop: 8
          }}
        >
          {photos.map((photo) => (
            <div key={photo.file} style={{ border: '1px solid #ddd', padding: 4, fontSize: 12 }}>
              <img src={photo.thumbnail} style={{ width: '100%', display: 'block' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>{new Date(photo.time).toLocaleString()}</span>
                <button onClick={() => handleDelete(openPlate, photo.file)}>
                  {confirmDelete === photo.file ? '¿Borrar?' : '✕'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
