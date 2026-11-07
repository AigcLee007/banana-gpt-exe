import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { BANANA_GALLERY_MODELS, getBananaModelCreditLabel, getBananaModelRoute } from './bananaModels'
import { getImageModelFamily, getPreferredImageModel, parseImageModelLineMemory, rememberImageModelLine } from './imageModelSelection'
import { buildRootApiUrl } from './devProxy'
import { normalizeParamsForSettings } from './paramCompatibility'
import { buildMidjourneyRequest, callMidjourneyImageApi, MIDJOURNEY_HIGH, MIDJOURNEY_LOW } from './midjourneyImageApi'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const profile = (model = 'Midjourney v8.2-Low') => createDefaultOpenAIProfile({ model, apiKey: 'test-secret', baseUrl: 'https://vip.aittco.com/v1', apiProxy: false })
const options = (model = 'Midjourney v8.2-Low') => ({ settings: DEFAULT_SETTINGS, prompt: 'a cup', params: { ...DEFAULT_PARAMS, size: '16:9' }, inputImageDataUrls: [] as string[], profile: profile(model) })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Midjourney registration and parameters', () => {
  it('registers both routes in one family with durable line memory and configured group prices', () => {
    for (const model of [MIDJOURNEY_LOW, MIDJOURNEY_HIGH]) {
      expect(BANANA_GALLERY_MODELS.some(item => item.model === model)).toBe(true)
      expect(getBananaModelRoute(model)).toBe('midjourney')
      expect(getBananaModelCreditLabel(model)).toBe(model === MIDJOURNEY_LOW ? '8 💎 / 组' : '12 💎 / 组')
    }
    const family = getImageModelFamily(MIDJOURNEY_LOW)!
    expect(family.label).toBe('Midjourney v8.2')
    expect(family.lines.map(line => line.label)).toEqual(['特惠版', '稳定版'])
    const memory = parseImageModelLineMemory(JSON.stringify(rememberImageModelLine({}, MIDJOURNEY_HIGH)))
    expect(getPreferredImageModel(family, memory)).toBe(MIDJOURNEY_HIGH)
  })

  it('builds whitelisted JSON with n=1 and independent quality and HD', () => {
    const opts = options()
    opts.params = { ...opts.params, n: 4, quality: 'max', output_format: 'gif', transparent_output: true, midjourneyQuality: '0.5', midjourneyHd: true }
    expect(buildMidjourneyRequest(opts, opts.profile)).toEqual({ model: MIDJOURNEY_LOW, prompt: 'a cup', size: '16:9', n: 1, quality: '0.5', hd: true })
  })

  it.each([[MIDJOURNEY_LOW, 1], [MIDJOURNEY_HIGH, 5]] as const)('validates reference limit for %s', (model, limit) => {
    const opts = options(model)
    opts.inputImageDataUrls = Array(limit).fill('data:image/png;base64,YQ==')
    expect(buildMidjourneyRequest(opts, opts.profile).images).toHaveLength(limit)
    opts.inputImageDataUrls.push('https://example.com/image.png')
    expect(() => buildMidjourneyRequest(opts, opts.profile)).toThrow(`最多 ${limit}`)
  })

  it.each(['1024x1024', 'auto', '9:21'])('rejects Low ratio %s', size => {
    const opts = options(); opts.params.size = size
    expect(() => buildMidjourneyRequest(opts, opts.profile)).toThrow('比例')
  })

  it('accepts High-only ratios and rejects invalid quality, hd, masks and unsafe references', () => {
    const opts = options(MIDJOURNEY_HIGH); opts.params.size = '9:21'
    expect(buildMidjourneyRequest(opts, opts.profile).size).toBe('9:21')
    expect(() => buildMidjourneyRequest({ ...opts, maskDataUrl: 'data:image/png;base64,YQ==' }, opts.profile)).toThrow('遮罩')
    expect(() => buildMidjourneyRequest({ ...opts, params: { ...opts.params, midjourneyQuality: 'max' as never } }, opts.profile)).toThrow('quality')
    expect(() => buildMidjourneyRequest({ ...opts, params: { ...opts.params, midjourneyHd: 'true' as never } }, opts.profile)).toThrow('hd')
    for (const image of ['C:/image.png', 'https://user:pass@example.com/a.png', 'data:text/plain;base64,YQ==', 'http://127.0.0.1/a.png']) {
      expect(() => buildMidjourneyRequest({ ...opts, inputImageDataUrls: [image] }, opts.profile)).toThrow('参考图')
    }
  })

  it('clears incompatible values entering and leaving Midjourney', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile()], activeProfileId: profile().id })
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1024x1024', quality: 'max', output_format: 'gif', transparent_output: true, geminiAspectRatio: '16:9' }, settings)
    expect(params).toMatchObject({ size: '1:1', midjourneyQuality: '1', midjourneyHd: false, transparent_output: false, output_format: 'png', quality: 'auto' })
    expect(params.geminiAspectRatio).toBeUndefined()
    const gpt = profile('gpt-image-2')
    const next = normalizeParamsForSettings(params, normalizeSettings({ ...settings, profiles: [gpt], activeProfileId: gpt.id }))
    expect(next.midjourneyQuality).toBeUndefined(); expect(next.midjourneyHd).toBeUndefined()
    expect(next.size).not.toContain(':')
  })
})

