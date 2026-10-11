import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaRecord, VideoTaskRecord } from '../videoTypes'
import { encodeVideoMention } from '../videoPromptMentions'

vi.mock('../videoDb', () => ({ getMedia: vi.fn() }))
import { getMedia } from '../videoDb'
import { sdMediaAdapter } from './sdMedia'
import { downloadVideoContent, submitVideoTask } from '../videoApi'

const profile = { profileId: 'p1', baseUrl: 'https://vip.example.test/v1', apiKey: 'mock-user-key', apiProxy: false }
const inputs = () => ({ refImageIds: [] as string[], refVideoIds: [] as string[], refAudioIds: [] as string[] })
const task = (extra: Partial<VideoTaskRecord> = {}): VideoTaskRecord => ({
  id: 'local', prompt: '海边日出', model: 'sd2-933-3', mode: 't2v',
  params: { duration: 8, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 },
  inputs: inputs(), adapter: 'sdMedia', status: 'queued', error: null,
  createdAt: 0, finishedAt: null, elapsed: null, apiProfile: profile, ...extra,
})
function media(id: string, type: 'image' | 'video' | 'audio' = 'image', extra: Partial<MediaRecord> = {}): MediaRecord {
  const mime = { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }[type]
  const blob = new Blob(['media'], { type: mime })
  return { id, blob, mime, size: blob.size, duration: type === 'image' ? undefined : 8, source: 'upload', uploadedAt: 0, ...extra }
}
let records: Map<string, MediaRecord>
beforeEach(() => {
  records = new Map()
  vi.mocked(getMedia).mockImplementation(async id => records.get(id))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, files: [{ url: `https://n.uguu.se/${vi.mocked(fetch).mock.calls.length}.media` }] }))))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const add = (...items: MediaRecord[]) => items.forEach(item => records.set(item.id, item))
const refTask = (images: string[] = [], videos: string[] = [], audios: string[] = []) => task({ mode: 'ref2v', inputs: { refImageIds: images, refVideoIds: videos, refAudioIds: audios } })
async function body(selected = task()) { return JSON.parse(String((await sdMediaAdapter.buildSubmit({ task: selected, profile })).init.body)) }
async function rejectsBeforeUpload(selected: VideoTaskRecord, message: RegExp) {
  await expect(sdMediaAdapter.buildSubmit({ task: selected, profile })).rejects.toThrow(message)
  expect(fetch).not.toHaveBeenCalled()
}

