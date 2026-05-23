const { app, BrowserWindow, shell, protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

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
    title: 'Banana GPT',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

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
  if (!isDev) {
    const distDir = path.join(__dirname, '..', 'dist')

    protocol.handle('app', (request) => {
      const url = new URL(request.url)
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