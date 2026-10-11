import { afterEach, describe, expect, it, vi } from 'vitest'
const submit = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('./videoAdapters/wan', () => ({ wanAdapter: { buildSubmit: submit.build } }))
vi.mock('./videoAdapters/sdMedia', () => ({ sdMediaAdapter: { buildSubmit: submit.build } }))
import { submitVideoTask } from './videoApi'
import type { VideoTaskRecord } from './videoTypes'
afterEach(() => vi.unstubAllGlobals())

describe('canceling during reference preparation', () => {
  it.each(['wan', 'sdMedia'] as const)('never creates a paid %s remote video task after cancellation', async adapter => {
    let finish!: (value: unknown) => void
    submit.build.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetchMock = vi.fn(async () => new Response('{"id":"remote"}'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const task = { adapter, apiProfile: { apiKey: 'test-key' } } as VideoTaskRecord
    const result = submitVideoTask(task, controller.signal)
    controller.abort()
    finish({ url: '/api-proxy/v1/videos', init: { method: 'POST', body: '{}' } })
    await expect(result).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
