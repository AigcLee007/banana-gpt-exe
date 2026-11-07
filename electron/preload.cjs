const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopUpdater', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop-update:state'),
  check: () => ipcRenderer.invoke('desktop-update:check'),
  download: () => ipcRenderer.invoke('desktop-update:download'),
  install: () => ipcRenderer.invoke('desktop-update:install'),
  setBusy: busy => ipcRenderer.invoke('desktop-update:busy', busy === true),
  onState: listener => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('desktop-update:changed', handler)
    return () => ipcRenderer.removeListener('desktop-update:changed', handler)
  },
}))
