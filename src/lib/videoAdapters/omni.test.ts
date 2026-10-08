import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../videoDb', () => ({
  getMedia: vi.fn(async (id: string) => ({
    id,
    blob: new Blob([`image-${id}`], { type: 'image/jpeg' }),
    mime: 'image/jpeg',
    width: 64,
    height: 64,
    size: 8,
    source: 'upload',
    uploadedAt: 0,
  })),
}))

import { omniAdapter } from './omni'
import { downloadVideoContent, submitVideoTask, pollVideoTask } from '../videoApi'
import { getMedia } from '../videoDb'
import type { VideoTaskRecord } from '../videoTypes'

const profile = {
  profileId: 'profile-1',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'mock-video-key',
  apiProxy: true,
}

const readAsDataURL = vi.fn(function (this: { result: string | null; onload?: () => void; onerror?: () => void }, blob: Blob) {
  void blob.arrayBuffer().then((buffer) => {
    this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
    this.onload?.()
  })
})
beforeEach(() => {
  vi.stubGlobal('FileReader', class { result = null; onload = null; onerror = null; readAsDataURL = readAsDataURL })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function task(overrides: Partial<VideoTaskRecord> = {}): VideoTaskRecord {
  return {
    id: 'local-task',
    prompt: 'A fox walking through a meadow',
    mode: 't2v',
    model: 'gemini-omni-flash-10s',
    params: { duration: 10, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 },
    inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] },
    status: 'queued',
    adapter: 'omni',
    error: null,
    createdAt: 0,
    finishedAt: null,
    elapsed: null,
    apiProfile: profile,
    ...overrides,
  }
}

