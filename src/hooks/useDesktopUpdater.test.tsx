// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { DesktopUpdateState, DesktopUpdater } from '../lib/desktopUpdater'
import { beginDesktopWork } from '../lib/desktopWorkActivity'

vi.mock('../store', () => ({ useStore: create(() => ({ tasks: [] as { status: string }[], agentConversations: [] as { rounds: { status: string }[] }[] })) }))
vi.mock('../videoStore', () => ({ useVideoStore: create(() => ({ tasks: [] as { status: string }[], isGenerating: false, uploadingFiles: new Set<string>() })) }))

import { useStore } from '../store'
import { useDesktopUpdater } from './useDesktopUpdater'

let result: ReturnType<typeof useDesktopUpdater>
function Probe() { result = useDesktopUpdater(); return null }
let root: Root
let listener: (state: DesktopUpdateState) => void
let bridge: DesktopUpdater
let unsubscribe: ReturnType<typeof vi.fn<() => void>>
const downloaded: DesktopUpdateState = { status: 'downloaded', currentVersion: '1.0.0', version: '1.1.0' }

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useStore.setState({ tasks: [], agentConversations: [] })
  unsubscribe = vi.fn()
  bridge = {
    getState: vi.fn().mockResolvedValue({ status: 'idle', currentVersion: '1.0.0' }),
    check: vi.fn().mockResolvedValue({ status: 'not-available', currentVersion: '1.0.0' }),
    download: vi.fn().mockResolvedValue({ status: 'downloading', currentVersion: '1.0.0' }),
    install: vi.fn().mockResolvedValue({ ok: true }), setBusy: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn((callback) => { listener = callback; return unsubscribe }),
  }
  window.desktopUpdater = bridge
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  delete window.desktopUpdater
})
const mount = async () => { await act(async () => root.render(<Probe />)) }

