import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import {
  CAB_BOX,
  CAB_SIZE,
  GROUND_BOX,
  MIN_MARGIN,
  PRESENCE_THRESHOLD,
  SMALL_HEIGHT,
  SMALL_WIDTH,
  TRUCK_BOX,
  cabDifference,
  cropImage,
  featureDistance,
  maskCount,
  meanValue,
  normalizeCab,
  truckFeatures,
  truckMask,
  type Box,
  type RgbImage,
  type TruckFeatures
} from './features'

// Fotos de referencia: Documentos\SLM-Camara-Referencias\<PATENTE>\*.jpg con fotos
// del camión detenido en la romana, y \vacia\*.jpg con la romana vacía. El nombre
// de cada archivo empieza con la fecha y hora (2026-10-09_11-28-04...), que se usa
// para restarle la romana vacía más cercana en el tiempo. Lo que va después de la
// hora (ej. "_romana") indica de qué PC salió: solo se cruzan fotos del mismo PC.
export function referencesDir(): string {
  return join(app.getPath('documents'), 'SLM-Camara-Referencias')
}

const EMPTY_FOLDER = 'vacia'
// El fondo que se resta tiene que ser una romana vacía vista en vivo hace poco: con
// una de otro día a la misma hora el reconocimiento falló 10 de 46 fotos, y con la
// vacía anterior a la llegada del camión acertó 44 de 44.
export const LIVE_EMPTY_MAX_AGE_MS = 60 * 60 * 1000
const MIN_MASK_PIXELS = 20

interface Frame {
  small: RgbImage
  truck: RgbImage
  ground: number
  cab: RgbImage
}

interface EmptyRef extends Frame {
  time: number
  source: string
}

interface TruckRef {
  plate: string
  features: TruckFeatures
}

export type Identification =
  | { kind: 'empty'; presence: number }
  | { kind: 'identified'; plate: string; distance: number; margin: number; presence: number }
  | { kind: 'unrecognized'; reason: string; presence: number; plate?: string; margin?: number }

function toRgb(bitmap: Buffer, width: number, height: number): RgbImage {
  // nativeImage entrega BGRA.
  const data = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = bitmap[i * 4 + 2] / 255
    data[i * 3 + 1] = bitmap[i * 4 + 1] / 255
    data[i * 3 + 2] = bitmap[i * 4] / 255
  }
  return { width, height, data }
}

export function decodeFrame(jpeg: Buffer): Frame {
  const image = nativeImage.createFromBuffer(jpeg)
  const { width, height } = image.getSize()
  if (!width || !height) throw new Error('No se pudo leer la imagen')
  const smallImage = image.resize({ width: SMALL_WIDTH, height: SMALL_HEIGHT, quality: 'better' })
  const small = toRgb(smallImage.toBitmap(), SMALL_WIDTH, SMALL_HEIGHT)
  const cabRect = boxToRect(CAB_BOX, width, height)
  const cabImage = image
    .crop(cabRect)
    .resize({ width: CAB_SIZE, height: CAB_SIZE, quality: 'better' })
  return {
    small,
    truck: cropImage(small, TRUCK_BOX),
    ground: meanValue(cropImage(small, GROUND_BOX)),
    cab: normalizeCab(toRgb(cabImage.toBitmap(), CAB_SIZE, CAB_SIZE))
  }
}

function boxToRect(
  box: Box,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.round(box.x0 * width)
  const y = Math.round(box.y0 * height)
  return {
    x,
    y,
    width: Math.round(box.x1 * width) - x,
    height: Math.round(box.y1 * height) - y
  }
}

// "2026-10-09_11-28-04_romana.jpg" -> hora y PC de origen.
function parseName(file: string): { time: number; source: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(.*)\.jpe?g$/i.exec(file)
  if (!m) return null
  const [, y, mo, d, h, mi, s, rest] = m
  return {
    time: new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(),
    source: rest.replace(/^[_ -]+/, '').toLowerCase()
  }
}

export class TruckRecognizer {
  private empties: EmptyRef[] = []
  private trucks: TruckRef[] = []
  private liveEmpty: { frame: Frame; time: number } | null = null

