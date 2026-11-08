import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopApiFetch } from './desktopApiFetch'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('desktopApiFetch', () => {
  it('sends desktop API requests through the app protocol without putting the key in the local URL', async () => {
    vi.stubGlobal('window', { location: { protocol: 'app:', origin: 'app://local' } })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const init: RequestInit = { method: 'POST', headers: { Authorization: 'Bearer private-key', 'Content-Type': 'application/json' }, body: '{"prompt":"cup"}' }

    const response = await desktopApiFetch('https://api.example.test/v1/images/generations', init, 'https://api.example.test/v1')

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, forwarded] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/desktop-api-proxy')
    expect(url).not.toContain('private-key')
    expect(new Headers(forwarded.headers).get('X-Desktop-Api-Target')).toBe('https://api.example.test/v1/images/generations')
    expect(new Headers(forwarded.headers).get('X-Desktop-Api-Base')).toBe('https://api.example.test/v1')
    expect(new Headers(forwarded.headers).get('Authorization')).toBe('Bearer private-key')
    expect(forwarded.body).toBe(init.body)
  })

  it('rewrites configured same-origin proxy URLs to their configured upstream target', async () => {
    vi.stubGlobal('window', { location: { protocol: 'app:', origin: 'app://local' } })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await desktopApiFetch('/api-proxy/v1/videos/task-1', { headers: { Authorization: 'Bearer key' } }, 'https://profile.example.test/v1')

    const [url, forwarded] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/desktop-api-proxy')
    expect(new Headers(forwarded.headers).get('X-Desktop-Api-Target')).toBe('https://profile.example.test/v1/videos/task-1')
    expect(new Headers(forwarded.headers).get('X-Desktop-Api-Base')).toBe('https://profile.example.test/v1')
  })

  it('leaves web and local resource requests untouched', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://app.example.test' } })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const init: RequestInit = { headers: { Authorization: 'Bearer key' } }

    await desktopApiFetch('https://api.example.test/v1/responses', init, 'https://api.example.test/v1')
    await desktopApiFetch('/download-proxy?url=https%3A%2F%2Fimages.example.test%2Fa.png', init)
    await desktopApiFetch('data:image/png;base64,YQ==')

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://api.example.test/v1/responses',
      '/download-proxy?url=https%3A%2F%2Fimages.example.test%2Fa.png',
      'data:image/png;base64,YQ==',
    ])
    expect(fetchMock.mock.calls[0][1]).toBe(init)
  })

  it('does not proxy third-party result media outside the configured API host', async () => {
    vi.stubGlobal('window', { location: { protocol: 'app:', origin: 'app://local' } })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('video'))
    vi.stubGlobal('fetch', fetchMock)

    await desktopApiFetch('https://cdn.example.test/result.mp4', undefined, 'https://api.example.test/v1')

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.test/result.mp4')
  })
})
