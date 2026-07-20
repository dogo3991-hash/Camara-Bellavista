import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface RoiFraction {
  x: number
  y: number
  w: number
  h: number
}

export interface CameraConfig {
  ip: string
  user: string
  password: string
  enabled: boolean
  motionRoi: RoiFraction
  plateRoi: RoiFraction
  matchMaxDistance: number
  matchMinMargin: number
}

const DEFAULT_ROI: RoiFraction = { x: 0, y: 0, w: 1, h: 1 }

export const DEFAULT_CONFIG: CameraConfig = {
  ip: '',
  user: '',
  password: '',
  enabled: false,
  motionRoi: DEFAULT_ROI,
  plateRoi: DEFAULT_ROI,
  matchMaxDistance: 2,
  matchMinMargin: 2
}

function configPath(): string {
  return join(app.getPath('userData'), 'camera-config.json')
}

export function loadConfig(): CameraConfig {
  const path = configPath()
  if (!existsSync(path)) return DEFAULT_CONFIG
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: CameraConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}
