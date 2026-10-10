// Cálculos del reconocimiento de camiones, sin dependencias de Electron. Es el
// mismo método que acertó 46/46 en SLM-Camara-Pruebas\prueba-capturas-reales.py:
// se resta la romana vacía para quedarse con el camión y se compara su color
// (histograma tono/saturación) y su disposición (grilla 4x4 de color medio).

// Imagen RGB con valores 0..1, fila por fila.
export interface RgbImage {
  width: number
  height: number
  data: Float32Array
}

// Todas las zonas están en fracciones del cuadro completo, así no dependen de la
// resolución de la cámara (las capturas son 2688x1520).
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

// Imagen reducida 8 veces (336x190) sobre la que se trabaja.
export const SMALL_WIDTH = 336
export const SMALL_HEIGHT = 190
// Zona de la romana donde queda la cabina, sin la hora que imprime la cámara.
export const TRUCK_BOX: Box = { x0: 880 / 2688, y0: 90 / 1520, x1: 2320 / 2688, y1: 1250 / 1520 }
// Suelo a la izquierda que nunca pisa un camión: sirve para igualar la exposición.
export const GROUND_BOX: Box = { x0: 0, y0: 400 / 1520, x1: 800 / 2688, y1: 1400 / 1520 }
// Zona de la cabina para el chequeo de presencia (se lee aparte, a 55x55).
export const CAB_BOX: Box = { x0: 1250 / 2688, y0: 250 / 1520, x1: 1800 / 2688, y1: 800 / 1520 }
export const CAB_SIZE = 55

// Con camión la zona de la cabina cambia ≥53 % respecto de la romana vacía más
// parecida; vacía, ≤5 % (capturas reales del 9 y 10 de octubre de 2026).
export const PRESENCE_THRESHOLD = 0.29
// Mínimo de 2º camión / camión elegido para dar por buena la identificación.
export const MIN_MARGIN = 1.05

export function cropImage(img: RgbImage, box: Box): RgbImage {
  const x0 = Math.floor(box.x0 * img.width)
  const y0 = Math.floor(box.y0 * img.height)
  const x1 = Math.floor(box.x1 * img.width)
  const y1 = Math.floor(box.y1 * img.height)
  const width = x1 - x0
  const height = y1 - y0
  const data = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * img.width + x0) * 3
    data.set(img.data.subarray(src, src + width * 3), y * width * 3)
  }
  return { width, height, data }
}

export function meanValue(img: RgbImage): number {
  let sum = 0
  for (let i = 0; i < img.data.length; i++) sum += img.data[i]
  return sum / Math.max(1, img.data.length)
}

// ---------- presencia ----------

// La zona de la cabina se normaliza por su brillo medio para no depender de la exposición.
export function normalizeCab(cab: RgbImage): RgbImage {
  const mean = Math.max(meanValue(cab), 1e-3)
  const data = new Float32Array(cab.data.length)
  for (let i = 0; i < data.length; i++) data[i] = cab.data[i] / mean
  return { width: cab.width, height: cab.height, data }
}

// Fracción de la zona de cabina que difiere de una romana vacía.
export function cabDifference(a: RgbImage, b: RgbImage): number {
  const n = a.width * a.height
  let changed = 0
  for (let i = 0; i < n; i++) {
    const d =
      Math.abs(a.data[i * 3] - b.data[i * 3]) +
      Math.abs(a.data[i * 3 + 1] - b.data[i * 3 + 1]) +
      Math.abs(a.data[i * 3 + 2] - b.data[i * 3 + 2])
    if (d > 0.35) changed++
  }
  return changed / n
}

// ---------- máscara del camión ----------

function boxBlur(mask: Float32Array, width: number, height: number, k = 2): Float32Array {
  const out = new Float32Array(mask.length)
  const area = (2 * k + 1) ** 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -k; dy <= k; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -k; dx <= k; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          sum += mask[yy * width + xx]
        }
      }
      out[y * width + x] = sum / area
    }
  }
  return out
}

