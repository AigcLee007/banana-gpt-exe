import { describe, expect, it, vi } from 'vitest'
import { getDesktopUpdateBusy, installDesktopUpdate, type DesktopUpdater } from './desktopUpdater'
import { beginDesktopWork } from './desktopWorkActivity'

const idle = () => ({ tasks: [] as { status: string }[], agentConversations: [] as { rounds: { status: string }[] }[] })
const videoIdle = () => ({ tasks: [] as { status: string }[], isGenerating: false, uploadingFiles: new Set<string>() })

describe('desktop update work protection', () => {
  it('blocks operations registered outside the image and video stores', () => {
    const finish = beginDesktopWork()
    try {
      expect(getDesktopUpdateBusy(idle(), videoIdle())).toBe(true)
    } finally { finish() }
    expect(getDesktopUpdateBusy(idle(), videoIdle())).toBe(false)
  })

  it('allows completed work and blocks each actual kind of active work', () => {
    expect(getDesktopUpdateBusy({ ...idle(), tasks: [{ status: 'done' }, { status: 'error' }] }, videoIdle())).toBe(false)
    expect(getDesktopUpdateBusy({ ...idle(), tasks: [{ status: 'running' }] }, videoIdle())).toBe(true)
    expect(getDesktopUpdateBusy({ ...idle(), agentConversations: [{ rounds: [{ status: 'done' }] }, { rounds: [{ status: 'running' }] }] }, videoIdle())).toBe(true)
    for (const patch of [{ tasks: [{ status: 'queued' }] }, { tasks: [{ status: 'running' }] }, { isGenerating: true }, { uploadingFiles: new Set(['file']) }]) {
      expect(getDesktopUpdateBusy(idle(), { ...videoIdle(), ...patch })).toBe(true)
    }
  })

  it('reports freshly read busy state and never installs while work is running', async () => {
    const bridge = { setBusy: vi.fn().mockResolvedValue(undefined), install: vi.fn() } as unknown as DesktopUpdater
    const result = await installDesktopUpdate(bridge, () => true)
    expect(bridge.setBusy).toHaveBeenCalledWith(true)
    expect(bridge.install).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('awaits busy acknowledgement before installing and rechecks work started during the wait', async () => {
    let busy = false
    let acknowledge!: () => void
    const bridge = {
      setBusy: vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve })).mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as DesktopUpdater
    const result = installDesktopUpdate(bridge, () => busy)
    expect(bridge.install).not.toHaveBeenCalled()
    busy = true
    acknowledge()
    expect((await result).ok).toBe(false)
    expect(bridge.setBusy).toHaveBeenLastCalledWith(true)
    expect(bridge.install).not.toHaveBeenCalled()
  })

  it('installs only after the current stores and acknowledged state are idle', async () => {
    const calls: string[] = []
    const bridge = {
      setBusy: async () => { calls.push('busy') },
      install: async () => { calls.push('install'); return { ok: true } },
    } as unknown as DesktopUpdater
    expect(await installDesktopUpdate(bridge, () => false)).toEqual({ ok: true })
    expect(calls).toEqual(['busy', 'install'])
  })
})