describe('sdMediaAdapter', () => {
  it.each([['sd2-933-3', 8], ['sd2-933-全', 15], ['sd2.5-10-全', 30]] as const)('submits %s using only the public JSON protocol', async (model, duration) => {
    const selected = task({ model, params: { ...task().params, duration } })
    const spec = await sdMediaAdapter.buildSubmit({ task: selected, profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(spec.init.method).toBe('POST')
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-user-key')
    expect(new Headers(spec.init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(spec.init.body))).toEqual({
      model,
      prompt: '海边日出',
      seconds: String(duration),
      resolution: '720p',
      aspect_ratio: '16:9',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uploads both frames with their exact roles and readable mention labels', async () => {
    add(media('first'), media('last'))
    const selected = task({ mode: 'flf2v', inputs: { ...inputs(), firstFrameId: 'first', lastFrameId: 'last' }, prompt: `从${encodeVideoMention({ id: 'first', type: 'image', label: '旧图9' })}过渡到${encodeVideoMention({ id: 'last', type: 'image', label: '旧图10' })}` })
    expect(await body(selected)).toMatchObject({ prompt: '从图片1过渡到图片2', media: [
      { type: 'first_frame', url: 'https://n.uguu.se/1.media' },
      { type: 'last_frame', url: 'https://n.uguu.se/2.media' },
    ] })
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe('/media-upload/uguu')
      expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    }
  })

  it('uses first_frame for a single image and supports the same image in both frame roles', async () => {
    add(media('image'))
    expect((await body(task({ mode: 'i2v', inputs: { ...inputs(), firstFrameId: 'image' } }))).media).toEqual([{ type: 'first_frame', url: 'https://n.uguu.se/1.media' }])
    expect((await body(task({ mode: 'flf2v', inputs: { ...inputs(), firstFrameId: 'image', lastFrameId: 'image' } }))).media.map((item: { type: string }) => item.type)).toEqual(['first_frame', 'last_frame'])
  })

  it('preserves mixed reference order and per-type mention numbering', async () => {
    add(media('i1'), media('i2'), media('v1', 'video'), media('a1', 'audio'))
    const selected = refTask(['i1', 'i2'], ['v1'], ['a1'])
    selected.inputs.refItems = [{ id: 'a1', type: 'audio' }, { id: 'i2', type: 'image' }, { id: 'v1', type: 'video' }, { id: 'i1', type: 'image' }]
    selected.prompt = ['i1', 'v1', 'a1'].map(id => encodeVideoMention({ id, type: id[0] === 'i' ? 'image' : id[0] === 'v' ? 'video' : 'audio', label: 'stale' })).join(' / ')
    expect(await body(selected)).toMatchObject({ prompt: '图片2 / 视频1 / 音频1', media: [
      { type: 'reference_voice', url: 'https://n.uguu.se/1.media' },
      { type: 'reference_image', url: 'https://n.uguu.se/2.media' },
      { type: 'reference_video', url: 'https://n.uguu.se/3.media' },
      { type: 'reference_image', url: 'https://n.uguu.se/4.media' },
    ] })
    expect(vi.mocked(getMedia).mock.calls.map(([id]) => id)).toEqual(['a1', 'i2', 'v1', 'i1'])
  })

  it.each(['sd2-933-3', 'sd2-933-全'])('accepts the full 9/3/3 reference boundary for %s', async model => {
    const images = Array.from({ length: 9 }, (_, index) => `i${index}`)
    const videos = ['v1', 'v2', 'v3'], audios = ['a1', 'a2', 'a3']
    add(...images.map(id => media(id)), ...videos.map(id => media(id, 'video')), ...audios.map(id => media(id, 'audio')))
    const payload = await body({ ...refTask(images, videos, audios), model })
    expect(payload.media).toHaveLength(15)
    expect(payload).not.toHaveProperty('n')
  })

  it.each([['image', 10, /9/], ['video', 4, /3/], ['audio', 4, /3/]] as const)('rejects too many %s references before any upload', async (type, count, match) => {
    const ids = Array.from({ length: count }, (_, index) => `${type}${index}`)
    await rejectsBeforeUpload(refTask(type === 'image' ? ids : [], type === 'video' ? ids : [], type === 'audio' ? ids : []), match)
  })

  it('accepts ten images and rejects the eleventh for the 30 second model', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `image${index}`)
    add(...ids.map(id => media(id)))
    const selected = { ...refTask(ids), model: 'sd2.5-10-全', params: { ...task().params, duration: 30 } }
    expect((await body(selected)).media).toHaveLength(10)
    vi.mocked(fetch).mockClear()
    await rejectsBeforeUpload({ ...selected, inputs: { ...inputs(), refImageIds: [...ids, 'extra'] } }, /10/)
  })

  it.each(['video', 'audio'] as const)('rejects %s references for the 30 second model', async type => {
    const selected = { ...refTask([], type === 'video' ? ['clip'] : [], type === 'audio' ? ['voice'] : []), model: 'sd2.5-10-全', params: { ...task().params, duration: 30 } }
    await rejectsBeforeUpload(selected, /不支持/)
  })

  it('does not inherit Wan-only restrictions on audio combinations or video frame rates', async () => {
    add(media('voice', 'audio'), media('clip', 'video'))
    expect((await body(refTask([], [], ['voice']))).media[0].type).toBe('reference_voice')
    expect((await body(refTask([], ['clip']))).media[0].type).toBe('reference_video')
  })

  it.each([
    [{ model: 'sd2.0-15s' }, /模型/],
    [{ prompt: ' ' }, /提示词/],
    [{ params: { ...task().params, duration: 3 } }, /4.*15/],
    [{ params: { ...task().params, duration: 16 } }, /4.*15/],
    [{ params: { ...task().params, duration: 4.5 } }, /整数/],
    [{ model: 'sd2.5-10-全' }, /30/],
    [{ params: { ...task().params, resolution: '1080p' } }, /720p/],
    [{ params: { ...task().params, aspectRatio: '4:3' } }, /比例/],
    [{ params: { ...task().params, n: 4 } }, /数量/],
    [{ params: { ...task().params, seed: 5 } }, /不支持/],
    [{ mode: 'i2v' }, /首帧|图片/],
    [{ mode: 'flf2v', inputs: { ...inputs(), firstFrameId: 'first' } }, /首尾帧/],
    [{ inputs: { ...inputs(), refImageIds: ['hidden'] } }, /文生视频/],
    [{ mode: 'ref2v' }, /至少/],
    [{ mode: 'ref2v', inputs: { ...inputs(), firstFrameId: 'hidden', refImageIds: ['image'] } }, /隐藏|首帧/],
  ] as Array<[Partial<VideoTaskRecord>, RegExp]>)('rejects invalid task before uploading: %j', async (extra, match) => rejectsBeforeUpload(task(extra), match))

  it('validates every local file before uploading the first file', async () => {
    add(media('good'), media('bad', 'image', { mime: 'video/mp4' }))
    await rejectsBeforeUpload(refTask(['good', 'bad']), /图片|格式/)
    add(media('oversized', 'image', { size: 51 * 1024 * 1024 }))
    await rejectsBeforeUpload(refTask(['good', 'oversized']), /50 MB/)
    await rejectsBeforeUpload(refTask(['good', 'missing']), /不存在/)
  })

  it('rejects corrupt image contents before any upload or generation request', async () => {
    add(media('good'), media('corrupt'))
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      if (blob === records.get('corrupt')!.blob) throw new Error('Image cannot be decoded')
      return { width: 640, height: 360, close: vi.fn() }
    }))
    await expect(submitVideoTask(refTask(['good', 'corrupt']))).rejects.toThrow(/图片.*读取失败/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects zero-dimension decoded images and releases decoded bitmap resources', async () => {
    add(media('image'))
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 0, height: 360, close })))
    await rejectsBeforeUpload(refTask(['image']), /图片.*读取失败/)
    expect(close).toHaveBeenCalledOnce()
  })

  it('uploads valid decoded images after releasing bitmap resources', async () => {
    add(media('image'))
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 360, close })))
    expect((await body(refTask(['image']))).media).toHaveLength(1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects stale mention IDs before uploading and does not expose editor tokens', async () => {
    add(media('image'))
    const selected = refTask(['image'])
    selected.prompt = encodeVideoMention({ id: 'removed', type: 'image', label: '图片2' })
    await rejectsBeforeUpload(selected, /已移除/)
    selected.prompt = '\u2063video-ref:invalid\u2064'
    await rejectsBeforeUpload(selected, /标签/)
  })

  it('never sends a video generation POST after an upload failure', async () => {
    add(media('image'))
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await expect(submitVideoTask(task({ mode: 'i2v', inputs: { ...inputs(), firstFrameId: 'image' } }))).rejects.toThrow(/上传/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/media-upload/uguu')
  })

  it('cancellation during an upload stops all later uploads and the generation POST', async () => {
    add(media('first'), media('last'))
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementationOnce(async () => {
      controller.abort()
      return new Response(JSON.stringify({ success: true, files: [{ url: 'https://n.uguu.se/a.png' }] }))
    })
    await expect(submitVideoTask(task({ mode: 'flf2v', inputs: { ...inputs(), firstFrameId: 'first', lastFrameId: 'last' } }), controller.signal)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses authenticated public task IDs for polling and content downloads', () => {
    expect(sdMediaAdapter.parseSubmit({ id: 'public/id', status: 'in_progress' })).toEqual({ taskId: 'public/id', status: 'running' })
    expect(sdMediaAdapter.parseSubmit({ task_id: 'task-only', status: 'RUNNING' })).toEqual({ taskId: 'task-only', status: 'running' })
    expect(sdMediaAdapter.buildPoll('public/id', profile)).toMatchObject({ url: '/api-proxy/v1/videos/public%2Fid', init: { method: 'GET', headers: { Authorization: 'Bearer mock-user-key' } } })
    expect(sdMediaAdapter.buildContent('public/id', profile)).toMatchObject({ url: '/api-proxy/v1/videos/public%2Fid/content', init: { method: 'GET', headers: { Authorization: 'Bearer mock-user-key' } } })
    expect(() => sdMediaAdapter.parseSubmit({ status: 'queued' })).toThrow(/ID/)
    expect(() => sdMediaAdapter.parseSubmit({ task_id: '', status: 'FAILED: 参考图片无效' })).toThrow(/参考图片无效/)
  })

  it.each([
    ['queued', 'queued'], ['PENDING', 'queued'], ['unknown', 'queued'],
    ['in_progress', 'running'], ['RUNNING', 'running'],
    ['completed', 'succeeded'], ['SUCCEEDED', 'succeeded'],
    ['failed', 'failed'], ['FAILED: 上游失败', 'failed'],
  ] as const)('maps %s without requiring a direct video URL', (status, expected) => {
    expect(sdMediaAdapter.parsePoll({ status, progress: 50 })).toMatchObject({ status: expected, progress: 50 })
  })

  it('uses the completed object URL and downloads it without forwarding API credentials', async () => {
    const videoUrl = 'https://cdn.example.test/result.mp4?signature=temporary'
    expect(sdMediaAdapter.parsePoll({ status: 'SUCCEEDED', object: videoUrl })).toEqual({ status: 'succeeded', videoUrl })
    const request = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })))
    vi.stubGlobal('fetch', request)
    const blob = await downloadVideoContent('remote-task', task(), videoUrl)
    expect(await blob.text()).toBe('video')
    expect(request).toHaveBeenCalledWith(videoUrl)
  })

  it('treats object video as a type marker and falls back to the authenticated content endpoint', async () => {
    expect(sdMediaAdapter.parsePoll({ status: 'SUCCEEDED', object: 'video' })).toEqual({ status: 'succeeded' })
    const request = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })))
    vi.stubGlobal('fetch', request)
    const blob = await downloadVideoContent('remote-task', task())
    expect(await blob.text()).toBe('video')
    expect(request).toHaveBeenCalledWith('/api-proxy/v1/videos/remote-task/content', {
      method: 'GET',
      headers: { Authorization: 'Bearer mock-user-key' },
    })
  })

  it('resolves relative object paths through the authenticated video proxy', async () => {
    const request = vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' })))
    vi.stubGlobal('fetch', request)
    await downloadVideoContent('remote-task', task(), '/v1/videos/remote-task/content')
    expect(request).toHaveBeenCalledWith('/api-proxy/v1/videos/remote-task/content', expect.objectContaining({
      headers: { Authorization: 'Bearer mock-user-key' },
    }))
  })

  it('rejects an HTML page returned for a video object URL', async () => {
    const request = vi.fn(async () => new Response('<!doctype html><html></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }))
    vi.stubGlobal('fetch', request)
    await expect(downloadVideoContent('remote-task', task(), 'https://cdn.example.test/result.mp4'))
      .rejects.toThrow(/不是视频文件/)
  })

  it('extracts the failure detail embedded in the uppercase status', () => {
    expect(sdMediaAdapter.parsePoll({ status: 'FAILED: 参考图片无效，请更换素材' })).toEqual({
      status: 'failed', error: '参考图片无效，请更换素材',
    })
  })

  it('retains useful Chinese failures but hides internal model IDs, URLs and credentials', () => {
    expect(sdMediaAdapter.parsePoll({ status: 'failed', error: { message: '参考图片无效，请更换素材' } }).error).toBe('参考图片无效，请更换素材')
    for (const message of ['sd-2-c4 模型失败', 'sd-2.5-c1 https://private.test/a', 'Bearer secret-key 不可用']) {
      const result = sdMediaAdapter.parsePoll({ status: 'failed', error: { message } })
      expect(result.error).not.toMatch(/sd-2|private\.test|secret-key/)
    }
  })
})
