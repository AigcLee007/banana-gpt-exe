import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { createUpdateController, getUpdateFeed, isTrustedUpdateSender } = require('../../electron/desktop-updater.cjs')

function setup(enabled = true) {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => null), downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn(),
    autoDownload: true, autoInstallOnAppQuit: true, channel: '', allowDowngrade: true, allowPrerelease: false,
  })
  const controller = createUpdateController({ updater, currentVersion: '0.4.6-banana.20', enabled })
  return { updater, controller }
}
afterEach(() => vi.useRealTimers())

describe('native desktop updater', () => {
  it.each([['win32', 'x64', 'win-x64']])('isolates %s %s update feed', (platform, arch, feed) => {
    expect(getUpdateFeed(platform, arch)).toBe(`https://m.aittco.com/downloads/updates/${feed}/`)
  })
  it('does not provide a native update feed for macOS', () => {
    expect(getUpdateFeed('darwin', 'arm64')).toBeNull()
    expect(getUpdateFeed('darwin', 'x64')).toBeNull()
  })
  it('rejects unsupported platforms and untrusted IPC senders', () => {
    expect(getUpdateFeed('linux', 'x64')).toBeNull()
    const contents = {}
    expect(isTrustedUpdateSender({ sender: contents, senderFrame: { url: 'app://local/index.html' } }, contents)).toBe(true)
    for (const url of ['https://evil.invalid/', 'app://evil/index.html', 'app://local/other.html', 'app://local/index.html?evil=1']) {
      expect(isTrustedUpdateSender({ sender: contents, senderFrame: { url } }, contents)).toBe(false)
    }
    expect(isTrustedUpdateSender({ sender: {}, senderFrame: { url: 'app://local/index.html' } }, contents)).toBe(false)
    const frame = { url: 'app://local/index.html' }
    const realContents = { mainFrame: frame }
    expect(isTrustedUpdateSender({ sender: realContents, senderFrame: frame }, realContents)).toBe(true)
    expect(isTrustedUpdateSender({ sender: realContents, senderFrame: { url: 'app://local/index.html' } }, realContents)).toBe(false)
  })
  it('disables automatic quit installation, pins latest and prevents downgrade', () => {
    const { updater } = setup()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.channel).toBe('latest')
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(true)
  })
  it('checks at startup and periodically, deduplicating in-flight operations', async () => {
    vi.useFakeTimers()
    const { updater, controller } = setup()
    controller.start()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('automatically downloads once, publishes bounded progress and keeps downloaded state', async () => {
    const { updater, controller } = setup()
    const states: string[] = []
    controller.subscribe((state: { status: string }) => states.push(state.status))
    updater.emit('update-available', { version: '0.4.6-banana.21', releaseNotes: '新增功能' })
    updater.emit('update-available', { version: '0.4.6-banana.21' })
    await Promise.resolve()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    updater.emit('download-progress', { percent: 150, transferred: 200, total: 100 })
    expect(controller.getState()).toMatchObject({ status: 'downloading', percent: 100 })
    updater.emit('update-downloaded', { version: '0.4.6-banana.21' })
    await controller.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'downloaded', version: '0.4.6-banana.21', percent: 100 })
    expect(states).toContain('available')
  })
  it('blocks install until work status arrives, and while busy, then explicitly installs', async () => {
    const { updater, controller } = setup()
    expect((await controller.install()).ok).toBe(false)
    updater.emit('update-downloaded', { version: '0.4.6-banana.21' })
    expect((await controller.install()).ok).toBe(false)
    controller.setBusy(true)
    expect((await controller.install()).ok).toBe(false)
    controller.setBusy(false)
    expect(await controller.install()).toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
    expect(controller.getState().status).toBe('installing')
    await controller.check(); await controller.download()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
  it('surfaces asynchronous native install errors and allows a later explicit retry', async () => {
    const { updater, controller } = setup()
    updater.emit('update-downloaded', { version: '0.4.6-banana.21' })
    controller.setBusy(false)
    await controller.install()
    updater.emit('error', new Error('native signature validation failed'))
    expect(controller.getState()).toMatchObject({ status: 'error', errorStage: 'install' })
    expect(controller.getState().error).toContain('校验失败')
    await controller.install()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    expect(controller.getState().status).toBe('installing')
  })
  it('reports a failed check safely and supports retry', async () => {
    const { updater, controller } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('private-path or credential'))
    await controller.check()
    expect(controller.getState()).toMatchObject({ status: 'error', errorStage: 'check' })
    expect(controller.getState().error).not.toContain('private-path')
    updater.checkForUpdates.mockImplementationOnce(async () => { updater.emit('update-not-available'); return null })
    await controller.check()
    expect(controller.getState().status).toBe('not-available')
  })
  it('deduplicates concurrent checks and does not install from a disposed controller', async () => {
    const { updater, controller } = setup()
    let finish!: () => void
    updater.checkForUpdates.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }) as never)
    const first = controller.check(), second = controller.check()
    await Promise.resolve()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    finish(); await Promise.all([first, second])
    updater.emit('update-downloaded', { version: '0.4.6-banana.21' })
    controller.setBusy(false)
    controller.dispose()
    expect((await controller.install()).ok).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('retries downloads after network error without reinstalling or resetting a ready update', async () => {
    const { updater, controller } = setup()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('network'))
    updater.emit('update-available', { version: '0.4.6-banana.21' })
    await vi.waitFor(() => expect(controller.getState().status).toBe('error'))
    expect(controller.getState().errorStage).toBe('download')
    await controller.download()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    updater.emit('update-downloaded', { version: '0.4.6-banana.21' })
    updater.emit('error', new Error('late unrelated event'))
    expect(controller.getState().status).toBe('downloaded')
  })
  it('never checks or downloads in an unsupported/unpackaged runtime', async () => {
    const { updater, controller } = setup(false)
    await controller.check(); await controller.download()
    updater.emit('update-available', { version: '10.0.0' })
    expect(controller.getState().status).toBe('unsupported')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })
})

describe('context isolated updater preload', () => {
  it('exposes only bounded operations and strips Electron events from subscribers', async () => {
    let bridge: any
    let receive: any
    const invoke = vi.fn(async (..._args: unknown[]) => null), removeListener = vi.fn()
    runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
      require: (module: string) => {
        expect(module).toBe('electron')
        return {
          contextBridge: { exposeInMainWorld: (name: string, api: any) => { expect(name).toBe('desktopUpdater'); bridge = api } },
          ipcRenderer: { invoke, on: (_name: string, listener: any) => { receive = listener }, removeListener },
        }
      },
    })
    expect(Object.keys(bridge).sort()).toEqual(['check', 'download', 'getState', 'install', 'onState', 'setBusy'])
    await bridge.check(); await bridge.download(); await bridge.install(); await bridge.getState(); await bridge.setBusy(true)
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['desktop-update:check', 'desktop-update:download', 'desktop-update:install', 'desktop-update:state', 'desktop-update:busy'])
    const listener = vi.fn(), stop = bridge.onState(listener)
    const state = { status: 'downloaded' }
    receive({ sender: 'must not escape' }, state)
    expect(listener).toHaveBeenCalledExactlyOnceWith(state)
    stop()
    expect(removeListener).toHaveBeenCalledWith('desktop-update:changed', receive)
  })
})