// Píxeles que pertenecen al camión: distintos a la romana vacía y que no son sombra
// (la sombra oscurece los 3 canales en la misma proporción).
export function truckMask(
  img: RgbImage,
  groundImg: number,
  bg: RgbImage,
  groundBg: number
): Uint8Array {
  const n = img.width * img.height
  const gain = groundImg / Math.max(groundBg, 1e-3)
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let diff = 0
    let rMax = -Infinity
    let rMin = Infinity
    for (let c = 0; c < 3; c++) {
      const v = img.data[i * 3 + c]
      const b = Math.min(1, Math.max(0, bg.data[i * 3 + c] * gain))
      diff += Math.abs(v - b)
      const ratio = (v + 0.02) / (b + 0.02)
      rMax = Math.max(rMax, ratio)
      rMin = Math.min(rMin, ratio)
    }
    const changed = diff > 0.25
    const shadow = rMax < 0.8 && rMax - rMin < 0.18
    raw[i] = changed && !shadow ? 1 : 0
  }
  const blurred = boxBlur(raw, img.width, img.height)
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = blurred[i] > 0.5 ? 1 : 0
  return mask
}

export function maskCount(mask: Uint8Array): number {
  let count = 0
  for (let i = 0; i < mask.length; i++) count += mask[i]
  return count
}

// ---------- características y distancia ----------

export interface TruckFeatures {
  hist: Float64Array
  grid: Float64Array // 4x4 celdas x RGB
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === r) h = ((((g - b) / d) % 6) + 6) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, mx > 0 ? d / Math.max(mx, 1e-6) : 0, mx]
}

export function truckFeatures(img: RgbImage, mask: Uint8Array): TruckFeatures {
  const { width, height, data } = img
  // Histograma: 18 tonos x 3 saturaciones + 4 niveles de gris para lo sin color.
  const hist = new Float64Array(18 * 3 + 4)
  let count = 0
  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  const mean = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      const r = data[i * 3]
      const g = data[i * 3 + 1]
      const b = data[i * 3 + 2]
      const [h, s, v] = rgbToHsv(r, g, b)
      if (s < 0.15 || v < 0.12) {
        hist[54 + Math.min(3, Math.floor(v * 4))]++
      } else {
        const hi = Math.floor(h / 20) % 18
        const si = Math.min(2, Math.floor(((s - 0.15) / 0.85) * 3))
        hist[hi * 3 + si]++
      }
      mean[0] += r
      mean[1] += g
      mean[2] += b
      count++
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x + 1 > x1) x1 = x + 1
      if (y + 1 > y1) y1 = y + 1
    }
  }
  for (let k = 0; k < hist.length; k++) hist[k] /= Math.max(1, count)
  for (let c = 0; c < 3; c++) mean[c] /= Math.max(1, count)

  // Grilla 4x4 de color medio dentro del recuadro del camión.
  const grid = new Float64Array(16 * 3)
  const bw = x1 - x0
  const bh = y1 - y0
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cy0 = y0 + Math.floor((gy * bh) / 4)
      const cy1 = y0 + Math.floor(((gy + 1) * bh) / 4)
      const cx0 = x0 + Math.floor((gx * bw) / 4)
      const cx1 = x0 + Math.floor(((gx + 1) * bw) / 4)
      const sum = [0, 0, 0]
      let n = 0
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          const i = y * width + x
          if (!mask[i]) continue
          sum[0] += data[i * 3]
          sum[1] += data[i * 3 + 1]
          sum[2] += data[i * 3 + 2]
          n++
        }
      }
      const cell = (gy * 4 + gx) * 3
      for (let c = 0; c < 3; c++) grid[cell + c] = n > 5 ? sum[c] / n : mean[c]
    }
  }
  return { hist, grid }
}

export function featureDistance(a: TruckFeatures, b: TruckFeatures): number {
  let bc = 0
  for (let i = 0; i < a.hist.length; i++) bc += Math.sqrt(a.hist[i] * b.hist[i])
  const dHist = Math.sqrt(Math.max(0, 1 - bc))
  let dGrid = 0
  for (let c = 0; c < 16; c++) {
    dGrid += Math.hypot(
      a.grid[c * 3] - b.grid[c * 3],
      a.grid[c * 3 + 1] - b.grid[c * 3 + 1],
      a.grid[c * 3 + 2] - b.grid[c * 3 + 2]
    )
  }
  return 0.6 * dHist + 0.4 * (dGrid / 16)
}
