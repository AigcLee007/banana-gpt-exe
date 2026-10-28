import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../types'
// dataUrlToBlob reads the data URL with fetch(); these tests replace the global fetch to observe the
// network calls, so give that one step a real implementation and keep the mock for everything else.
vi.mock('./canvasImage', async (original) => ({
  ...await original<typeof import('./canvasImage')>(),
  dataUrlToBlob: async (dataUrl: string) => {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), (c) => c.charCodeAt(0))
    return new Blob([bytes], { type: /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png' })
  },
}))

import {
  checkUpscaleLimit,
  estimateOutputPixels,
  getMaxAllowedFactor,
  UPSCALE_MAX_OUTPUT_PIXELS,
  describeUpscale,
  extractErrorDetail,
  formatUpscaleError,
  normalizeUpscaleParams,
  upscaleImage,
  UPSCALE_MODELS,
} from './upscaleApi'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function profile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: 'p1',
    name: '默认',
    provider: 'openai',
    baseUrl: 'https://vip.aittco.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-image-2',
    timeout: 300,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    ...overrides,
  } as ApiProfile
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('normalizeUpscaleParams', () => {
  it('keeps valid choices', () => {
    expect(normalizeUpscaleParams({ model: 'upscale-standard', factor: 4, format: 'webp' }))
      .toEqual({ model: 'upscale-standard', factor: 4, format: 'webp' })
  })

  it('falls back to defaults for an unknown model, factor or format', () => {
    expect(normalizeUpscaleParams({ model: 'nope' as never, factor: 99, format: 'gif' as never }))
      .toEqual({ model: 'upscale-standard', factor: 2, format: 'jpg' })
  })

  it('creative model is fixed at 2x and takes no format', () => {
    expect(normalizeUpscaleParams({ model: 'upscale-creative', factor: 4, format: 'png' }))
      .toEqual({ model: 'upscale-creative', factor: 2, format: null })
  })

  it('offers both models, standard 1-8x and creative 2x only', () => {
    expect(UPSCALE_MODELS.map((m) => m.id)).toEqual(['upscale-standard', 'upscale-creative'])
    expect(UPSCALE_MODELS[0].factors).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(UPSCALE_MODELS[1].factors).toEqual([2])
  })

  it('describes the task for the history list', () => {
    expect(describeUpscale({ model: 'upscale-standard', factor: 4, format: 'jpg' })).toBe('高清放大 4 倍 · 标准高清')
  })
})

