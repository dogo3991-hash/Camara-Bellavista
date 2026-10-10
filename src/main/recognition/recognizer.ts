import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { hostname } from 'os'
import { basename, join } from 'path'
import {
  CAB_BOX,
  CAB_SIZE,
  GROUND_BOX,
  MAX_MATCH_DISTANCE,
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
  | {
      kind: 'unrecognized'
      reason: string
      presence: number
      // Cuando duda: las 2 patentes más probables, la más parecida primero.
      candidates?: string[]
      margin?: number
    }

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

// Un camión empieza a reconocerse cuando junta esta cantidad de fotos.
export const MIN_REFS_TO_RECOGNIZE = 3
// Para que la carpeta no crezca sin fin: al pasarse, se borran las más antiguas.
const MAX_REFS_PER_PLATE = 40
const MAX_EMPTIES = 300
// Al completarse un pesaje se aprende de la última foto con camión, si es de hace
// menos de esto (el camión estuvo detenido en la romana hace poco).
const LEARN_MAX_AGE_MS = 15 * 60 * 1000
// Si la foto se parece claramente a otro camión ya conocido (su distancia es al
// menos esto veces menor), no se guarda con la patente indicada. Solo se revisa
// para camiones con muchas fotos: uno nuevo al principio puede parecerse más a
// otro, y si se le negaran las fotos nunca aprendería.
const LEARN_CONFLICT_MARGIN = 1.3
const LEARN_CONFLICT_MIN_REFS = 8
const PAUSED_FILE = 'pausados.json'

// Identifica de qué PC salió cada foto aprendida (ver parseName).
const LEARN_SOURCE = hostname()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function folderNameFor(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9-]/g, '')
}

const pad = (n: number): string => String(n).padStart(2, '0')

