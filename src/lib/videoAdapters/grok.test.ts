import { describe, expect, it, vi } from 'vitest'

vi.mock('../videoDb', () => ({
  getMedia: vi.fn(async (id: string) => ({
    blob: new Blob(['fake-image'], { type: id.endsWith('jpg') ? 'image/jpeg' : 'image/png' }),
    mime: id.endsWith('jpg') ? 'image/jpeg' : 'image/png',
    width: 64,
    height: 64,
  })),
}))

import { grokAdapter, validateGrokImageUrl } from './grok'
import { downloadVideoContent } from '../videoApi'
import type { VideoTaskRecord } from '../videoTypes'

const profile = {
  profileId: 'profile-1',
  baseUrl: 'https://vip.aittco.com',
  apiKey: 'mock-user-video-key',
  apiProxy: true,
}

function task(overrides: Partial<VideoTaskRecord> = {}): VideoTaskRecord {
  return {
    id: 'local-task',
    prompt: 'A fox walking through a meadow',
    mode: 't2v',
    model: 'grok-imagine-video-1.5',
    params: { duration: 8, resolution: '480p', aspectRatio: '16:9', audio: false, n: 1 },
    inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] },
    status: 'queued',
    adapter: 'grok',
    error: null,
    createdAt: 0,
    finishedAt: null,
    elapsed: null,
    apiProfile: profile,
    ...overrides,
  }
}

