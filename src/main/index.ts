import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadConfig, saveConfig, type CameraConfig } from './camera/config'
import { grabSnapshotJpeg } from './camera/rtsp'
import { cameraService, type CameraLogEntry } from './camera/cameraService'
import { startWsServer, stopWsServer } from './wsServer'
import { setupAutoUpdater } from './autoUpdate'

// Esta app corre empaquetada sin consola adjunta: si stdout/stderr queda como un pipe
// roto, cualquier console.log/error revienta el proceso principal con EPIPE (el error
// "A JavaScript error occurred in the main process" que se ve a veces). Ignorarlo acá
// evita que un log de rutina tire abajo toda la app.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err
})
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err
})

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
// La mini ventana solo se cierra desde el botón de la app (Alt+F4 u otros
// intentos de cierre se ignoran mientras esta bandera esté en false).
let allowMiniClose = false

const MINI_WIDTH = 320
const MINI_HEIGHT = 180
const MINI_MARGIN = 16

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function openMiniWindow(): void {
  if (miniWindow) return

  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x: workArea.x + workArea.width - MINI_WIDTH - MINI_MARGIN,
    y: workArea.y + workArea.height - MINI_HEIGHT - MINI_MARGIN,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Nivel 'screen-saver' para quedar por encima del navegador u otras apps
  // aunque tomen el foco.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.setAspectRatio(16 / 9)

  win.on('close', (event) => {
    if (!allowMiniClose) event.preventDefault()
  })
  win.on('closed', () => {
    miniWindow = null
  })

  allowMiniClose = false
  miniWindow = win
  loadRenderer(win, 'mini')
}

function closeMiniWindow(): void {
  if (!miniWindow) return
  allowMiniClose = true
  miniWindow.destroy()
  miniWindow = null
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  const win = mainWindow

  win.on('ready-to-show', () => {
    win.show()
  })

  // Si se cierra la app principal, la mini no debe quedar huérfana (y así
  // 'window-all-closed' se dispara y la app termina).
  win.on('closed', () => {
    mainWindow = null
    closeMiniWindow()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win)
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

  ipcMain.handle('camera:toggle-mini', () => {
    if (miniWindow) closeMiniWindow()
    else openMiniWindow()
    return miniWindow !== null
  })

  ipcMain.handle('camera:mini-status', () => miniWindow !== null)

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
  startWsServer((base64Jpeg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('camera:preview-frame', base64Jpeg)
    }
  })
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
