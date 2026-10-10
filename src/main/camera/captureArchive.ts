import { app } from 'electron'
import { appendFile, mkdir, writeFile } from 'fs/promises'
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

function dayAndTime(timestamp: number): { day: string; time: string } {
  const d = new Date(timestamp)
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  }
}

export async function saveSettledCapture(
  config: CameraConfig,
  timestamp: number
): Promise<{ path: string; jpeg: Buffer }> {
  const { day, time } = dayAndTime(timestamp)
  const dir = join(captureDir(), day)
  await mkdir(dir, { recursive: true })
  const jpeg = await grabSnapshotJpeg(config, 'main')
  const path = join(dir, `${day}_${time}.jpg`)
  await writeFile(path, jpeg)
  return { path, jpeg }
}

// Anota en `<fecha>/tiempos.csv` cuánto tardó el camión desde que se detectó
// movimiento hasta que quedó quieto, para medir con datos reales el tiempo que
// tomaría el pesaje automático.
export async function appendSettleTiming(detectedAt: number, settledAt: number): Promise<void> {
  const detected = dayAndTime(detectedAt)
  const settled = dayAndTime(settledAt)
  const dir = join(captureDir(), settled.day)
  await mkdir(dir, { recursive: true })
  const seconds = ((settledAt - detectedAt) / 1000).toFixed(1)
  const line = `${detected.time.replace(/-/g, ':')};${settled.time.replace(/-/g, ':')};${seconds}\n`
  await appendFile(join(dir, 'tiempos.csv'), line, 'utf-8')
}
