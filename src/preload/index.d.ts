import { ElectronAPI } from '@electron-toolkit/preload'
import type { CameraConfig } from '../main/camera/config'
import type { CameraLogEntry, DetectionStatus } from '../main/camera/cameraService'

import type { KnownTruck, TruckPhotoThumb } from '../main/recognition/recognizer'

export type { CameraLogEntry, DetectionStatus, KnownTruck, TruckPhotoThumb }

export interface CameraApi {
  getConfig: () => Promise<CameraConfig>
  saveConfig: (config: CameraConfig) => Promise<CameraConfig>
  testConnection: (config: CameraConfig) => Promise<string>
  startDetection: (config: CameraConfig) => Promise<DetectionStatus>
  stopDetection: () => Promise<DetectionStatus>
  detectionStatus: () => Promise<DetectionStatus>
  enableAutoWeigh: (config: CameraConfig) => Promise<DetectionStatus>
  disableAutoWeigh: () => Promise<DetectionStatus>
  knownTrucks: () => Promise<KnownTruck[]>
  truckPhotos: (plate: string) => Promise<TruckPhotoThumb[]>
  deleteTruckPhoto: (plate: string, file: string) => Promise<void>
  setTruckPaused: (plate: string, paused: boolean) => Promise<void>
  onKnownChanged: (callback: () => void) => () => void
  onDetectionStatus: (callback: (status: DetectionStatus) => void) => () => void
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