function stampName(time: number): string {
  const d = new Date(time)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}_${LEARN_SOURCE}.jpg`
  )
}

export interface KnownTruck {
  plate: string
  photos: number
  status: 'juntando' | 'activo' | 'pausado'
}

// Lo que recibe la pantalla: la foto como miniatura (data URL).
export interface TruckPhotoThumb {
  file: string
  time: number
  thumbnail: string
}

export interface TruckPhoto {
  file: string
  time: number
  path: string
}

export type LearnResult =
  { saved: true; plate: string; photos: number; active: boolean } | { saved: false; reason: string }

interface Observation {
  frame: Frame
  presence: number
  empty: boolean
}

export class TruckRecognizer {
  private dir = referencesDir()
  private empties: (EmptyRef & { path: string })[] = []
  private trucks: (TruckRef & { path: string; time: number })[] = []
  private paused = new Set<string>()
  private liveEmpty: { frame: Frame; time: number; jpeg: Buffer } | null = null
  private lastTruck: { frame: Frame; time: number; jpeg: Buffer; used: boolean } | null = null

  // Carga las referencias. Devuelve cuántas fotos hay por patente.
  async load(dir = referencesDir()): Promise<Record<string, number>> {
    this.dir = dir
    this.empties = []
    this.trucks = []
    this.paused = new Set()
    if (!existsSync(dir)) return {}

    try {
      const raw = JSON.parse(await readFile(join(dir, PAUSED_FILE), 'utf-8'))
      if (Array.isArray(raw)) this.paused = new Set(raw.map(String))
    } catch {
      // Sin camiones pausados.
    }

    const folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())
    const truckFiles: { plate: string; path: string; time: number; source: string }[] = []
    for (const folder of folders) {
      for (const file of await readdir(join(dir, folder.name))) {
        const parsed = parseName(file)
        if (!parsed) continue
        const path = join(dir, folder.name, file)
        if (folder.name.toLowerCase() === EMPTY_FOLDER) {
          this.empties.push({ ...decodeFrame(await readFile(path)), ...parsed, path })
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
      this.trucks.push({
        plate: ref.plate,
        features: truckFeatures(frame.truck, mask),
        path: ref.path,
        time: ref.time
      })
      counts[ref.plate] = (counts[ref.plate] ?? 0) + 1
    }
    return counts
  }

  hasEmpties(): boolean {
    return this.empties.length > 0
  }

  // Camiones que se reconocen: con fotos suficientes y no pausados.
  private activePlates(): Set<string> {
    const counts = new Map<string, number>()
    for (const t of this.trucks) counts.set(t.plate, (counts.get(t.plate) ?? 0) + 1)
    return new Set(
      [...counts]
        .filter(([plate, n]) => n >= MIN_REFS_TO_RECOGNIZE && !this.paused.has(plate))
        .map(([plate]) => plate)
    )
  }

  isReady(): boolean {
    return this.empties.length > 0 && this.activePlates().size >= 2
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

  // Revisa una captura: si muestra la romana vacía pasa a ser el fondo; si muestra
  // un camión queda guardada para aprender de ella cuando se complete su pesaje.
  observe(jpeg: Buffer, now = Date.now()): Observation {
    const frame = decodeFrame(jpeg)
    const presence = this.presenceOf(frame)
    const empty = presence < PRESENCE_THRESHOLD
    if (empty) this.liveEmpty = { frame, time: now, jpeg }
    else this.lastTruck = { frame, time: now, jpeg, used: false }
    return { frame, presence, empty }
  }

  // Si la foto muestra la romana vacía, pasa a ser el fondo. Devuelve si estaba vacía.
  refreshBackground(jpeg: Buffer, now = Date.now()): boolean {
    const frame = decodeFrame(jpeg)
    if (this.presenceOf(frame) >= PRESENCE_THRESHOLD) return false
    this.liveEmpty = { frame, time: now, jpeg }
    return true
  }

  identify(jpeg: Buffer, now = Date.now()): Identification {
    const { frame, presence, empty } = this.observe(jpeg, now)
    if (empty) return { kind: 'empty', presence }

    const features = this.featuresAgainstLiveEmpty(frame, now)
    if (typeof features === 'string') return { kind: 'unrecognized', reason: features, presence }

    const ranked = this.rank(features, this.activePlates())
    if (ranked.length < 2) {
      return { kind: 'unrecognized', reason: 'faltan camiones de referencia', presence }
    }
    const [plate, distance] = ranked[0]
    const margin = ranked[1][1] / Math.max(distance, 1e-6)
    if (distance > MAX_MATCH_DISTANCE) {
      return {
        kind: 'unrecognized',
        reason: `no se parece lo suficiente a ningún camión conocido (el más parecido es ${plate})`,
        presence,
        candidates: [plate, ranked[1][0]],
        margin
      }
    }
    if (margin < MIN_MARGIN) {
      return {
        kind: 'unrecognized',
        reason: `dudoso entre ${plate} y ${ranked[1][0]}`,
        presence,
        candidates: [plate, ranked[1][0]],
        margin
      }
    }
    return { kind: 'identified', plate, distance, margin, presence }
  }

  // Características del camión restándole la romana vacía vista en vivo, o el
  // motivo por el que no se puede.
  private featuresAgainstLiveEmpty(frame: Frame, time: number): TruckFeatures | string {
    if (!this.liveEmpty || Math.abs(time - this.liveEmpty.time) > LIVE_EMPTY_MAX_AGE_MS) {
      return 'no hay una foto reciente de la romana vacía'
    }
    const bg = this.liveEmpty.frame
    const mask = truckMask(frame.truck, frame.ground, bg.truck, bg.ground)
    if (maskCount(mask) < MIN_MASK_PIXELS) return 'no se distingue el camión del fondo'
    return truckFeatures(frame.truck, mask)
  }

  // Distancia al camión más parecido de cada patente, de menor a mayor.
  private rank(features: TruckFeatures, plates: Set<string>): [string, number][] {
    const best = new Map<string, number>()
    for (const ref of this.trucks) {
      if (!plates.has(ref.plate)) continue
      const d = featureDistance(features, ref.features)
      if (d < (best.get(ref.plate) ?? Infinity)) best.set(ref.plate, d)
    }
    return [...best.entries()].sort((a, b) => a[1] - b[1])
  }

  // Se completó el pesaje de esta patente: guarda la última foto con camión como
  // referencia suya (junto con la romana vacía usada de fondo).
  async learn(patente: string, now = Date.now()): Promise<LearnResult> {
    const truck = this.lastTruck
    if (!truck || truck.used || now - truck.time > LEARN_MAX_AGE_MS) {
      return {
        saved: false,
        reason: 'no hubo un camión detenido en la romana en los últimos 15 min'
      }
    }
    const live = this.liveEmpty
    const features = this.featuresAgainstLiveEmpty(truck.frame, truck.time)
    if (typeof features === 'string' || !live) {
      return { saved: false, reason: typeof features === 'string' ? features : 'sin fondo' }
    }

    const known = [...new Set(this.trucks.map((t) => t.plate))]
    const plate =
      known.find((p) => normalizePlate(p) === normalizePlate(patente)) ?? folderNameFor(patente)
    if (!plate) return { saved: false, reason: `patente inválida "${patente}"` }

    // Protección contra etiquetas equivocadas (ej. se completó el pesaje de otro
    // camión): si la foto es claramente de otro camión ya conocido, no se guarda.
    const active = this.activePlates()
    const ownCount = this.trucks.filter((t) => t.plate === plate).length
    if (active.has(plate) && ownCount >= LEARN_CONFLICT_MIN_REFS) {
      const ranked = this.rank(features, active)
      const own = ranked.find(([p]) => p === plate)?.[1] ?? Infinity
      const [other, otherDistance] = ranked[0]
      if (
        other !== plate &&
        otherDistance <= MAX_MATCH_DISTANCE &&
        own / Math.max(otherDistance, 1e-6) >= LEARN_CONFLICT_MARGIN
      ) {
        return { saved: false, reason: `la foto se parece mucho más a ${other}` }
      }
    }

    truck.used = true
    const truckDir = join(this.dir, plate)
    const emptyDir = join(this.dir, EMPTY_FOLDER)
    await mkdir(truckDir, { recursive: true })
    await mkdir(emptyDir, { recursive: true })
    const truckPath = join(truckDir, stampName(truck.time))
    await writeFile(truckPath, truck.jpeg)
    const emptyPath = join(emptyDir, stampName(live.time))
    if (!this.empties.some((e) => e.path === emptyPath)) {
      await writeFile(emptyPath, live.jpeg)
      this.empties.push({ ...live.frame, time: live.time, source: LEARN_SOURCE, path: emptyPath })
    }
    this.trucks.push({ plate, features, path: truckPath, time: truck.time })
    await this.trimOldest()

    const photos = this.trucks.filter((t) => t.plate === plate).length
    return { saved: true, plate, photos, active: photos >= MIN_REFS_TO_RECOGNIZE }
  }

  private async trimOldest(): Promise<void> {
    for (const plate of new Set(this.trucks.map((t) => t.plate))) {
      const refs = this.trucks.filter((t) => t.plate === plate).sort((a, b) => a.time - b.time)
      for (const old of refs.slice(0, Math.max(0, refs.length - MAX_REFS_PER_PLATE))) {
        await this.removeTruckRef(old.path)
      }
    }
    const empties = [...this.empties].sort((a, b) => a.time - b.time)
    for (const old of empties.slice(0, Math.max(0, empties.length - MAX_EMPTIES))) {
      this.empties = this.empties.filter((e) => e !== old)
      await rm(old.path, { force: true })
    }
  }

  private async removeTruckRef(path: string): Promise<void> {
    this.trucks = this.trucks.filter((t) => t.path !== path)
    await rm(path, { force: true })
  }

  // ---------- pantalla "Camiones conocidos" ----------

  listKnown(): KnownTruck[] {
    const counts = new Map<string, number>()
    for (const t of this.trucks) counts.set(t.plate, (counts.get(t.plate) ?? 0) + 1)
    return [...counts]
      .map(([plate, photos]): KnownTruck => ({
        plate,
        photos,
        status: this.paused.has(plate)
          ? 'pausado'
          : photos >= MIN_REFS_TO_RECOGNIZE
            ? 'activo'
            : 'juntando'
      }))
      .sort((a, b) => a.plate.localeCompare(b.plate))
  }

  listPhotos(plate: string): TruckPhoto[] {
    return this.trucks
      .filter((t) => t.plate === plate)
      .sort((a, b) => b.time - a.time)
      .map((t) => ({ file: basename(t.path), time: t.time, path: t.path }))
  }

  async deletePhoto(plate: string, file: string): Promise<void> {
    const ref = this.trucks.find((t) => t.plate === plate && basename(t.path) === file)
    if (ref) await this.removeTruckRef(ref.path)
  }

  async setPaused(plate: string, paused: boolean): Promise<void> {
    if (paused) this.paused.add(plate)
    else this.paused.delete(plate)
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, PAUSED_FILE), JSON.stringify([...this.paused], null, 2), 'utf-8')
  }
}
