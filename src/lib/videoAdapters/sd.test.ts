import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../videoDb', () => ({ getMedia: vi.fn() }))

import { sdAdapter } from './sd'
import { downloadVideoContent, formatVideoTaskError, pollVideoTask, submitVideoTask } from '../videoApi'
import { getMedia } from '../videoDb'
import { encodeVideoMention } from '../videoPromptMentions'
import type { MediaRecord, VideoTaskRecord } from '../videoTypes'

const profile = {
  profileId: 'profile-sd',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'mock-sd-video-key',
  apiProxy: true,
}
const models = [
  { model: 'sd2.0-15s', duration: 15 },
  { model: 'sd2.5-30s', duration: 30 },
]
const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const maxImageBytes = 15 * 1024 * 1024
const dataUrl = 'data:image/png;base64,ZmFrZQ=='
const readAsDataURL = vi.fn(function (this: { result: string | null; onload?: () => void }, blob: Blob) {
  void blob.arrayBuffer().then((buffer) => {
    this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
    this.onload?.()
  })
})

function media(id: string, blob = new Blob([`image-${id}`], { type: 'image/jpeg' })): MediaRecord {
  return { id, blob, mime: blob.type, size: blob.size, source: 'upload', uploadedAt: 0 }
}

function task(overrides: Partial<VideoTaskRecord> = {}): VideoTaskRecord {
  return {
    id: 'local-sd-task', prompt: 'A fox walking through a meadow', mode: 't2v', model: 'sd2.0-15s',
    params: { duration: 15, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 },
    inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] },
    status: 'queued', adapter: 'sd' as VideoTaskRecord['adapter'], error: null,
    createdAt: 0, finishedAt: null, elapsed: null, apiProfile: profile, ...overrides,
  }
}

function imageInputs(overrides: Partial<VideoTaskRecord['inputs']> = {}): VideoTaskRecord['inputs'] {
  return { refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], ...overrides }
}

