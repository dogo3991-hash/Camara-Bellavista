import { createWorker, type Worker } from 'tesseract.js'
import { join } from 'path'

const TESSDATA_DIR = join(__dirname, '../../resources/tessdata')

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: TESSDATA_DIR,
      cachePath: TESSDATA_DIR,
      gzip: true
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '7' as never // PSM.SINGLE_LINE
      })
      return worker
    })
  }
  return workerPromise
}

export interface PlateReading {
  text: string
  confidence: number
}

export async function recognizePlate(imageBuffer: Buffer): Promise<PlateReading> {
  const worker = await getWorker()
  const { data } = await worker.recognize(imageBuffer)
  const text = data.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return { text, confidence: data.confidence }
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise
  workerPromise = null
  await worker.terminate()
}
