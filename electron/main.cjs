const { app, BrowserWindow, shell, protocol, net, ipcMain } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')
const { handleUguuUpload } = require('./uguu-upload.cjs')
const { handleMidjourneyProxy, handleImageDownload } = require('./midjourney-proxy.cjs')
const { createUpdateController, getUpdateFeed, isTrustedUpdateSender } = require('./desktop-updater.cjs')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
let mainWindow = null
let desktopUpdates = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
])

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: '艾特智绘',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = win
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) desktopUpdates?.setBusy(true)
  })
  win.on('closed', () => { mainWindow = null; desktopUpdates?.setBusy(true) })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadURL('app://local/index.html')
  }
}

app.whenReady().then(() => {
  const feed = getUpdateFeed(process.platform, process.arch)
  const updateEnabled = app.isPackaged && !isDev && Boolean(feed)
  // Only packaged Windows x64 clients get a network-capable updater.
  // Mac clients use the renderer's existing version.json manual-download flow.
  const updater = updateEnabled
    ? new (require('electron-updater').NsisUpdater)({ provider: 'generic', url: feed, channel: 'latest' })
    : new EventEmitter()
  desktopUpdates = createUpdateController({ updater, currentVersion: app.getVersion(), enabled: updateEnabled })
  desktopUpdates.subscribe(state => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Squirrel on macOS may validate/extract asynchronously after the user accepts.
      // Block new interactive work until installation quits or reports an error.
      mainWindow.setEnabled(state.status !== 'installing')
      mainWindow.webContents.send('desktop-update:changed', state)
    }
  })
  for (const [channel, action] of Object.entries({
    state: () => desktopUpdates.getState(), check: () => desktopUpdates.check(),
    download: () => desktopUpdates.download(), install: () => desktopUpdates.install(),
    busy: value => { desktopUpdates.setBusy(value); return undefined },
  })) {
    ipcMain.handle(`desktop-update:${channel}`, (event, value) => {
      if (!isTrustedUpdateSender(event, mainWindow?.webContents)) throw new Error('Untrusted update request')
      return action(value)
    })
  }
  desktopUpdates.start()
  if (!isDev) {
    const distDir = path.join(__dirname, '..', 'dist')

    protocol.handle('app', (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response('Not found', { status: 404 })
      if (url.pathname === '/media-upload/uguu') return handleUguuUpload(request, (...args) => net.fetch(...args))
      if (url.pathname.startsWith('/api-proxy/')) return handleMidjourneyProxy(request, (...args) => net.fetch(...args), process.env.API_PROXY_URL || 'https://vip.aittco.com')
      if (url.pathname === '/download-proxy') return handleImageDownload(request, (...args) => net.fetch(...args))
      let pathname = decodeURIComponent(url.pathname)

      if (pathname === '/' || pathname === '') {
        pathname = '/index.html'
      }

      const filePath = path.normalize(path.join(distDir, pathname))

      if (!filePath.startsWith(distDir)) {
        return new Response('Not found', { status: 404 })
      }

      return net.fetch(pathToFileURL(filePath).toString())
    })
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => desktopUpdates?.dispose())