describe('output size limit', () => {
  it('is 100 megapixels', () => {
    expect(UPSCALE_MAX_OUTPUT_PIXELS).toBe(100_000_000)
  })

  it('computes the output the same way the relay bills it', () => {
    expect(estimateOutputPixels(1674, 940, 4)).toBe(6696 * 3760)
    expect(estimateOutputPixels(256, 256, 2)).toBe(512 * 512)
  })

  it('allows everyday sizes', () => {
    expect(checkUpscaleLimit(2560, 1440, { model: 'upscale-standard', factor: 4 }).ok).toBe(true) // 59 MP
    expect(checkUpscaleLimit(3840, 2160, { model: 'upscale-standard', factor: 2 }).ok).toBe(true) // 33 MP
    expect(checkUpscaleLimit(10000, 10000, { model: 'upscale-standard', factor: 1 }).ok).toBe(true) // exactly 100 MP
  })

  it('refuses a 4K image at 8x and says how far it can go', () => {
    const result = checkUpscaleLimit(3840, 2160, { model: 'upscale-standard', factor: 8 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.maxFactor).toBe(3) // 4K x3 = 74.6 MP fits, x4 = 132.7 MP does not
    expect(result.message).toContain('531 百万像素')
    expect(result.message).toContain('100 百万像素')
    expect(result.message).toContain('最多可放大 3 倍')
  })

  it('is just under / just over the line', () => {
    expect(checkUpscaleLimit(10000, 10000, { model: 'upscale-standard', factor: 1 }).ok).toBe(true)
    expect(checkUpscaleLimit(10001, 10000, { model: 'upscale-standard', factor: 1 }).ok).toBe(false)
  })

  it('has no allowed factor for an image that is already too large', () => {
    expect(getMaxAllowedFactor(12000, 12000, 'upscale-standard')).toBeNull()
    const result = checkUpscaleLimit(12000, 12000, { model: 'upscale-standard', factor: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.maxFactor).toBeNull()
      expect(result.message).toContain('先缩小图片')
    }
  })

  it('tells creative users to switch model, since it is fixed at 2x', () => {
    const result = checkUpscaleLimit(8000, 8000, { model: 'upscale-creative', factor: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('标准高清')
  })

  it('does not block when the size is unknown', () => {
    expect(checkUpscaleLimit(0, 0, { model: 'upscale-standard', factor: 8 }).ok).toBe(true)
  })

  it('max factor respects each model: standard up to 8, creative only 2', () => {
    expect(getMaxAllowedFactor(256, 256, 'upscale-standard')).toBe(8)
    expect(getMaxAllowedFactor(256, 256, 'upscale-creative')).toBe(2)
  })
})

describe('error messages', () => {
  it('reads error text from the relay payload, including its code', () => {
    expect(extractErrorDetail({ error: { code: 'model_not_found', message: 'No available channel' } }))
      .toBe('model_not_found No available channel')
    expect(extractErrorDetail({ error: 'plain' })).toBe('plain')
    expect(extractErrorDetail({ message: 'm' })).toBe('m')
    expect(extractErrorDetail({ __raw: 'x'.repeat(500) }).length).toBe(200)
    expect(extractErrorDetail({})).toBe('')
  })

  it('explains the 3 yuan reservation when the balance is too low', () => {
    const message = formatUpscaleError(403, { error: { code: 'pre_consume_token_quota_failed', message: 'token quota is not enough' } })
    expect(message).toContain('余额不足')
    expect(message).toContain('3 元')
  })

  it('maps the common statuses', () => {
    expect(formatUpscaleError(401, {})).toContain('API Key')
    expect(formatUpscaleError(503, { error: { code: 'model_not_found', message: 'x' } })).toContain('没有开通')
    expect(formatUpscaleError(504, {})).toContain('超时')
    expect(formatUpscaleError(400, { error: { message: 'upscale-creative supports upscale_factor 2' } }))
      .toBe('upscale-creative supports upscale_factor 2')
    expect(formatUpscaleError(500, {})).toBe('放大失败（HTTP 500）')
  })
})

describe('upscaleImage (sync)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the file and options to images/edits with the bearer key, and returns the image', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'QUJD', url: 'https://f.example/o.jpg' }] }))

    const result = await upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 4, format: 'webp' },
      imageDataUrl: PNG_DATA_URL,
    })

    expect(result.image).toBe('data:image/png;base64,QUJD')
    expect(result.rawUrl).toBe('https://f.example/o.jpg')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://vip.aittco.com/v1/images/edits')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' })
    const form = init.body as FormData
    expect(form.get('model')).toBe('upscale-standard')
    expect(form.get('upscale_factor')).toBe('4')
    expect(form.get('output_format')).toBe('webp')
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it('does not send output_format for the creative model', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'QUJD' }] }))
    await upscaleImage({
      profile: profile(),
      params: { model: 'upscale-creative', factor: 2, format: 'png' },
      imageDataUrl: PNG_DATA_URL,
    })
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('model')).toBe('upscale-creative')
    expect(form.get('output_format')).toBeNull()
  })

  it('downloads the result when only a url comes back', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: 'https://f.example/o.jpg' }] }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { status: 200 }))
    const result = await upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: PNG_DATA_URL,
    })
    expect(result.image.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(fetchMock.mock.calls[1][0]).toBe('https://f.example/o.jpg')
  })

  it('says plainly when the server proxy rejects the path, instead of blaming the account', () => {
    const message = formatUpscaleError(403, { __raw: 'Forbidden: API Proxy path restricted' })
    expect(message).toContain('代理')
    expect(message).not.toContain('没有权限使用该放大模型')
  })

  it('turns an HTTP error into a readable message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'pre_consume_token_quota_failed', message: 'token quota is not enough' } }, 403))
    await expect(upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: PNG_DATA_URL,
    })).rejects.toThrow(/余额不足/)
  })

  it('refuses to call without an API key, and without an image', async () => {
    await expect(upscaleImage({ profile: profile({ apiKey: '  ' }), params: { model: 'upscale-standard', factor: 2, format: 'jpg' }, imageDataUrl: PNG_DATA_URL }))
      .rejects.toThrow('API Key')
    await expect(upscaleImage({ profile: profile(), params: { model: 'upscale-standard', factor: 2, format: 'jpg' }, imageDataUrl: '' }))
      .rejects.toThrow('已不存在')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes through the proxy prefix when the profile asks for it', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'QUJD' }] }))
    await upscaleImage({
      profile: profile({ apiProxy: true }),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: PNG_DATA_URL,
    })
    // baseUrl already ends in /v1, so buildApiUrl keeps the prefix and does not repeat it
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api-proxy/images/edits')
    vi.unstubAllEnvs()
  })
})