describe('omniAdapter', () => {
  it('builds a text-to-video JSON request with fixed defaults', async () => {
    const spec = await omniAdapter.buildSubmit({ task: task(), profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(JSON.parse(String(spec.init.body))).toEqual({
      model: 'gemini-omni-flash-10s',
      prompt: 'A fox walking through a meadow',
      seconds: '10',
      aspect_ratio: '16:9',
      resolution: '720p',
    })
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-video-key')
  })

  it('converts IndexedDB blobs to data URLs for single and multi-reference image requests', async () => {
    const single = await omniAdapter.buildSubmit({
      task: task({ mode: 'i2v', inputs: { firstFrameId: 'one', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }),
      profile,
    })
    const singleBody = JSON.parse(String(single.init.body))
    expect(singleBody.images).toHaveLength(1)
    expect(singleBody.images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(Buffer.from(singleBody.images[0].split(',')[1], 'base64').toString()).toBe('image-one')
    expect(getMedia).toHaveBeenCalledWith('one')
    expect(readAsDataURL).toHaveBeenCalledWith(expect.any(Blob))

    const multiple = await omniAdapter.buildSubmit({
      task: task({
        mode: 'ref2v',
        inputs: { refImageIds: ['one', 'two'], refVideoIds: [], refAudioIds: [], refItems: [{ id: 'one', type: 'image' }, { id: 'two', type: 'image' }] },
      }),
      profile,
    })
    expect(JSON.parse(String(multiple.init.body)).images).toHaveLength(2)
  })

  it('accepts HTTPS and data image URLs without sending base64_data', async () => {
    const https = await omniAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { imageUrl: 'https://example.test/image.jpg', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })
    const httpsBody = JSON.parse(String(https.init.body))
    expect(httpsBody.images).toEqual(['https://example.test/image.jpg'])
    expect(httpsBody).not.toHaveProperty('base64_data')

    const dataUrl = 'data:image/png;base64,ZmFrZQ=='
    const data = await omniAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { imageUrl: dataUrl, refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })
    expect(JSON.parse(String(data.init.body)).images).toEqual([dataUrl])
  })

  it.each([
    ['images', task({ mode: 'ref2v', inputs: { refImageIds: ['1', '2', '3', '4', '5', '6', '7', '8'], refVideoIds: [], refAudioIds: [], refItems: [] } }), /7/],
    ['ratio', task({ params: { duration: 10, resolution: '720p', aspectRatio: '1:1', audio: false, n: 1 } }), /aspect_ratio/],
    ['resolution', task({ params: { duration: 10, resolution: '480p', aspectRatio: '16:9', audio: false, n: 1 } }), /resolution/],
    ['seconds', task({ params: { duration: 9, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 } }), /seconds/],
    ['quantity', task({ params: { duration: 10, resolution: '720p', aspectRatio: '16:9', audio: false, n: 2 } }), /数量/],
  ])('rejects invalid %s', async (_name, selectedTask, message) => {
    await expect(omniAdapter.buildSubmit({ task: selectedTask, profile })).rejects.toThrow(message)
  })

  it('rejects unsupported tail frame, video, and audio references', async () => {
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'flf2v', inputs: { firstFrameId: 'one', lastFrameId: 'two', refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } }), profile })).rejects.toThrow(/尾帧|首尾帧|支持/)
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'ref2v', inputs: { refImageIds: [], refVideoIds: ['video'], refAudioIds: [], refItems: [{ id: 'video', type: 'video' }] } }), profile })).rejects.toThrow(/参考视频|视频/)
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'ref2v', inputs: { refImageIds: [], refVideoIds: [], refAudioIds: ['audio'], refItems: [{ id: 'audio', type: 'audio' }] } }), profile })).rejects.toThrow(/参考音频|音频/)
  })

  it('parses task ids and all supported poll statuses', () => {
    expect(omniAdapter.parseSubmit({ id: 'a', status: 'queued' })).toMatchObject({ taskId: 'a', status: 'queued' })
    expect(omniAdapter.parseSubmit({ task_id: 'b', status: 'in_progress' })).toMatchObject({ taskId: 'b', status: 'running' })
    expect(omniAdapter.parseSubmit({ data: { id: 'c' } })).toMatchObject({ taskId: 'c' })
    expect(omniAdapter.parseSubmit({ data: { task_id: 'd' } })).toMatchObject({ taskId: 'd' })
    expect(omniAdapter.parsePoll({ status: 'queued' }).status).toBe('queued')
    expect(omniAdapter.parsePoll({ status: 'pending' }).status).toBe('queued')
    expect(omniAdapter.parsePoll({ status: 'in_progress' }).status).toBe('running')
    expect(omniAdapter.parsePoll({ status: 'processing' }).status).toBe('running')
    expect(omniAdapter.parsePoll({ status: 'completed' }).status).toBe('succeeded')
    expect(omniAdapter.parsePoll({ status: 'succeeded' }).status).toBe('succeeded')
    for (const status of ['failed', 'cancelled', 'expired']) expect(omniAdapter.parsePoll({ status }).status).toBe('failed')
  })

  it('builds authenticated poll and content requests and rejects missing keys', () => {
    expect(omniAdapter.buildPoll('task/a', profile).url).toBe('/api-proxy/v1/videos/task%2Fa')
    expect(omniAdapter.buildContent('task/a', profile).url).toBe('/api-proxy/v1/videos/task%2Fa/content')
    expect(() => omniAdapter.buildPoll('task-1', { ...profile, apiKey: ' ' })).toThrow('请先在设置 → API 配置中填写 API Key')
    expect(() => omniAdapter.buildContent('task-1', { ...profile, apiKey: ' ' })).toThrow('请先在设置 → API 配置中填写 API Key')
  })

  it('rejects missing submit keys, invalid image schemes, missing images, and non-image MIME', async () => {
    await expect(omniAdapter.buildSubmit({ task: task(), profile: { ...profile, apiKey: ' ' } })).rejects.toThrow('请先在设置 → API 配置中填写 API Key')
    for (const imageUrl of ['http://example.test/a.png', 'file:///C:/image.png', 'C:\\image.png', 'blob:https://example.test/id', 'data:text/plain;base64,ZmFrZQ==']) {
      await expect(omniAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { imageUrl, refImageIds: [], refVideoIds: [], refAudioIds: [] } }), profile })).rejects.toThrow(/HTTPS|image/)
    }
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'i2v' }), profile })).rejects.toThrow(/图片/)
    vi.mocked(getMedia).mockResolvedValueOnce({ id: 'bad', blob: new Blob(['x'], { type: 'video/mp4' }), mime: 'video/mp4', size: 1, source: 'upload', uploadedAt: 0 })
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { firstFrameId: 'bad', refImageIds: [], refVideoIds: [], refAudioIds: [] } }), profile })).rejects.toThrow(/image/)
  })

  it('uses fetch mocks for submit, poll and content download without relying on video_url', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { task_id: 'task-1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'completed', progress: 100 } })))
      .mockResolvedValueOnce(new Response(new Blob(['video-bytes'], { type: 'video/mp4' })))
    vi.stubGlobal('fetch', fetchMock)
    const selectedTask = task()
    expect(await submitVideoTask(selectedTask)).toMatchObject({ remoteTaskId: 'task-1', status: 'queued' })
    expect(await pollVideoTask('task-1', selectedTask)).toMatchObject({ status: 'succeeded', progress: 100 })
    const blob = await downloadVideoContent('task-1', selectedTask)
    expect(blob.type).toBe('video/mp4')
    expect(await blob.text()).toBe('video-bytes')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api-proxy/v1/videos', '/api-proxy/v1/videos/task-1', '/api-proxy/v1/videos/task-1/content'])
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get('Authorization')).toBe('Bearer mock-video-key')
  })

  it('keeps internal service details out of HTTP error messages', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: '内部服务 provider.example.test 无法处理请求' }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitVideoTask(task())).rejects.toThrow('提交失败（503）：中转站暂时不可用，请稍后重试')
    await expect(pollVideoTask('task-1', task())).rejects.toThrow('查询失败（503）：中转站暂时不可用，请稍后重试')
    await expect(downloadVideoContent('task-1', task())).rejects.toThrow('下载失败（503）：中转站暂时不可用，请稍后重试')
  })

  it('accepts exactly seven mixed HTTPS and data references and serializes reference mentions', async () => {
    const { encodeVideoMention } = await import('../videoPromptMentions')
    const dataUrl = 'data:image/png;base64,ZmFrZQ=='
    const spec = await omniAdapter.buildSubmit({ task: task({
      mode: 'ref2v',
      prompt: `参考${encodeVideoMention({ id: 'one', type: 'image', label: '图片1' })}`,
      inputs: { refImageIds: ['one'], refVideoIds: [], refAudioIds: [], refItems: [{ id: 'one', type: 'image' }], imageUrls: Array.from({ length: 6 }, (_, index) => index % 2 ? dataUrl : 'https://example.test/image.png') },
    }), profile })
    const body = JSON.parse(String(spec.init.body))
    expect(body.images).toHaveLength(7)
    expect(body.prompt).toBe('参考图片1')
    expect(Object.keys(body).sort()).toEqual(['model', 'prompt', 'seconds', 'aspect_ratio', 'resolution', 'images'].sort())
    expect(String(spec.init.body)).not.toContain('input_reference')
    expect(String(spec.init.body)).not.toContain('base64_data')
  })

  it.each(['queued', 'pending', 'in_progress', 'processing', 'completed', 'succeeded', 'failed', 'cancelled', 'expired'])('parses nested %s status', (status) => {
    expect(omniAdapter.parsePoll({ data: { status, progress: 45, error: 'private service detail' } })).toEqual(omniAdapter.parsePoll({ status, progress: 45 }))
  })

  it('rejects missing media, mismatched Blob MIME, and invalid response ids or statuses', async () => {
    const imageTask = task({ mode: 'i2v', inputs: { firstFrameId: 'missing', refImageIds: [], refVideoIds: [], refAudioIds: [] } })
    vi.mocked(getMedia).mockResolvedValueOnce(undefined)
    await expect(omniAdapter.buildSubmit({ task: imageTask, profile })).rejects.toThrow('参考图片不存在')
    vi.mocked(getMedia).mockResolvedValueOnce({ id: 'bad', blob: new Blob(['x'], { type: 'audio/mp3' }), mime: 'image/png', size: 1, source: 'upload', uploadedAt: 0 })
    await expect(omniAdapter.buildSubmit({ task: imageTask, profile })).rejects.toThrow(/image/)
    expect(() => omniAdapter.parseSubmit({ id: ' ' })).toThrow('任务 ID')
    expect(() => omniAdapter.parsePoll({ status: 'unrecognized' })).toThrow('未知状态')
    expect(() => omniAdapter.parsePoll({ error: 'invalid response' })).toThrow('未知状态')
    expect(() => omniAdapter.parsePoll({ data: {} })).toThrow('未知状态')
    expect(() => omniAdapter.parsePoll(null)).toThrow('未知状态')
  })

  it('rejects multiple images in single image mode, missing references, and source videos', async () => {
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { refImageIds: ['one', 'two'], refVideoIds: [], refAudioIds: [] } }), profile })).rejects.toThrow(/1 张/)
    await expect(omniAdapter.buildSubmit({ task: task({ mode: 'ref2v' }), profile })).rejects.toThrow(/至少/)
    await expect(omniAdapter.buildSubmit({ task: task({ inputs: { sourceVideoId: 'source', refImageIds: [], refVideoIds: [], refAudioIds: [] } }), profile })).rejects.toThrow('参考视频')
    await expect(omniAdapter.buildSubmit({ task: task({ inputs: { lastFrameId: 'tail', refImageIds: [], refVideoIds: [], refAudioIds: [] } }), profile })).rejects.toThrow('尾帧')
  })

  it('surfaces FileReader failures without sending a request', async () => {
    const readFailure = vi.fn(function (this: { onerror: () => void }) { this.onerror() })
    vi.stubGlobal('FileReader', class { onerror = null; onload = null; readAsDataURL = readFailure })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitVideoTask(task({ mode: 'i2v', inputs: { firstFrameId: 'one', refImageIds: [], refVideoIds: [], refAudioIds: [] } }))).rejects.toThrow('参考图片读取失败')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