describe('grokAdapter', () => {
  it('builds text-to-video JSON with the relay schema and the user API Key', async () => {
    const spec = await grokAdapter.buildSubmit({ task: task(), profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(spec.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` })
    expect(JSON.parse(String(spec.init.body))).toEqual({
      model: 'grok-imagine-video-1.5',
      prompt: 'A fox walking through a meadow',
      seconds: '8',
      aspect_ratio: '16:9',
      resolution: '480p',
    })
  })

  it('builds JSON requests for HTTPS and data image URLs', async () => {
    for (const imageUrl of ['https://example.com/image.png', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAI']) {
      const spec = await grokAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], imageUrl: imageUrl } }), profile })
      const body = JSON.parse(String(spec.init.body))
      expect(body.image).toEqual({ url: imageUrl })
      expect(body.prompt).toBe('A fox walking through a meadow')
    }
    const imageOnly = await grokAdapter.buildSubmit({ task: task({ prompt: '', mode: 'i2v', inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], imageUrl: 'https://example.com/image.png' } }), profile })
    expect(JSON.parse(String(imageOnly.init.body))).not.toHaveProperty('prompt')
  })

  it('builds multipart single-image requests for locally uploaded images', async () => {
    const spec = await grokAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { firstFrameId: 'image-png', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(spec.init.headers).toEqual({ Authorization: `Bearer ${profile.apiKey}` })
    const form = spec.init.body as FormData
    expect(form.get('model')).toBe('grok-imagine-video-1.5')
    expect(form.get('seconds')).toBe('8')
    expect(form.get('aspect_ratio')).toBe('16:9')
    expect(form.get('resolution')).toBe('480p')
    expect(form.get('input_reference')).toBeInstanceOf(File)
    expect((form.get('input_reference') as File).type).toBe('image/png')
  })

  it.each([
    ['text-to-video', undefined],
    ['HTTPS image-to-video', 'https://example.com/image.png'],
    ['data image-to-video', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAI'],
  ])('submits 1080p as the same 720p JSON payload for %s', async (_mode, imageUrl) => {
    const selectedTask = task()
    selectedTask.params.resolution = '1080p'
    if (imageUrl) {
      selectedTask.mode = 'i2v'
      selectedTask.inputs.imageUrl = imageUrl
    }
    const downgraded = await grokAdapter.buildSubmit({ task: selectedTask, profile })
    const standard = await grokAdapter.buildSubmit({ task: { ...selectedTask, params: { ...selectedTask.params, resolution: '720p' } }, profile })
    expect(JSON.parse(String(downgraded.init.body)).resolution).toBe('720p')
    expect(JSON.parse(String(downgraded.init.body))).toEqual(JSON.parse(String(standard.init.body)))
  })

  it('submits 1080p as 720p in multipart image uploads', async () => {
    const selectedTask = task({ mode: 'i2v', inputs: { firstFrameId: 'image-png', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } })
    selectedTask.params.resolution = '1080p'
    const spec = await grokAdapter.buildSubmit({ task: selectedTask, profile })
    const form = spec.init.body as FormData
    expect(form.get('resolution')).toBe('720p')
    expect(form.get('input_reference')).toBeInstanceOf(File)
    expect(form.get('seconds')).toBe('8')
  })

  it.each(['480p', '720p'] as const)('preserves the selected %s resolution', async (resolution) => {
    const selectedTask = task()
    selectedTask.params.resolution = resolution
    const spec = await grokAdapter.buildSubmit({ task: selectedTask, profile })
    expect(JSON.parse(String(spec.init.body)).resolution).toBe(resolution)
  })

  it('rejects local references with a non-image MIME or dimensions below 8px', async () => {
    const { getMedia } = await import('../videoDb')
    vi.mocked(getMedia).mockResolvedValueOnce({ blob: new Blob(['x'], { type: 'video/mp4' }), mime: 'video/mp4', width: 64, height: 64, size: 1, source: 'upload', uploadedAt: 0, id: 'video' })
    await expect(grokAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { firstFrameId: 'video', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })).rejects.toThrow(/image/i)
    vi.mocked(getMedia).mockResolvedValueOnce({ blob: new Blob(['x'], { type: 'image/png' }), mime: 'image/png', width: 4, height: 4, size: 1, source: 'upload', uploadedAt: 0, id: 'tiny' })
    await expect(grokAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { firstFrameId: 'tiny', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })).rejects.toThrow(/8/i)
  })

  it.each([1, 15])('accepts seconds=%s', async (seconds) => {
    const spec = await grokAdapter.buildSubmit({ task: task({ params: { duration: seconds, resolution: '480p', aspectRatio: '16:9', audio: false, n: 1 } }), profile })
    expect(JSON.parse(String(spec.init.body)).seconds).toBe(String(seconds))
  })

  it.each([0, 16])('rejects seconds=%s', async (seconds) => {
    await expect(grokAdapter.buildSubmit({ task: task({ params: { duration: seconds, resolution: '480p', aspectRatio: '16:9', audio: false, n: 1 } }), profile })).rejects.toThrow(/seconds.*1.*15/i)
  })

  it('rejects unsupported ratios, resolutions, references, and empty input', async () => {
    await expect(grokAdapter.buildSubmit({ task: task({ params: { duration: 8, resolution: '480p', aspectRatio: '5:4', audio: false, n: 1 } }), profile })).rejects.toThrow(/aspect/i)
    await expect(grokAdapter.buildSubmit({ task: task({ params: { duration: 8, resolution: '4k' as never, aspectRatio: '16:9', audio: false, n: 1 } }), profile })).rejects.toThrow(/resolution/i)
    await expect(grokAdapter.buildSubmit({ task: task({ prompt: '', inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })).rejects.toThrow(/prompt.*image/i)
    await expect(grokAdapter.buildSubmit({ task: task({ mode: 'flf2v', inputs: { firstFrameId: 'a', lastFrameId: 'b', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })).rejects.toThrow(/single image|last_frame|unsupported|只支持/i)
  })

  it('rejects unsafe image URL schemes', () => {
    expect(() => validateGrokImageUrl('http://example.com/a.png')).toThrow(/https|data:image/i)
    expect(() => validateGrokImageUrl('file:///tmp/a.png')).toThrow(/https|data:image/i)
    expect(() => validateGrokImageUrl('blob:https://example.com/id')).toThrow(/https|data:image/i)
    expect(() => validateGrokImageUrl('data:text/plain;base64,abc')).toThrow(/image/i)
  })

  it('accepts all terminal and processing statuses and extracts errors/video urls', () => {
    expect(grokAdapter.parsePoll({ status: 'queued', progress: 0 })).toMatchObject({ status: 'queued', progress: 0 })
    expect(grokAdapter.parsePoll({ status: 'pending', progress: 1 })).toMatchObject({ status: 'queued', progress: 1 })
    expect(grokAdapter.parsePoll({ status: 'processing', progress: 25 })).toMatchObject({ status: 'running', progress: 25 })
    expect(grokAdapter.parsePoll({ data: { status: 'in_progress', progress: 40 } })).toMatchObject({ status: 'running', progress: 40 })
    expect(grokAdapter.parsePoll({ status: 'completed', progress: 100, video_url: 'https://storage.example/video.mp4' })).toMatchObject({ status: 'succeeded', videoUrl: 'https://storage.example/video.mp4' })
    expect(grokAdapter.parsePoll({ status: 'failed', data: { fail_reason: 'bad prompt' } })).toMatchObject({ status: 'failed', error: 'bad prompt' })
    expect(grokAdapter.parsePoll({ status: 'expired', error: 'expired' })).toMatchObject({ status: 'failed', error: 'expired' })
    expect(grokAdapter.parsePoll({ status: 'cancelled' })).toMatchObject({ status: 'failed' })
  })

  it('accepts id/task_id variants from create responses', () => {
    expect(grokAdapter.parseSubmit({ task_id: 'task-a', status: 'queued' })).toMatchObject({ taskId: 'task-a', status: 'queued' })
    expect(grokAdapter.parseSubmit({ data: { id: 'task-b', status: 'in_progress' } })).toMatchObject({ taskId: 'task-b', status: 'running' })
    expect(grokAdapter.parseSubmit({ data: { task_id: 'task-c' } })).toMatchObject({ taskId: 'task-c', status: 'queued' })
  })

  it('builds poll and content proxy paths', () => {
    expect(grokAdapter.buildPoll('task/a', profile).url).toBe('/api-proxy/v1/videos/task%2Fa')
    expect(grokAdapter.buildContent('task/a', profile).url).toBe('/api-proxy/v1/videos/task%2Fa/content')
    expect(grokAdapter.buildPoll('task/a', profile).init.headers).toEqual({ Authorization: `Bearer ${profile.apiKey}` })
    expect(grokAdapter.buildContent('task/a', profile).init.headers).toEqual({ Authorization: `Bearer ${profile.apiKey}` })
  })

  it('rejects missing user keys before submit, poll, or download', async () => {
    const emptyProfile = { ...profile, apiKey: '  ' }
    await expect(grokAdapter.buildSubmit({ task: task(), profile: emptyProfile })).rejects.toThrow('请先在设置 → API 配置中填写 API Key')
    expect(() => grokAdapter.buildPoll('task-1', emptyProfile)).toThrow('请先在设置 → API 配置中填写 API Key')
    expect(() => grokAdapter.buildContent('task-1', emptyProfile)).toThrow('请先在设置 → API 配置中填写 API Key')
  })

  it('uses the key belonging to each request and trims pasted whitespace', async () => {
    const otherProfile = { ...profile, apiKey: '  mock-other-user-key  ' }
    const spec = await grokAdapter.buildSubmit({ task: task(), profile: otherProfile })
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-other-user-key')
    expect(new Headers(grokAdapter.buildPoll('task-1', profile).init.headers).get('Authorization')).toBe(`Bearer ${profile.apiKey}`)
  })

  it('downloads completed content through the proxy endpoint', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api-proxy/v1/videos/task-1/content')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${profile.apiKey}`)
      return new Response(new Blob(['video-bytes'], { type: 'video/mp4' }), { status: 200 })
    }) as typeof fetch
    try {
      const blob = await downloadVideoContent('task-1', { ...task(), remoteTaskId: 'task-1' })
      expect(blob.type).toBe('video/mp4')
      expect(await blob.text()).toBe('video-bytes')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
