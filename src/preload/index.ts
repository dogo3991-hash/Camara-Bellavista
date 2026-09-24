import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CameraConfig } from '../main/camera/config'
import type { CameraLogEntry } from '../main/camera/cameraService'

const api = {
  camera: {
    getConfig: (): Promise<CameraConfig> => ipcRenderer.invoke('camera:get-config'),
    saveConfig: (config: CameraConfig): Promise<CameraConfig> =>
      ipcRenderer.invoke('camera:save-config', config),
    testConnection: (config: CameraConfig): Promise<string> =>
      ipcRenderer.invoke('camera:test-connection', config),
    startDetection: (config: CameraConfig): Promise<void> =>
      ipcRenderer.invoke('camera:start-detection', config),
    stopDetection: (): Promise<void> => ipcRenderer.invoke('camera:stop-detection'),
    detectionStatus: (): Promise<boolean> => ipcRenderer.invoke('camera:detection-status'),
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