  // Carga las referencias. Devuelve cuántas fotos hay por patente.
  async load(dir = referencesDir()): Promise<Record<string, number>> {
    this.empties = []
    this.trucks = []
    if (!existsSync(dir)) return {}

    const folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())
    const truckFiles: { plate: string; path: string; time: number; source: string }[] = []
    for (const folder of folders) {
      for (const file of await readdir(join(dir, folder.name))) {
        const parsed = parseName(file)
        if (!parsed) continue
        const path = join(dir, folder.name, file)
        if (folder.name.toLowerCase() === EMPTY_FOLDER) {
          this.empties.push({ ...decodeFrame(await readFile(path)), ...parsed })
        } else {
          truckFiles.push({ plate: folder.name.toUpperCase(), path, ...parsed })
        }
      }
    }

    const counts: Record<string, number> = {}
    for (const ref of truckFiles) {
      const frame = decodeFrame(await readFile(ref.path))
      const bg = this.nearestEmpty(ref.time, ref.source)
      if (!bg) continue
      const mask = truckMask(frame.truck, frame.ground, bg.truck, bg.ground)
      if (maskCount(mask) < MIN_MASK_PIXELS) continue
      this.trucks.push({ plate: ref.plate, features: truckFeatures(frame.truck, mask) })
      counts[ref.plate] = (counts[ref.plate] ?? 0) + 1
    }
    return counts
  }

  isReady(): boolean {
    return this.empties.length > 0 && new Set(this.trucks.map((t) => t.plate)).size >= 2
  }

  // Romana vacía del mismo PC más cercana en el tiempo (para las referencias).
  private nearestEmpty(time: number, source: string): EmptyRef | null {
    let best: EmptyRef | null = null
    for (const e of this.empties) {
      if (e.source !== source || e.time === time) continue
      if (!best || Math.abs(e.time - time) < Math.abs(best.time - time)) best = e
    }
    return best
  }

  // Antigüedad de la última romana vacía vista en vivo (Infinity si no hay).
  backgroundAgeMs(now = Date.now()): number {
    return this.liveEmpty ? now - this.liveEmpty.time : Infinity
  }

  // ¿Hay un camión? Fracción de la zona de la cabina que difiere de la romana
  // vacía más parecida (referencias + la última vista en vivo).
  private presenceOf(frame: Frame): number {
    let presence = Infinity
    for (const e of this.empties) presence = Math.min(presence, cabDifference(frame.cab, e.cab))
    if (this.liveEmpty) {
      presence = Math.min(presence, cabDifference(frame.cab, this.liveEmpty.frame.cab))
    }
    return presence
  }

  // Si la foto muestra la romana vacía, pasa a ser el fondo. Devuelve si estaba vacía.
  refreshBackground(jpeg: Buffer, now = Date.now()): boolean {
    const frame = decodeFrame(jpeg)
    if (this.presenceOf(frame) >= PRESENCE_THRESHOLD) return false
    this.liveEmpty = { frame, time: now }
    return true
  }

  identify(jpeg: Buffer, now = Date.now()): Identification {
    const frame = decodeFrame(jpeg)
    const presence = this.presenceOf(frame)
    if (presence < PRESENCE_THRESHOLD) {
      this.liveEmpty = { frame, time: now }
      return { kind: 'empty', presence }
    }

    if (!this.liveEmpty || now - this.liveEmpty.time > LIVE_EMPTY_MAX_AGE_MS) {
      return {
        kind: 'unrecognized',
        reason: 'no hay una foto reciente de la romana vacía',
        presence
      }
    }
    const bg = this.liveEmpty.frame
    const mask = truckMask(frame.truck, frame.ground, bg.truck, bg.ground)
    if (maskCount(mask) < MIN_MASK_PIXELS) {
      return { kind: 'unrecognized', reason: 'no se distingue el camión del fondo', presence }
    }
    const features = truckFeatures(frame.truck, mask)

    const best = new Map<string, number>()
    for (const ref of this.trucks) {
      const d = featureDistance(features, ref.features)
      if (d < (best.get(ref.plate) ?? Infinity)) best.set(ref.plate, d)
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1])
    if (ranked.length < 2) {
      return { kind: 'unrecognized', reason: 'faltan camiones de referencia', presence }
    }
    const [plate, distance] = ranked[0]
    const margin = ranked[1][1] / Math.max(distance, 1e-6)
    if (margin < MIN_MARGIN) {
      return {
        kind: 'unrecognized',
        reason: `dudoso entre ${plate} y ${ranked[1][0]}`,
        presence,
        plate,
        margin
      }
    }
    return { kind: 'identified', plate, distance, margin, presence }
  }
}
