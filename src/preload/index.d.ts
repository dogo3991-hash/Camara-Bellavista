import { ElectronAPI } from '@electron-toolkit/preload'
import type { CameraConfig } from '../main/camera/config'
import type { CameraLogEntry } from '../main/camera/cameraService'

export type { CameraLogEntry }

export interface CameraApi {
  getConfig: () => Promise<CameraConfig>
  saveConfig: (config: CameraConfig) => Promise<CameraConfig>
  testConnection: (config: CameraConfig) => Promise<string>
  startDetection: (config: CameraConfig) => Promise<void>
  stopDetection: () => Promise<void>
  detectionStatus: () => Promise<boolean>
  toggleMini: () => Promise<boolean>
  miniStatus: () => Promise<boolean>
  onLog: (callback: (entry: CameraLogEntry) => void) => () => void
  onPreviewFrame: (callback: (base64Jpeg: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      camera: CameraApi
    }
  }
}
