import { spawn } from 'child_process'
import ffmpegPathRaw from 'ffmpeg-static'
import type { CameraConfig, RoiFraction } from './config'

// ffmpeg-static resuelve su ruta con __dirname, que en la app empaquetada apunta
// dentro del app.asar virtual — spawn() necesita la ruta real en disco, así que
// hay que redirigir a la carpeta desempaquetada (asarUnpack en electron-builder.yml).
// En dev no hay "app.asar" en la ruta, así que el replace no hace nada.
const ffmpegPath = ffmpegPathRaw?.replace('app.asar', 'app.asar.unpacked') ?? null

export type StreamKind = 'main' | 'sub'

export function buildRtspUrl(config: CameraConfig, stream: StreamKind): string {
  const subtype = stream === 'main' ? 0 : 1
  // Un espacio invisible de más (típico de copiar/pegar credenciales) arma una URL
  // levemente inválida: ffmpeg se queda esperando una conexión que nunca resuelve,
  // sin imprimir ningún error hasta el timeout — de ahí recortar acá, en el único
  // punto por el que pasan todas las operaciones de cámara.
  const user = encodeURIComponent(config.user.trim())
  const password = encodeURIComponent(config.password.trim())
  const ip = config.ip.trim()
  return `rtsp://${user}:${password}@${ip}:554/cam/realmonitor?channel=1&subtype=${subtype}`
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static no encontró el binario de ffmpeg'))
      return
    }
    const proc = spawn(ffmpegPath, args)
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      // Incluir lo que ffmpeg ya había reportado antes de matarlo — normalmente
      // ahí está la razón real (rechazo de usuario/contraseña, error de la
      // cámara, etc.), no solo "se agotó el tiempo".
      const detail = stderr.trim().slice(-500)
      reject(
        new Error(
          `Tiempo de espera agotado conectando a la cámara${detail ? `. Último mensaje de ffmpeg: ${detail}` : ' (ffmpeg no reportó nada antes de matarlo)'}`
        )
      )
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = Buffer.concat(chunks)
      if (output.length === 0) {
        reject(new Error(`ffmpeg no devolvió datos (código ${code}): ${stderr.slice(-500)}`))
        return
      }
      resolve(output)
    })
  })
}

export async function grabSnapshotJpeg(
  config: CameraConfig,
  stream: StreamKind = 'main',
  timeoutMs = 15000
): Promise<Buffer> {
  const url = buildRtspUrl(config, stream)
  return runFfmpeg(
    [
      '-rtsp_transport',
      'tcp',
      '-i',
      url,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1'
    ],
    timeoutMs
  )
}

function roiFilter(roi: RoiFraction): string {
  const w = `iw*${roi.w}`
  const h = `ih*${roi.h}`
  const x = `iw*${roi.x}`
  const y = `ih*${roi.y}`
  return `crop=${w}:${h}:${x}:${y}`
}

export interface RawGrayFrame {
  data: Buffer
  width: number
  height: number
}

export async function grabRoiRawGray(
  config: CameraConfig,
  roi: RoiFraction,
  targetWidth = 160,
  timeoutMs = 15000
): Promise<RawGrayFrame> {
  const url = buildRtspUrl(config, 'sub')
  const filter = `${roiFilter(roi)},scale=${targetWidth}:-1,format=gray`
  const buffer = await runFfmpeg(
    [
      '-rtsp_transport',
      'tcp',
      '-i',
      url,
      '-frames:v',
      '1',
      '-vf',
      filter,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1'
    ],
    timeoutMs
  )
  // La altura resultante no se conoce de antemano (scale=w:-1 preserva el aspecto);
  // se infiere dividiendo el total de bytes (1 byte/pixel en gray) por el ancho.
  const height = Math.round(buffer.length / targetWidth)
  return { data: buffer, width: targetWidth, height }
}

export async function grabRoiJpeg(
  config: CameraConfig,
  roi: RoiFraction,
  stream: StreamKind = 'main',
  timeoutMs = 15000
): Promise<Buffer> {
  const url = buildRtspUrl(config, stream)
  return runFfmpeg(
    [
      '-rtsp_transport',
      'tcp',
      '-i',
      url,
      '-frames:v',
      '1',
      '-vf',
      roiFilter(roi),
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1'
    ],
    timeoutMs
  )
}
