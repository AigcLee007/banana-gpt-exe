import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', () => ({
  ensureImageCached: vi.fn(),
  useStore: {
    getState: vi.fn(() => ({
      settings: { profiles: [] },
      tasks: [],
    })),
  },
}))

import { ensureImageCached, useStore } from '../store'
import { downloadImageIds } from './downloadImages'

function installDownloadDomMock() {
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(),
  }
  const appendChild = vi.fn()
  const removeChild = vi.fn()

  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'a') throw new Error(`unexpected element: ${tagName}`)
      return anchor
    }),
    body: {
      appendChild,
      removeChild,
    },
  })
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
  })
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:download-url'),
    revokeObjectURL: vi.fn(),
  })

  return { anchor, appendChild, removeChild }
}

describe('downloadImageIds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('downloads a cached remote image through the same-origin proxy after validating the response is an image', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://visionary.beer/api/generations/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-a')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-a.png')
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
    expect(window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000)
  })

  it('sends the task API key when downloading visionary image URLs through the proxy', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://visionary.beer/api/generations/result.png?token=image-token'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    vi.mocked(useStore.getState).mockReturnValue({
      settings: {
        profiles: [
          {
            id: 'profile-a',
            provider: 'openai',
            apiKey: 'test-key',
          },
        ],
      },
      tasks: [
        {
          id: 'task-a',
          apiProfileId: 'profile-a',
          apiProvider: 'openai',
          outputImages: ['image-id'],
        },
      ],
    } as any)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        if ((init?.headers as Record<string, string> | undefined)?.Authorization !== 'Bearer test-key') {
          return new Response('Unauthorized', { status: 401 })
        }
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-a', { apiKey: 'test-key' })

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`, expect.objectContaining({
      headers: {
        Authorization: 'Bearer test-key',
      },
    }))
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })

  it('downloads file1 redirected images through the same-origin proxy blob path', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://file1.aitohumanize.com/file/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-a')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-a.png')
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })

  it('downloads file2 images through the same-origin proxy blob path instead of falling back to a new tab', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://file2.aitohumanize.com/file/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-b')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-b.png')
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })

  it('downloads file4 images through the same-origin proxy blob path', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://file4.aitohumanize.com/file/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-file4')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-file4.png')
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })

  it('downloads file5 images through the same-origin proxy blob path', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://file5.aitohumanize.com/file/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-file5')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-file5.png')
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })

  it('does not open the proxy error page when a remote image url has expired', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://visionary.beer/api/generations/expired/image?token=expired'
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/download-proxy?url=${imageUrl}`) {
        return new Response('Download proxy upstream error', { status: 401 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-expired')

    expect(result).toEqual({ successCount: 0, failCount: 1 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${imageUrl}`, expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer test-key',
      }),
    }))
    expect(dom.anchor.click).not.toHaveBeenCalled()
    expect((dom.anchor as unknown as { target?: string }).target).not.toBe('_blank')
  })

  it('keeps data url downloads on blob urls and delays revocation', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'data:image/png;base64,aW1hZ2U='
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === imageUrl) {
        return new Response(new Blob(['image'], { type: 'image/png' }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds([imageUrl], 'task-c')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(imageUrl)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-c.png')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
    expect(window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000)
  })
})