describe('native update lifecycle', () => {
  it('handles settings check, backgrounds progress, resurfaces completion and cleans up listeners', async () => {
    await mount()
    expect(result.native).toBe(true)
    expect(bridge.check).not.toHaveBeenCalled()
    await act(async () => window.dispatchEvent(new CustomEvent('app:check-update', { detail: { manual: true } })))
    expect(bridge.check).toHaveBeenCalledTimes(1)
    expect(result.visible).toBe(true)
    await act(async () => listener({ status: 'downloading', currentVersion: '1.0.0', percent: 10 }))
    await act(async () => result.dismiss())
    await act(async () => listener({ status: 'downloading', currentVersion: '1.0.0', percent: 20 }))
    expect(result.visible).toBe(false)
    await act(async () => listener(downloaded))
    expect(result.visible).toBe(true)
    expect(bridge.install).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new CustomEvent('app:check-update'))
    expect(bridge.check).toHaveBeenCalledTimes(1)
  })

  it('reports store work changes and re-reads the latest work before an explicit install', async () => {
    await mount()
    expect(bridge.setBusy).toHaveBeenCalledWith(false)
    await act(async () => listener(downloaded))
    await act(async () => useStore.setState({ tasks: [{ status: 'running' }] as never }))
    expect(result.busy).toBe(true)
    await act(async () => result.install())
    expect(bridge.setBusy).toHaveBeenLastCalledWith(true)
    expect(bridge.install).not.toHaveBeenCalled()
    await act(async () => useStore.setState({ tasks: [] }))
    await act(async () => result.install())
    expect(bridge.install).toHaveBeenCalledTimes(1)
  })

  it('does not let an old initial snapshot overwrite a newer native event', async () => {
    let resolve!: (state: DesktopUpdateState) => void
    bridge.getState = vi.fn(() => new Promise<DesktopUpdateState>((done) => { resolve = done }))
    await mount()
    await act(async () => listener(downloaded))
    await act(async () => resolve({ status: 'idle', currentVersion: '1.0.0' }))
    expect(result.state?.status).toBe('downloaded')
  })

  it('keeps native behavior inactive on the web', async () => {
    delete window.desktopUpdater
    await mount()
    window.dispatchEvent(new CustomEvent('app:check-update'))
    expect(result.native).toBe(false)
    expect(bridge.getState).not.toHaveBeenCalled()
    expect(bridge.check).not.toHaveBeenCalled()
    expect(bridge.setBusy).not.toHaveBeenCalled()
  })

  it('ignores an initial snapshot returned after a manual check has begun', async () => {
    let resolveInitial!: (state: DesktopUpdateState) => void
    let resolveCheck!: (state: DesktopUpdateState) => void
    bridge.getState = () => new Promise((resolve) => { resolveInitial = resolve })
    bridge.check = () => new Promise((resolve) => { resolveCheck = resolve })
    await mount()
    let checking!: Promise<void>
    await act(async () => { checking = result.check() })
    await act(async () => resolveInitial({ status: 'idle', currentVersion: '1.0.0' }))
    expect(result.state?.status).toBe('checking')
    await act(async () => { resolveCheck({ status: 'not-available', currentVersion: '1.0.0' }); await checking })
    expect(result.state?.status).toBe('not-available')
  })

  it('surfaces bridge failures as recoverable check, download and install states', async () => {
    await mount()
    bridge.check = vi.fn().mockRejectedValue(new Error('offline'))
    await act(async () => result.check())
    expect(result.state).toMatchObject({ status: 'error', errorStage: 'check' })
    bridge.download = vi.fn().mockRejectedValue(new Error('offline'))
    await act(async () => result.download())
    expect(result.state).toMatchObject({ status: 'error', errorStage: 'download' })
    bridge.install = vi.fn().mockResolvedValue({ ok: false, message: 'cannot install' })
    await act(async () => result.install())
    expect(result.state).toMatchObject({ status: 'error', errorStage: 'install', error: 'cannot install' })
    bridge.install = vi.fn().mockRejectedValue(new Error('IPC disconnected'))
    await act(async () => result.install())
    expect(result.state).toMatchObject({ status: 'error', errorStage: 'install' })
    expect(result.state?.error).toBeUndefined()
    expect(result.pending).toBe(false)
  })

  it('keeps installation visible and blocks actions until an asynchronous install error', async () => {
    await mount()
    await act(async () => listener(downloaded))
    await act(async () => result.dismiss())
    await act(async () => listener({ ...downloaded, status: 'installing' }))
    expect(result.visible).toBe(true)
    await act(async () => result.dismiss())
    expect(result.visible).toBe(true)
    await act(async () => { await result.check(); await result.download(); await result.install() })
    expect(bridge.check).not.toHaveBeenCalled()
    expect(bridge.download).not.toHaveBeenCalled()
    expect(bridge.install).not.toHaveBeenCalled()
    await act(async () => listener({ ...downloaded, status: 'error', errorStage: 'install', error: '更新失败，请稍后重试。' }))
    await act(async () => result.install())
    expect(bridge.install).toHaveBeenCalledTimes(1)
    await act(async () => result.dismiss())
    expect(result.visible).toBe(false)
  })

  it('subscribes to external work and prevents installation while it is active', async () => {
    await mount()
    await act(async () => listener(downloaded))
    let finish!: () => void
    await act(async () => { finish = beginDesktopWork() })
    try {
      expect(result.busy).toBe(true)
      expect(bridge.setBusy).toHaveBeenLastCalledWith(true)
      await act(async () => result.install())
      expect(bridge.install).not.toHaveBeenCalled()
    } finally { await act(async () => finish()) }
    expect(result.busy).toBe(false)
    expect(bridge.setBusy).toHaveBeenLastCalledWith(false)
    await act(async () => result.install())
    expect(bridge.install).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    const count = vi.mocked(bridge.setBusy).mock.calls.length
    beginDesktopWork()()
    expect(vi.mocked(bridge.setBusy).mock.calls.length).toBe(count)
  })
})
