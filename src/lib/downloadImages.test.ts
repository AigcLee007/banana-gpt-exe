import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', () => ({
  ensureImageCached: vi.fn(),
}))

import { ensureImageCached } from '../store'
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

  it('downloads a cached remote image through the same-origin proxy when direct fetch is blocked', async () => {
    const dom = installDownloadDomMock()
    const imageUrl = 'https://visionary.beer/api/generations/result.png'
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    vi.mocked(ensureImageCached).mockResolvedValue(imageUrl)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === imageUrl) throw new TypeError('NetworkError when attempting to fetch resource.')
      if (url === `/download-proxy?url=${encodeURIComponent(imageUrl)}`) {
        return new Response(imageBlob, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadImageIds(['image-id'], 'task-a')

    expect(result).toEqual({ successCount: 1, failCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith(`/download-proxy?url=${encodeURIComponent(imageUrl)}`)
    expect(dom.anchor.href).toBe('blob:download-url')
    expect(dom.anchor.download).toBe('task-a.png')
    expect(dom.anchor.click).toHaveBeenCalledTimes(1)
  })
})
