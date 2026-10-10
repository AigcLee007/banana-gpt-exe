import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaRecord } from './videoTypes'
import { uploadUguuMedia } from './uguuUpload'

const response = { success: true, files: [{ hash: 'testhash', filename: 'kmeojRpC.png', url: 'https://n.uguu.se/kmeojRpC.png', size: 68, dupe: false }] }

function media(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return { id: 'image-1', blob: new Blob(['png'], { type: 'image/png' }), mime: 'image/png', filename: '照片.png', size: 3, source: 'upload', uploadedAt: 0, ...overrides }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response)))) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('uploadUguuMedia', () => {
  it('uploads one multipart files[] without credentials or video headers', async () => {
    const selected = media()
    expect(await uploadUguuMedia(selected)).toBe('https://n.uguu.se/kmeojRpC.png')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/media-upload/uguu')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' })
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    expect(new Headers(init?.headers).get('Cookie')).toBeNull()
    expect(new Headers(init?.headers).get('Content-Type')).toBeNull()
    const form = init?.body as FormData
    expect([...form.keys()]).toEqual(['files[]'])
    const file = form.get('files[]') as File
    expect(file.name).toBe('照片.png')
    expect(file.type).toBe('image/png')
    expect(await file.text()).toBe('png')
  })

  it.each([
    ['app:', 'app://local/media-upload/uguu'],
    ['https:', '/media-upload/uguu'],
    ['http:', '/media-upload/uguu'],
  ])('uses the %s upload transport', async (protocol, endpoint) => {
    vi.stubGlobal('window', { location: { protocol } })
    await uploadUguuMedia(media())
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(endpoint)
  })

  it('rejects direct file launches before uploading any local material', async () => {
    vi.stubGlobal('window', { location: { protocol: 'file:' } })
    await expect(uploadUguuMedia(media())).rejects.toThrow('请通过桌面安装版或网页服务启动后上传素材')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['C:\\private\\photo.png', '../secret.png', 'folder/photo.png', 'bad\nname.png', '..', ''])('replaces unsafe filenames: %s', async (filename) => {
    await uploadUguuMedia(media({ filename }))
    const file = (vi.mocked(fetch).mock.calls[0][1]?.body as FormData).get('files[]') as File
    expect(file.name).toBe('media.png')
  })

  it.each([['video/quicktime', '.mov'], ['video/mp4', '.mp4'], ['audio/mpeg', '.mp3'], ['audio/wav', '.wav']])('keeps a safe extension for %s', async (mime, extension) => {
    await uploadUguuMedia(media({ filename: undefined, mime, blob: new Blob(['x'], { type: mime }) }))
    const file = (vi.mocked(fetch).mock.calls[0][1]?.body as FormData).get('files[]') as File
    expect(file.name).toBe(`media${extension}`)
  })

  it('does not cache upload URLs between generation attempts', async () => {
    await uploadUguuMedia(media())
    await uploadUguuMedia(media())
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    { success: false, files: response.files },
    { success: 'true', files: response.files },
    { success: true, files: [] },
    { success: true, files: [...response.files, ...response.files] },
    { success: true, files: [{}] },
    ...['http://n.uguu.se/a.png', 'https://example.test/a.png', 'https://uguu.se.evil.test/a.png', 'https://notuguu.se/a.png', 'https://user:pass@n.uguu.se/a.png', 'https://n.uguu.se/a b.png', 'https://n.uguu.se/a\n.png', ' https://n.uguu.se/a.png', 'data:image/png;base64,abc'].map((url) => ({ success: true, files: [{ url }] })),
  ])('rejects invalid Uguu responses without exposing upstream content %#', async (payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    await expect(uploadUguuMedia(media())).rejects.toThrow(/素材上传.*失败|上传.*有效/)
  })

  it('accepts the main Uguu HTTPS hostname', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, files: [{ url: 'https://uguu.se/file.png' }] })))
    expect(await uploadUguuMedia(media())).toBe('https://uguu.se/file.png')
  })

  it('sanitizes HTTP and network errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>private infrastructure secret</html>', { status: 503 }))
    await expect(uploadUguuMedia(media())).rejects.toThrow('素材上传失败，请稍后重试')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('private endpoint token'))
    await expect(uploadUguuMedia(media())).rejects.toThrow('素材上传失败，请检查网络后重试')
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>private secret</html>'))
    await expect(uploadUguuMedia(media())).rejects.toThrow(/素材上传.*失败/)
  })

  it('aborts stalled uploads after 120 seconds with a localized error', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const promise = uploadUguuMedia(media())
    await Promise.all([
      expect(promise).rejects.toThrow('素材上传超时，请稍后重试'),
      vi.advanceTimersByTimeAsync(120_000),
    ])
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('skips the upload when its caller already canceled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(uploadUguuMedia(media(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts an active upload when the caller cancels', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const promise = uploadUguuMedia(media(), controller.signal)
    const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await check
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('rejects canceled uploads even if their response arrives after cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementation(async () => { controller.abort(); return new Response(JSON.stringify(response)) })
    await expect(uploadUguuMedia(media(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
