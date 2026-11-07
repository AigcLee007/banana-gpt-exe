const FEED_BASE = 'https://m.aittco.com/downloads/updates'

function getUpdateFeed(platform, arch) {
  const directory = platform === 'win32' && arch === 'x64' ? 'win-x64'
    : platform === 'darwin' && ['arm64', 'x64'].includes(arch) ? `mac-${arch}` : null
  return directory ? `${FEED_BASE}/${directory}/` : null
}

function isTrustedUpdateSender(event, webContents) {
  return Boolean(webContents && event.sender === webContents && event.senderFrame &&
    event.senderFrame.url === 'app://local/index.html' &&
    (!webContents.mainFrame || event.senderFrame === webContents.mainFrame))
}

function releaseNotes(info) {
  const notes = info?.releaseNotes
  return (typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map(item => item.note || '').join('\n') : '').slice(0, 12000)
}

function publicError(error) {
  const text = String(error?.message || error)
  if (/signature|sha512|checksum|certificate|code.?sign/i.test(text)) return '更新包校验失败，请稍后重试或联系支持人员。'
  if (/404|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i.test(text)) return '更新文件尚未就绪，请稍后重试。'
  if (/network|ENOTFOUND|ECONN|ETIMEDOUT|net::/i.test(text)) return '更新服务器连接失败，请检查网络后重试。'
  return '更新失败，请稍后重试。'
}

/** State machine independent of Electron, so download and install guards can be tested. */
function createUpdateController({ updater, currentVersion, enabled = true }) {
  let state = { status: enabled ? 'idle' : 'unsupported', currentVersion }
  let busy = true // Fail closed until the renderer reports all active work.
  let checking = null
  let downloading = null
  let startupTimer = null
  let intervalTimer = null
  let disposed = false
  let downloadedVersion = null
  const listeners = new Set()
  const handlers = []
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = true
  updater.channel = 'latest'
  updater.allowPrerelease = true // Public releases use the existing -banana.N version scheme.
  updater.allowDowngrade = false // Setting a channel otherwise enables downgrades.

  const getState = () => ({ ...state })
  function publish(patch) {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener(getState())
  }
  function fail(error, stage) {
    if (state.status === 'downloaded' && stage !== 'install') return
    publish({ status: 'error', error: publicError(error), errorStage: stage })
  }
  function on(event, handler) {
    const guarded = (...args) => { if (enabled && !disposed) handler(...args) }
    updater.on(event, guarded)
    handlers.push([event, guarded])
  }

  async function check() {
    if (!enabled || disposed || ['downloading', 'downloaded', 'installing'].includes(state.status)) return getState()
    if (checking) return checking
    publish({ status: 'checking', error: undefined, errorStage: undefined })
    checking = Promise.resolve().then(() => updater.checkForUpdates())
      .catch(error => fail(error, 'check'))
      .then(getState).finally(() => { checking = null })
    return checking
  }
  async function download() {
    if (!enabled || disposed || ['downloaded', 'installing'].includes(state.status)) return getState()
    if (downloading) return downloading
    if (!state.version || !['available', 'error'].includes(state.status)) return getState()
    publish({ status: 'downloading', percent: 0, error: undefined, errorStage: undefined })
    // Assign before executing the updater, so duplicate available events cannot start twice.
    downloading = Promise.resolve().then(() => updater.downloadUpdate())
      .catch(error => fail(error, 'download'))
      .then(getState).finally(() => { downloading = null })
    return downloading
  }
  on('update-available', info => {
    if (['downloading', 'downloaded', 'installing'].includes(state.status)) return
    publish({ status: 'available', version: info.version, notes: releaseNotes(info), error: undefined })
    void download()
  })
  on('update-not-available', () => { if (!['downloading', 'downloaded', 'installing'].includes(state.status)) publish({ status: 'not-available', error: undefined }) })
  on('download-progress', info => {
    if (state.status !== 'downloading') return
    publish({ percent: Number.isFinite(info.percent) ? Math.min(100, Math.max(0, info.percent)) : 0, transferred: info.transferred, total: info.total })
  })
  on('update-downloaded', info => {
    downloadedVersion = info.version
    if (state.status !== 'installing') publish({ status: 'downloaded', version: info.version, notes: releaseNotes(info) || state.notes, percent: 100, error: undefined, errorStage: undefined })
  })
  on('error', error => fail(error, state.status === 'installing' ? 'install' : state.status === 'downloading' ? 'download' : 'check'))

  return {
    getState, check, download,
    setBusy(value) { busy = value !== false },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async install() {
      if (!enabled || disposed || !downloadedVersion || !['downloaded', 'error'].includes(state.status)) return { ok: false, message: '更新尚未下载完成。' }
      if (busy) return { ok: false, message: '当前有任务或上传进行中，请完成后再重启更新。' }
      publish({ status: 'installing', error: undefined, errorStage: undefined })
      try { updater.quitAndInstall(false, true); return { ok: true } }
      catch (error) { fail(error, 'install'); return { ok: false, message: publicError(error) } }
    },
    start() {
      if (!enabled || disposed || startupTimer || intervalTimer) return
      startupTimer = setTimeout(() => { startupTimer = null; void check() }, 10000)
      intervalTimer = setInterval(() => { void check() }, 4 * 60 * 60 * 1000)
      startupTimer.unref?.(); intervalTimer.unref?.()
    },
    dispose() {
      disposed = true
      clearTimeout(startupTimer); clearInterval(intervalTimer)
      for (const [event, handler] of handlers) updater.removeListener(event, handler)
      listeners.clear()
    },
  }
}

module.exports = { createUpdateController, getUpdateFeed, isTrustedUpdateSender }
