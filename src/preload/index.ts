import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CameraConfig } from '../main/camera/config'
import type { CameraLogEntry, DetectionStatus } from '../main/camera/cameraService'
import type { KnownTruck, TruckPhotoThumb } from '../main/recognition/recognizer'

const api = {
  camera: {
    getConfig: (): Promise<CameraConfig> => ipcRenderer.invoke('camera:get-config'),
    saveConfig: (config: CameraConfig): Promise<CameraConfig> =>
      ipcRenderer.invoke('camera:save-config', config),
    testConnection: (config: CameraConfig): Promise<string> =>
      ipcRenderer.invoke('camera:test-connection', config),
    startDetection: (config: CameraConfig): Promise<DetectionStatus> =>
      ipcRenderer.invoke('camera:start-detection', config),
    stopDetection: (): Promise<DetectionStatus> => ipcRenderer.invoke('camera:stop-detection'),
    detectionStatus: (): Promise<DetectionStatus> => ipcRenderer.invoke('camera:detection-status'),
    enableAutoWeigh: (config: CameraConfig): Promise<DetectionStatus> =>
      ipcRenderer.invoke('camera:enable-auto-weigh', config),
    disableAutoWeigh: (): Promise<DetectionStatus> =>
      ipcRenderer.invoke('camera:disable-auto-weigh'),
    knownTrucks: (): Promise<KnownTruck[]> => ipcRenderer.invoke('camera:known-trucks'),
    truckPhotos: (plate: string): Promise<TruckPhotoThumb[]> =>
      ipcRenderer.invoke('camera:truck-photos', plate),
    deleteTruckPhoto: (plate: string, file: string): Promise<void> =>
      ipcRenderer.invoke('camera:delete-truck-photo', plate, file),
    setTruckPaused: (plate: string, paused: boolean): Promise<void> =>
      ipcRenderer.invoke('camera:set-truck-paused', plate, paused),
    onKnownChanged: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('camera:known-changed', listener)
      return () => ipcRenderer.removeListener('camera:known-changed', listener)
    },
    onDetectionStatus: (callback: (status: DetectionStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: DetectionStatus): void =>
        callback(status)
      ipcRenderer.on('camera:detection-status', listener)
      return () => ipcRenderer.removeListener('camera:detection-status', listener)
    },
    toggleMini: (): Promise<boolean> => ipcRenderer.invoke('camera:toggle-mini'),
    miniStatus: (): Promise<boolean> => ipcRenderer.invoke('camera:mini-status'),
    onLog: (callback: (entry: CameraLogEntry) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: CameraLogEntry): void =>
        callback(entry)
      ipcRenderer.on('camera:log', listener)
      return () => ipcRenderer.removeListener('camera:log', listener)
    },
    onPreviewFrame: (callback: (base64Jpeg: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, base64Jpeg: string): void =>
        callback(base64Jpeg)
      ipcRenderer.on('camera:preview-frame', listener)
      return () => ipcRenderer.removeListener('camera:preview-frame', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