describe('Midjourney transport', () => {
  it('uses root endpoints through direct, relative and configured proxy paths', () => {
    expect(buildRootApiUrl('https://vip.aittco.com/v1', 'midjourney-v82/generations')).toBe('https://vip.aittco.com/midjourney-v82/generations')
    expect(buildRootApiUrl('/gw/v1', 'midjourney-v82/tasks/a')).toBe('/gw/midjourney-v82/tasks/a')
    expect(buildRootApiUrl('https://unused.invalid/v1', 'midjourney-v82/tasks/a', { enabled: true, prefix: '/custom', target: 'https://vip.aittco.com/v1', secure: true, changeOrigin: true }, true)).toBe('/custom/midjourney-v82/tasks/a')
    expect(buildRootApiUrl('https://unused.invalid/v1', 'midjourney-v82/generations', null, true)).toBe('/api-proxy/midjourney-v82/generations')
  })

  it('persists before polling and returns every image from one POST, using credentialless image proxy', async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://file1.aitohumanize.com/${i}.png`)
    let persisted = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toMatchObject({ n: 1, model: MIDJOURNEY_LOW, quality: '1', hd: false })
        return json({ task_id: 'task_local', status: 'SUBMITTED' })
      }
      if (String(url).includes('/tasks/')) { expect(persisted).toBe(true); return json({ status: 'SUCCESS', result: { data: urls.map(url => ({ url })) } }) }
      expect(String(url)).toMatch(/^\/download-proxy\?url=/)
      expect(init?.headers).toBeUndefined()
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })
    })
    const opts = options()
    const result = await callMidjourneyImageApi({ ...opts, onMidjourneyTaskEnqueued: async () => { await Promise.resolve(); persisted = true } }, opts.profile)
    expect(result.images).toHaveLength(5)
    expect(result.rawImageUrls).toEqual(urls)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('retries transient polling errors at 5s intervals and resumes with GET only', async () => {
    vi.useFakeTimers()
    let count = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      count++
      if (count === 1) return json({ error: 'busy' }, 503)
      if (count === 2) return json({ status: 'IN_PROGRESS' })
      return json({ status: 'SUCCESS', result: { data: [{ b64_json: 'YQ==' }, { b64_json: 'Yg==' }] } })
    })
    const opts = options()
    const pending = callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_saved' }, opts.profile)
    await vi.advanceTimersByTimeAsync(10000)
    expect((await pending).images).toHaveLength(2)
    expect(fetchMock.mock.calls).toHaveLength(3)
    expect(fetchMock.mock.calls.every(([url, init]) => String(url).endsWith('/tasks/task_saved') && init?.method === 'GET')).toBe(true)
  })

  it('reports terminal failures and preserves task ID on exhausted transient retries', async () => {
    const opts = options()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ status: 'FAILURE', error: { message: 'supplier failed' } }))
    await expect(callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_failed' }, opts.profile)).rejects.toThrow('supplier failed')
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    const pending = callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_retry' }, opts.profile)
    const check = expect(pending).rejects.toMatchObject({ taskId: 'task_retry', recoverable: true })
    await vi.runAllTimersAsync(); await check
  })

  it('retains an indeterminate task when polling fails authorization', async () => {
    const opts = options()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { message: 'unauthorized' } }, 401))
    await expect(callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_auth' }, opts.profile)).rejects.toMatchObject({ taskId: 'task_auth', phase: 'unknown' })
  })

  it('dispatches through the regular image API while ignoring GPT flags', async () => {
    const { callImageApi } = await import('./api')
    const p = { ...profile(), streamImages: true, codexCli: true }
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [p], activeProfileId: p.id })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST'
      ? json({ task_id: 'task_dispatch' }) : json({ status: 'SUCCESS', result: { data: [{ b64_json: 'YQ==' }] } }))
    const result = await callImageApi({ ...options(), settings })
    expect(result.images).toHaveLength(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ model: MIDJOURNEY_LOW, prompt: 'a cup', size: '16:9', n: 1, quality: '1', hd: false })
  })

  it('uses authenticated first-party artifacts after a restricted image proxy', async () => {
    const opts = options()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.includes('/midjourney-v82/tasks/')) return json({ status: 'SUCCESS', result: { data: [{ url: 'https://third-party.invalid/a.png' }] } })
      if (path.startsWith('/download-proxy')) return new Response('Forbidden', { status: 403 })
      if (path.endsWith('/artifacts')) return json({ artifacts: [{ content_url: '/v1/tasks/task_artifact/artifacts/image-1/content' }] })
      expect(path).toBe('https://vip.aittco.com/v1/tasks/task_artifact/artifacts/image-1/content')
      expect(init?.headers).toEqual({ Authorization: 'Bearer test-secret' })
      expect(init?.redirect).toBe('error')
      return new Response('bytes', { headers: { 'Content-Type': 'image/png' } })
    })
    expect((await callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_artifact' }, opts.profile)).images).toHaveLength(1)
    expect(fetchMock.mock.calls.every(([url]) => !String(url).startsWith('https://third-party'))).toBe(true)
  })

  it('refuses third-party artifact content URLs without leaking credentials', async () => {
    const opts = options()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/midjourney-v82/tasks/')) return json({ status: 'SUCCESS', result: { data: [{ url: 'https://third-party.invalid/a.png' }] } })
      if (String(url).startsWith('/download-proxy')) return new Response('Forbidden', { status: 403 })
      return json({ artifacts: [{ content_url: 'https://evil.invalid/v1/tasks/task_safe/artifacts/key/content' }] })
    })
    await expect(callMidjourneyImageApi({ ...opts, resumeMidjourneyTaskId: 'task_safe' }, opts.profile)).rejects.toMatchObject({ recoverable: true, taskId: 'task_safe' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil.invalid'))).toBe(false)
  })
})
