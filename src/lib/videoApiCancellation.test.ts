import { afterEach, describe, expect, it, vi } from 'vitest'
const submit = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('./videoAdapters/wan', () => ({ wanAdapter: { buildSubmit: submit.build } }))
import { submitVideoTask } from './videoApi'
import type { VideoTaskRecord } from './videoTypes'
afterEach(() => vi.unstubAllGlobals())

describe('canceling during reference preparation', () => {
  it('never creates a paid remote video task after cancellation', async () => {
    let finish!: (value: unknown) => void
    submit.build.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetchMock = vi.fn(async () => new Response('{"id":"remote"}'))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const task = { adapter: 'wan', apiProfile: { apiKey: 'test-key' } } as VideoTaskRecord
    const result = submitVideoTask(task, controller.signal)
    controller.abort()
    finish({ url: '/api-proxy/v1/videos', init: { method: 'POST', body: '{}' } })
    await expect(result).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