beforeEach(() => {
  vi.mocked(getMedia).mockReset().mockImplementation(async (id) => media(id))
  readAsDataURL.mockClear()
  vi.stubGlobal('FileReader', class { result = null; onload = null; onerror = null; onabort = null; readAsDataURL = readAsDataURL })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe.each(models)('sdAdapter $model', ({ model, duration }) => {
  function selectedTask(overrides: Partial<VideoTaskRecord> = {}) {
    return task({ model, params: { duration, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 }, ...overrides })
  }

  it('submits authenticated JSON with the fixed duration and quantity', async () => {
    const spec = await sdAdapter.buildSubmit({ task: selectedTask(), profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(spec.init.method).toBe('POST')
    expect(new Headers(spec.init.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-sd-video-key')
    expect(JSON.parse(String(spec.init.body))).toEqual({
      model, prompt: 'A fox walking through a meadow', seconds: duration,
      resolution: '720p', aspect_ratio: '16:9', n: 1,
    })
  })

  it.each(aspectRatios)('supports %s at 720p and 1080p without sending size', async (aspectRatio) => {
    for (const resolution of ['720p', '1080p'] as const) {
      const spec = await sdAdapter.buildSubmit({ task: selectedTask({ params: { duration, resolution, aspectRatio, audio: false, n: 1 } }), profile })
      const body = JSON.parse(String(spec.init.body))
      expect(body).toMatchObject({ model, seconds: duration, resolution, aspect_ratio: aspectRatio, n: 1 })
      expect(body).not.toHaveProperty('size')
    }
  })

  it('converts an IndexedDB Blob through FileReader into reference_images for single image mode', async () => {
    const spec = await sdAdapter.buildSubmit({ task: selectedTask({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'one' }) }), profile })
    const body = JSON.parse(String(spec.init.body))
    expect(body.reference_images).toHaveLength(1)
    expect(body.reference_images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(Buffer.from(body.reference_images[0].split(',')[1], 'base64').toString()).toBe('image-one')
    expect(getMedia).toHaveBeenCalledWith('one')
    expect(readAsDataURL).toHaveBeenCalledWith(expect.any(Blob))
    for (const field of ['first_frame', 'first_frame_url', 'last_frame', 'last_frame_url', 'input_reference', 'images', 'base64_data']) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it('submits ordered multiple image references as reference_images and serializes prompt mentions', async () => {
    const inputs = imageInputs({ refImageIds: ['one', 'two'], refItems: [{ id: 'one', type: 'image' }, { id: 'two', type: 'image' }] })
    const prompt = `保持${encodeVideoMention({ id: 'one', type: 'image', label: '图片1' })}的外观`
    const spec = await sdAdapter.buildSubmit({ task: selectedTask({ mode: 'ref2v', inputs, prompt }), profile })
    const body = JSON.parse(String(spec.init.body))
    expect(body.prompt).toBe('保持图片1的外观')
    expect(body.reference_images.map((value: string) => Buffer.from(value.split(',')[1], 'base64').toString())).toEqual(['image-one', 'image-two'])
    expect(body).not.toHaveProperty('base64_data')
    expect(body).not.toHaveProperty('input_reference')
  })

  it.each(['https://example.test/image.png', 'http://example.test/image.jpg', dataUrl])('accepts a supported image URL %s', async (imageUrl) => {
    const spec = await sdAdapter.buildSubmit({ task: selectedTask({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })
    expect(JSON.parse(String(spec.init.body)).reference_images).toEqual([imageUrl])
    expect(getMedia).not.toHaveBeenCalled()
    expect(readAsDataURL).not.toHaveBeenCalled()
  })

  it('rejects another model duration rather than silently changing it', async () => {
    const otherDuration = duration === 15 ? 30 : 15
    await expect(sdAdapter.buildSubmit({ task: selectedTask({ params: { duration: otherDuration, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 } }), profile })).rejects.toThrow(/seconds|时长/)
  })

  it('uses fetch mocks for submit, polling, and content without a video_url', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { task_id: 'task-1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'completed', progress: 100 } })))
      .mockResolvedValueOnce(new Response(new Blob(['video-bytes'], { type: 'video/mp4' })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await submitVideoTask(selectedTask())).toMatchObject({ remoteTaskId: 'task-1', status: 'queued', recoverable: true })
    expect(await pollVideoTask('task-1', selectedTask())).toMatchObject({ status: 'succeeded', progress: 100 })
    const blob = await downloadVideoContent('task-1', selectedTask())
    expect(blob.type).toBe('video/mp4')
    expect(await blob.text()).toBe('video-bytes')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api-proxy/v1/videos', '/api-proxy/v1/videos/task-1', '/api-proxy/v1/videos/task-1/content'])
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init.headers).get('Authorization')).toBe('Bearer mock-sd-video-key')
  })
})

describe('SD reference validation', () => {
  it('accepts thirty unique references in array order and deduplicates repeated inputs', async () => {
    const urls = Array.from({ length: 30 }, (_, i) => `https://example.test/image-${i}.png`)
    const spec = await sdAdapter.buildSubmit({ task: task({ mode: 'ref2v', inputs: imageInputs({ imageUrls: [...urls, urls[0]], imageUrl: urls[0] }) }), profile })
    expect(JSON.parse(String(spec.init.body)).reference_images).toEqual(urls)
  })

  it('deduplicates local IDs that appear in both reference lists before reading the media', async () => {
    const spec = await sdAdapter.buildSubmit({ task: task({ mode: 'ref2v', inputs: imageInputs({ refImageIds: ['one', 'two', 'one'], refItems: [{ id: 'one', type: 'image' }, { id: 'two', type: 'image' }] }) }), profile })
    expect(JSON.parse(String(spec.init.body)).reference_images).toHaveLength(2)
    expect(getMedia).toHaveBeenCalledTimes(2)
  })

  it('rejects thirty-one unique reference images before reading media or sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitVideoTask(task({ mode: 'ref2v', inputs: imageInputs({ refImageIds: Array.from({ length: 31 }, (_, i) => `image-${i}`) }) }))).rejects.toThrow(/30/)
    expect(getMedia).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])('supports %s Blob and Data URL images', async (mime) => {
    vi.mocked(getMedia).mockResolvedValueOnce(media('one', new Blob(['image'], { type: mime })))
    const blobSpec = await sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'one' }) }), profile })
    expect(JSON.parse(String(blobSpec.init.body)).reference_images[0]).toMatch(new RegExp(`^data:${mime};base64,`))
    const imageUrl = `data:${mime};base64,ZmFrZQ==`
    const dataSpec = await sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })
    expect(JSON.parse(String(dataSpec.init.body)).reference_images).toEqual([imageUrl])
  })

  it.each(['video/mp4', 'audio/mp3', 'text/plain', 'image/gif', 'image/svg+xml'])('rejects unsupported Blob MIME %s', async (mime) => {
    vi.mocked(getMedia).mockResolvedValueOnce(media('bad', new Blob(['x'], { type: mime })))
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'bad' }) }), profile })).rejects.toThrow(/图片|image|JPEG|PNG|WEBP/)
  })

  it('checks the Blob MIME even when stored MIME claims a supported image', async () => {
    vi.mocked(getMedia).mockResolvedValueOnce({ ...media('bad', new Blob(['x'], { type: 'video/mp4' })), mime: 'image/png' })
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'bad' }) }), profile })).rejects.toThrow(/图片|image|JPEG|PNG|WEBP/)
  })

  it.each(['file:///C:/image.png', 'C:\\image.png', 'blob:https://example.test/id', 'data:text/plain;base64,ZmFrZQ==', 'data:image/gif;base64,ZmFrZQ==', 'data:image/png;base64,', 'data:image/png;base64,@@@'])('rejects malformed or unsupported image URL %s', async (imageUrl) => {
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })).rejects.toThrow(/图片|image|HTTP|JPEG|PNG|WEBP/)
  })

  it.each(['AA=', 'A==', 'AA===', 'AAA==', 'A===', 'AAAA=', 'AAAA==', 'AA=A', '=AAA', 'AA', 'AAA', 'AB==', 'AAB='])('rejects incomplete Base64 length or padding %s', async (payload) => {
    const imageUrl = `data:image/png;base64,${payload}`
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })).rejects.toThrow(/图片|Data URL/)
  })

  it.each(['AA==', 'AAA=', 'AAAA', '////', '/w==', '//8='])('accepts canonical Base64 padding %s', async (payload) => {
    const imageUrl = `data:image/png;base64,${payload}`
    const spec = await sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })
    expect(JSON.parse(String(spec.init.body)).reference_images).toEqual([imageUrl])
  })

  it('rejects a large malformed Base64 image without a regex stack error', async () => {
    const imageUrl = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}=A`
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl }) }), profile })).rejects.toThrow(/图片|Data URL/)
  })

  it('rejects a local image above fifteen MB using actual Blob size', async () => {
    const oversized = media('large', new Blob([new Uint8Array(maxImageBytes + 1)], { type: 'image/png' }))
    vi.mocked(getMedia).mockResolvedValueOnce({ ...oversized, size: 1 })
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'large' }) }), profile })).rejects.toThrow(/15.*MB/i)
    expect(readAsDataURL).not.toHaveBeenCalled()
  })

  it('accepts a fifteen MB Data URL and rejects one decoded byte more', async () => {
    const maxDataUrl = `data:image/png;base64,${Buffer.alloc(maxImageBytes).toString('base64')}`
    const accepted = await sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl: maxDataUrl }) }), profile })
    expect(JSON.parse(String(accepted.init.body)).reference_images).toHaveLength(1)
    const oversizedDataUrl = `data:image/png;base64,${Buffer.alloc(maxImageBytes + 1).toString('base64')}`
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrl: oversizedDataUrl }) }), profile })).rejects.toThrow(/15.*MB/i)
  })

  it('rejects missing local media', async () => {
    vi.mocked(getMedia).mockResolvedValueOnce(undefined)
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'missing' }) }), profile })).rejects.toThrow(/图片.*不存在|重新上传/)
  })

  it('surfaces FileReader failure before making any request', async () => {
    vi.stubGlobal('FileReader', class { onerror: (() => void) | null = null; readAsDataURL() { this.onerror?.() } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitVideoTask(task({ mode: 'i2v', inputs: imageInputs({ firstFrameId: 'one' }) }))).rejects.toThrow(/图片读取失败/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SD task validation', () => {
  it.each([
    ['aspect ratio', { aspectRatio: '3:2' }, /aspect_ratio|比例/],
    ['resolution', { resolution: '480p' }, /resolution|清晰度/],
    ['duration', { duration: 10 }, /seconds|时长/],
    ['quantity', { n: 2 }, /数量|quantity/],
  ] as const)('rejects unsupported %s', async (_name, params, message) => {
    await expect(sdAdapter.buildSubmit({ task: task({ params: { ...task().params, ...params } }), profile })).rejects.toThrow(message)
  })

  it.each([
    ['strict first/last frame mode', task({ mode: 'flf2v', inputs: imageInputs({ firstFrameId: 'one', lastFrameId: 'two' }) }), /首尾帧|尾帧/],
    ['tail frame', task({ inputs: imageInputs({ lastFrameId: 'tail' }) }), /尾帧/],
    ['reference video', task({ mode: 'ref2v', inputs: imageInputs({ refVideoIds: ['video'] }) }), /参考视频/],
    ['reference audio', task({ mode: 'ref2v', inputs: imageInputs({ refAudioIds: ['audio'] }) }), /参考音频/],
    ['source video', task({ inputs: imageInputs({ sourceVideoId: 'video' }) }), /参考视频/],
    ['video refItems', task({ mode: 'ref2v', inputs: imageInputs({ refItems: [{ id: 'video', type: 'video' }] }) }), /参考视频/],
    ['audio refItems', task({ mode: 'ref2v', inputs: imageInputs({ refItems: [{ id: 'audio', type: 'audio' }] }) }), /参考音频/],
  ])('rejects unsupported %s', async (_name, selectedTask, message) => {
    await expect(sdAdapter.buildSubmit({ task: selectedTask, profile })).rejects.toThrow(message)
  })

  it('rejects missing or multiple images in single image mode', async () => {
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v' }), profile })).rejects.toThrow(/1.*张|图片/)
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: imageInputs({ imageUrls: ['https://example.test/a.png', 'https://example.test/b.png'] }) }), profile })).rejects.toThrow(/1.*张/)
  })

  it('rejects empty reference mode and images in text-only mode', async () => {
    await expect(sdAdapter.buildSubmit({ task: task({ mode: 'ref2v' }), profile })).rejects.toThrow(/至少|图片/)
    await expect(sdAdapter.buildSubmit({ task: task({ inputs: imageInputs({ imageUrl: 'https://example.test/image.png' }) }), profile })).rejects.toThrow(/文生视频|模式/)
  })

  it('requires a nonempty prompt for both text and image generation', async () => {
    await expect(sdAdapter.buildSubmit({ task: task({ prompt: '  ' }), profile })).rejects.toThrow(/提示词/)
    await expect(sdAdapter.buildSubmit({ task: task({ prompt: '  ', mode: 'i2v', inputs: imageInputs({ imageUrl: 'https://example.test/image.png' }) }), profile })).rejects.toThrow(/提示词/)
  })

  it('rejects a model that does not belong to this adapter', async () => {
    await expect(sdAdapter.buildSubmit({ task: task({ model: 'MiniMax-H3' }), profile })).rejects.toThrow(/模型/)
  })

  it('omits unsupported seed, negative prompt, and user audio switches', async () => {
    const spec = await sdAdapter.buildSubmit({ task: task({ params: { ...task().params, audio: true, seed: 42, negativePrompt: 'blur', cameraFixed: true } }), profile })
    const body = JSON.parse(String(spec.init.body))
    for (const field of ['audio', 'seed', 'negative_prompt', 'negativePrompt', 'camera_fixed', 'cameraFixed']) expect(body).not.toHaveProperty(field)
  })

  it('rejects missing API Key for submit, polling, and content download with the existing Chinese hint', async () => {
    const emptyProfile = { ...profile, apiKey: '  ' }
    const hint = '请先在设置 → API 配置中填写 API Key'
    await expect(sdAdapter.buildSubmit({ task: task(), profile: emptyProfile })).rejects.toThrow(hint)
    expect(() => sdAdapter.buildPoll('task-1', emptyProfile)).toThrow(hint)
    expect(() => sdAdapter.buildContent('task-1', emptyProfile)).toThrow(hint)
  })

  it('uses and trims the key belonging to each selected API Profile', async () => {
    const otherProfile = { ...profile, apiKey: '  mock-other-sd-key  ' }
    const spec = await sdAdapter.buildSubmit({ task: task(), profile: otherProfile })
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-other-sd-key')
    expect(new Headers(sdAdapter.buildPoll('task-1', profile).init.headers).get('Authorization')).toBe('Bearer mock-sd-video-key')
  })
})

describe('SD asynchronous task responses', () => {
  it.each([
    [{ id: 'task-a' }, 'task-a'],
    [{ task_id: 'task-b' }, 'task-b'],
    [{ data: { id: 'task-c' } }, 'task-c'],
    [{ data: { task_id: 'task-d' } }, 'task-d'],
  ])('parses create response %j', (response, taskId) => {
    expect(sdAdapter.parseSubmit(response)).toMatchObject({ taskId, status: 'queued' })
  })

  it('trims task IDs and parses a running submit response', () => {
    expect(sdAdapter.parseSubmit({ data: { id: ' task-a ', status: 'in_progress' } })).toMatchObject({ taskId: 'task-a', status: 'running' })
  })

  it.each([
    ['queued', 'queued'], ['pending', 'queued'], ['in_progress', 'running'], ['processing', 'running'],
    ['completed', 'succeeded'], ['succeeded', 'succeeded'], ['failed', 'failed'], ['cancelled', 'failed'], ['expired', 'failed'],
  ])('parses top-level and nested %s status as %s', (status, expectedStatus) => {
    const result = sdAdapter.parsePoll({ status, progress: 100 })
    expect(result).toMatchObject({ status: expectedStatus, progress: 100 })
    expect(sdAdapter.parsePoll({ data: { status, progress: 100 } })).toEqual(result)
    expect(result).not.toHaveProperty('videoUrl')
  })

  it('treats failed progress 100 as failure and keeps private service details out of errors', () => {
    const result = sdAdapter.parsePoll({ status: 'failed', progress: 100, error: { message: 'private-service.example.test internal failed' } })
    expect(result.status).toBe('failed')
    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain('private-service.example.test')
    expect(result.error).not.toContain('internal')
  })

  it.each([
    { error: { message: '账户额度不足，请充值后重试' } },
    { data: { error: { message: '参考图片参数无效，请重新上传' } } },
    { fail_reason: '内容不符合要求，请调整提示词' },
    { data: { fail_reason: 'Invalid image dimensions' } },
    { error: 'Content does not meet the requirements' },
    { message: '生成视频失败，请稍后重试' },
  ])('retains readable safe failure reasons from %j', (fields) => {
    const response = { status: 'failed', ...fields }
    const values = fields as Record<string, unknown>
    const nested = values.data as Record<string, unknown> | undefined
    const raw = values.error ?? values.fail_reason ?? values.message ?? nested?.error ?? nested?.fail_reason
    const reason = typeof raw === 'string' ? raw : (raw as { message: string }).message
    const result = sdAdapter.parsePoll(response)
    expect(result.error).toContain(reason)
    expect(formatVideoTaskError(result.error!)).toBe(result.error)
  })

  it.each([
    '调用 https://private-service.example.test/v1/videos 失败',
    'private-service.example.test rejected the request',
    'Failure(private-service.example.test:443)',
    '原因：private-service.example.test 请求失败',
    'Failure(cdn.example.test:443)',
    '原因：cdn.example.test 请求失败',
    'Unexpected response: {"worker_id":"mock-value"}',
    '无法连接 192.168.10.20:8000',
    'file:///private/worker.log cannot be read',
    'upstream account is restricted',
    '上游账号受限',
    '服务端内部节点未就绪',
    '供应商内部服务返回失败',
    'Authorization: Bearer mock-sensitive-token-value',
    'api_key=mock-private-key-value',
    '后台渠道密钥缺失',
    '令牌 mock-private-token-value 不可用',
    '密码未配置',
    'password=mock-private-password-value',
    'Unexpected response: {"private_worker":"mock-value"}',
    'Traceback: stack trace in private worker',
    'image read failed at C:\\private-service\\images\\ref.png',
    'credentials are unavailable',
    'x'.repeat(300),
  ])('replaces sensitive failure details with a generic Chinese reason', (reason) => {
    const result = sdAdapter.parsePoll({ status: 'failed', error: { message: reason } })
    expect(result.error).toBe('视频任务未成功或已过期，请检查任务状态后重试')
    expect(result.error).not.toContain(reason)
  })

  it('does not show a failure reason on a successful task', () => {
    expect(sdAdapter.parsePoll({ status: 'completed', error: { message: 'Private error detail' } })).not.toHaveProperty('error')
  })

  it('rejects malformed response IDs and unrecognized poll states', () => {
    for (const response of [null, {}, { id: '  ' }, { task_id: 42 }]) expect(() => sdAdapter.parseSubmit(response)).toThrow(/任务 ID/)
    for (const response of [null, {}, { status: 'unknown' }, { data: {} }]) expect(() => sdAdapter.parsePoll(response)).toThrow(/未知状态/)
  })

  it('builds authenticated encoded polling and content proxy paths', () => {
    const poll = sdAdapter.buildPoll('task/a', profile)
    const content = sdAdapter.buildContent('task/a', profile)
    expect(poll.url).toBe('/api-proxy/v1/videos/task%2Fa')
    expect(content.url).toBe('/api-proxy/v1/videos/task%2Fa/content')
    for (const request of [poll, content]) {
      expect(request.init.method).toBe('GET')
      expect(new Headers(request.init.headers).get('Authorization')).toBe('Bearer mock-sd-video-key')
    }
  })

  it('keeps internal service details out of HTTP errors from submit, poll, and content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '内部服务 private-service.example.test 无法处理请求' }), { status: 503 })))
    await expect(submitVideoTask(task())).rejects.toThrow('提交失败（503）：中转站暂时不可用，请稍后重试')
    await expect(pollVideoTask('task-1', task())).rejects.toThrow('查询失败（503）：中转站暂时不可用，请稍后重试')
    await expect(downloadVideoContent('task-1', task())).rejects.toThrow('下载失败（503）：中转站暂时不可用，请稍后重试')
  })
})
