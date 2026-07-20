import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadConfig, saveConfig, type CameraConfig } from './camera/config'
import { grabSnapshotJpeg } from './camera/rtsp'
import { cameraService, type CameraLogEntry } from './camera/cameraService'
import { startWsServer, stopWsServer } from './wsServer'
import { setupAutoUpdater } from './autoUpdate'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerCameraIpc(): void {
  ipcMain.handle('camera:get-config', () => loadConfig())

  ipcMain.handle('camera:save-config', (_event, config: CameraConfig) => {
    saveConfig(config)
    return config
  })

  ipcMain.handle('camera:test-connection', async (_event, config: CameraConfig) => {
    const jpeg = await grabSnapshotJpeg(config, 'main')
    return jpeg.toString('base64')
  })

  ipcMain.handle('camera:start-detection', (_event, config: CameraConfig) => {
    cameraService.start(config)
  })

  ipcMain.handle('camera:stop-detection', () => {
    cameraService.stop()
  })

  ipcMain.handle('camera:detection-status', () => cameraService.isRunning())

  cameraService.on('log', (entry: CameraLogEntry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('camera:log', entry)
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.slmbellavista.camararomana')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerCameraIpc()
  startWsServer()
  setupAutoUpdater()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWsServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
