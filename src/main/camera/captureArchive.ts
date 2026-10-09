import { app } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { grabSnapshotJpeg } from './rtsp'
import type { CameraConfig } from './config'

// Guarda una captura completa del stream principal cada vez que un camión se asienta
// en la romana. Sirve para juntar fotos reales de cada camión (distintas horas/luz)
// y calibrar el futuro reconocimiento. Las patentes se asignan después cruzando la
// hora del archivo con la hora de entrada de los pesajes.

export function captureDir(): string {
  return join(app.getPath('documents'), 'SLM-Camara-Capturas')
}

const pad = (n: number): string => String(n).padStart(2, '0')

export async function saveSettledCapture(config: CameraConfig, timestamp: number): Promise<string> {
  const d = new Date(timestamp)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  const dir = join(captureDir(), day)
  await mkdir(dir, { recursive: true })
  const jpeg = await grabSnapshotJpeg(config, 'main')
  const path = join(dir, `${day}_${time}.jpg`)
  await writeFile(path, jpeg)
  return path
}