describe('upscaleImage (task)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('submits to videos, reports the task id, polls until completed, then returns the image', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'task_1', status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task_1', status: 'in_progress', progress: 90 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task_1', status: 'completed', data: [{ url: 'https://f.example/o.jpg' }] }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), { status: 200 }))
    const enqueued = vi.fn()

    const promise = upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: PNG_DATA_URL,
      asTask: true,
      onTaskEnqueued: enqueued,
    })
    await vi.advanceTimersByTimeAsync(20000)
    const result = await promise

    expect(enqueued).toHaveBeenCalledWith({ taskId: 'task_1' })
    expect(result.image.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('https://vip.aittco.com/v1/videos')
    expect((fetchMock.mock.calls[0][1].body as FormData).get('input_reference')).toBeInstanceOf(Blob)
    expect(fetchMock.mock.calls[1][0]).toBe('https://vip.aittco.com/v1/videos/task_1')
  })

  it('keeps the /v1 segment on the proxy path so the server proxy lets videos through', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'task_p', status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task_p', status: 'completed', data: [{ b64_json: 'QUJD' }] }))
    // production profile: baseUrl already ends in /v1 and the proxy is on
    const prod = profile({ baseUrl: 'https://vip.aittco.com/v1', apiProxy: true })
    const promise = upscaleImage({
      profile: prod,
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: PNG_DATA_URL,
      asTask: true,
    })
    await vi.advanceTimersByTimeAsync(10000)
    await promise
    // nginx only whitelists /api-proxy/v1/videos; /api-proxy/videos is rejected with 403
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api-proxy/v1/videos')
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api-proxy/v1/videos/task_p')
    vi.unstubAllEnvs()
  })

  it('resumes an existing task without submitting again, so the user is never charged twice', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'task_9', status: 'completed', data: [{ b64_json: 'QUJD' }] }))
    const result = await upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: '',
      resumeTaskId: 'task_9',
    })
    expect(result.image).toBe('data:image/png;base64,QUJD')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://vip.aittco.com/v1/videos/task_9')
  })

  it('stops on a failed task with the relay message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't', status: 'failed', error: { message: '放大失败，请稍后重试。' } }))
    await expect(upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: '',
      resumeTaskId: 't',
    })).rejects.toThrow('放大失败，请稍后重试。')
  })

  it('keeps waiting through a temporary query error but stops on a missing task', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'bad gateway' } }, 502))
      .mockResolvedValueOnce(jsonResponse({ id: 't', status: 'completed', data: [{ b64_json: 'QUJD' }] }))
    const ok = upscaleImage({ profile: profile(), params: { model: 'upscale-standard', factor: 2, format: 'jpg' }, imageDataUrl: '', resumeTaskId: 't' })
    await vi.advanceTimersByTimeAsync(7000)
    await expect(ok).resolves.toMatchObject({ image: 'data:image/png;base64,QUJD' })

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'not found' } }, 404))
    await expect(upscaleImage({ profile: profile(), params: { model: 'upscale-standard', factor: 2, format: 'jpg' }, imageDataUrl: '', resumeTaskId: 'gone' }))
      .rejects.toThrow('不存在或已过期')
  })

  it('can be cancelled while waiting', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 't', status: 'in_progress' }))
    const controller = new AbortController()
    const promise = upscaleImage({
      profile: profile(),
      params: { model: 'upscale-standard', factor: 2, format: 'jpg' },
      imageDataUrl: '',
      resumeTaskId: 't',
      signal: controller.signal,
    })
    const settled = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    await settled
  })
})
