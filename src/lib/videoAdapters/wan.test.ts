import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaRecord, VideoTaskRecord } from '../videoTypes'
import { encodeVideoMention } from '../videoPromptMentions'

vi.mock('../videoDb', () => ({ getMedia: vi.fn() }))
import { getMedia } from '../videoDb'
import { wanAdapter } from './wan'

const profile = { profileId: 'profile-1', baseUrl: 'https://vip.example.test/v1', apiKey: 'mock-video-key', apiProxy: false }
const emptyInputs = () => ({ refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] })

function task(overrides: Partial<VideoTaskRecord> = {}): VideoTaskRecord {
  return { id: 'local-task', prompt: 'Sea at dawn', model: 'wan3.0-video-720p', mode: 't2v', params: { duration: 8, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 }, inputs: emptyInputs(), adapter: 'wan' as VideoTaskRecord['adapter'], status: 'queued', error: null, createdAt: 0, finishedAt: null, elapsed: null, apiProfile: profile, ...overrides }
}

function u32(value: number) { const data = new Uint8Array(4); new DataView(data.buffer).setUint32(0, value); return data }
function join(...parts: Uint8Array[]) { const data = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { data.set(part, offset); offset += part.length } return data }
function atom(type: string, payload: Uint8Array) { return join(u32(payload.length + 8), new TextEncoder().encode(type), payload) }
function videoBlob(fps = 30) {
  const mdhd = new Uint8Array(24); new DataView(mdhd.buffer).setUint32(12, fps * 1000)
  const hdlr = join(new Uint8Array(8), new TextEncoder().encode('vide'), new Uint8Array(12))
  const stts = join(new Uint8Array(4), u32(1), u32(fps * 4), u32(1000))
  return new Blob([atom('moov', atom('trak', atom('mdia', join(atom('mdhd', mdhd), atom('hdlr', hdlr), atom('minf', atom('stbl', atom('stts', stts)))))))], { type: 'video/mp4' })
}

function media(id: string, type: 'image' | 'video' | 'audio' = 'image', overrides: Partial<MediaRecord> = {}): MediaRecord {
  const mime = { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }[type]
  const blob = type === 'video' ? videoBlob() : new Blob(['media'], { type: mime })
  return { id, blob, mime, size: blob.size, duration: type === 'image' ? undefined : 4, source: 'upload', uploadedAt: 0, ...overrides }
}

let records: Map<string, MediaRecord>
beforeEach(() => {
  records = new Map()
  vi.mocked(getMedia).mockImplementation(async (id) => records.get(id))
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const file = (init?.body as FormData).get('files[]') as File
    return new Response(JSON.stringify({ success: true, files: [{ hash: 'hash', filename: file.name, url: `https://n.uguu.se/${records.size}-${vi.mocked(fetch).mock.calls.length}.media`, size: file.size, dupe: false }] }))
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function add(...items: MediaRecord[]) { for (const item of items) records.set(item.id, item) }
function refTask(imageIds: string[] = [], videoIds: string[] = [], audioIds: string[] = []): VideoTaskRecord {
  return task({ mode: 'ref2v', inputs: { refImageIds: imageIds, refVideoIds: videoIds, refAudioIds: audioIds } })
}

async function body(selected = task()) { const spec = await wanAdapter.buildSubmit({ task: selected, profile }); return JSON.parse(String(spec.init.body)) }
async function rejectsBeforeUpload(selected: VideoTaskRecord, match: string | RegExp) {
  await expect(wanAdapter.buildSubmit({ task: selected, profile })).rejects.toThrow(match)
  expect(fetch).not.toHaveBeenCalled()
}

describe('wanAdapter', () => {
  it('builds the strict authenticated Wan text JSON specification', async () => {
    const spec = await wanAdapter.buildSubmit({ task: task(), profile })
    expect(spec.url).toBe('/api-proxy/v1/videos')
    expect(spec.init.method).toBe('POST')
    expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-video-key')
    expect(new Headers(spec.init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(spec.init.body))).toEqual({ model: 'wan3.0-video-720p', prompt: 'Sea at dawn', aspect_ratio: '16:9', resolution: '720p', seconds: '8' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'])('accepts %s ratio', async (aspectRatio) => {
    expect((await body(task({ params: { ...task().params, aspectRatio } }))).aspect_ratio).toBe(aspectRatio)
  })

  it.each([4, 30])('accepts the text duration boundary %s', async (duration) => {
    expect((await body(task({ params: { ...task().params, duration } }))).seconds).toBe(String(duration))
  })

  it.each([
    ['model', { model: 'other-model' }, /模型/],
    ['prompt', { prompt: ' \n ' }, /提示词/],
    ['resolution', { params: { ...task().params, resolution: '1080p' } }, /720p/],
    ['ratio', { params: { ...task().params, aspectRatio: '2:1' } }, /比例/],
    ['quantity', { params: { ...task().params, n: 2 } }, /数量/],
    ['duration below minimum', { params: { ...task().params, duration: 3 } }, /4.*30/],
    ['duration above maximum', { params: { ...task().params, duration: 31 } }, /4.*30/],
    ['fractional duration', { params: { ...task().params, duration: 4.5 } }, /整数/],
    ['nonfinite duration', { params: { ...task().params, duration: NaN } }, /整数/],
    ['seed', { params: { ...task().params, seed: 4 } }, /不支持/],
    ['negative prompt', { params: { ...task().params, negativePrompt: 'blur' } }, /不支持/],
    ['audio toggle', { params: { ...task().params, audio: true } }, /不支持/],
    ['camera toggle', { params: { ...task().params, cameraFixed: false } }, /不支持/],
    ['tail mode', { mode: 'flf2v' }, /不支持/],
    ['tail id', { inputs: { ...emptyInputs(), lastFrameId: 'tail' } }, /尾帧/],
    ['source video', { inputs: { ...emptyInputs(), sourceVideoId: 'old-output' } }, /不支持/],
    ['remote image', { inputs: { ...emptyInputs(), imageUrl: 'https://example.test/a.png' } }, /本地/],
  ] as Array<[string, Partial<VideoTaskRecord>, RegExp]>)('rejects unsupported %s before any upload', async (_name, overrides, match) => {
    await rejectsBeforeUpload(task(overrides), match)
  })

  it('rejects missing video API keys before uploading references', async () => {
    add(media('image'))
    await expect(wanAdapter.buildSubmit({ task: task({ mode: 'i2v', inputs: { ...emptyInputs(), firstFrameId: 'image' } }), profile: { ...profile, apiKey: ' ' } })).rejects.toThrow(/API Key/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uploads one first frame as image_url and numbers its encoded mention', async () => {
    add(media('first'))
    const prompt = `保持 ${encodeVideoMention({ id: 'first', type: 'image', label: '旧名称99' })} 的人物，普通图片1文字保留`
    const spec = await wanAdapter.buildSubmit({ task: task({ mode: 'i2v', prompt, inputs: { ...emptyInputs(), firstFrameId: 'first' } }), profile })
    expect(JSON.parse(String(spec.init.body))).toEqual({ model: 'wan3.0-video-720p', prompt: '保持 @image1 的人物，普通图片1文字保留', aspect_ratio: '16:9', resolution: '720p', seconds: '8', image_url: 'https://n.uguu.se/1-1.media' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/media-upload/uguu')
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('Authorization')).toBeNull()
    expect(getMedia).toHaveBeenCalledWith('first')
  })

  it('preserves per-type UI order and maps mixed mentions by id/type', async () => {
    add(media('i1'), media('i2'), media('v1', 'video'), media('a1', 'audio'))
    const selected = refTask(['i1', 'i2'], ['v1'], ['a1'])
    selected.inputs.refItems = [{ id: 'a1', type: 'audio' }, { id: 'i2', type: 'image' }, { id: 'v1', type: 'video' }, { id: 'i1', type: 'image' }]
    selected.prompt = ['i1', 'v1', 'a1', 'i2'].map((id) => encodeVideoMention({ id, type: id[0] === 'i' ? 'image' : id[0] === 'v' ? 'video' : 'audio', label: 'stale label' })).join(' / ')
    const payload = await body(selected)
    expect(payload.prompt).toBe('@image2 / @video1 / @audio1 / @image1')
    expect(payload.image_url).toBe('https://n.uguu.se/4-1.media')
    expect(payload.reference_image_urls).toEqual(['https://n.uguu.se/4-2.media'])
    expect(payload.reference_videos).toEqual(['https://n.uguu.se/4-3.media'])
    expect(payload.audio_urls).toEqual(['https://n.uguu.se/4-4.media'])
    expect(getMedia).toHaveBeenNthCalledWith(1, 'a1')
    expect(Object.keys(payload).sort()).toEqual(['model', 'prompt', 'aspect_ratio', 'resolution', 'seconds', 'image_url', 'reference_image_urls', 'reference_videos', 'audio_urls'].sort())
  })

  it('falls back to grouped reference arrays and reuploads for each new generation', async () => {
    add(media('second'), media('first'))
    const selected = refTask(['second', 'first'])
    expect((await body(selected)).reference_image_urls).toEqual(['https://n.uguu.se/2-2.media'])
    await body(selected)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('rejects mode-specific hidden references', async () => {
    await rejectsBeforeUpload(task({ inputs: { ...emptyInputs(), firstFrameId: 'hidden' } }), /文生视频/)
    await rejectsBeforeUpload(task({ mode: 'i2v' }), /1.*图片/)
    await rejectsBeforeUpload(task({ mode: 'i2v', inputs: { ...emptyInputs(), firstFrameId: 'first', refImageIds: ['hidden'] } }), /1.*图片|隐藏|不支持/)
    await rejectsBeforeUpload(refTask(), /至少/)
    await rejectsBeforeUpload(task({ mode: 'ref2v', inputs: { ...emptyInputs(), firstFrameId: 'hidden', refImageIds: ['image'] } }), /首帧|隐藏/)
    await rejectsBeforeUpload(refTask([], [], ['audio']), /音频.*图片|音频.*视频/)
  })

  it('validates missing, malformed, stale and wrong-type mentions before uploads', async () => {
    add(media('image'))
    const selected = refTask(['image'])
    selected.prompt = encodeVideoMention({ id: 'missing', type: 'image', label: 'removed' })
    await rejectsBeforeUpload(selected, /已移除|引用/)
    selected.prompt = encodeVideoMention({ id: 'image', type: 'video', label: 'wrong type' })
    await rejectsBeforeUpload(selected, /引用/)
    selected.prompt = '\u2063video-ref:%invalid\u2064'
    await rejectsBeforeUpload(selected, /标签/)
    selected.prompt = '\u2063video-ref:unterminated'
    await rejectsBeforeUpload(selected, /标签/)
    selected.prompt = '参考 @image2'
    await rejectsBeforeUpload(selected, /引用|编号/)
    selected.prompt = '参考 @video1'
    await rejectsBeforeUpload(selected, /引用|编号/)
  })

  it('loads and validates every local media record before the first upload', async () => {
    add(media('image'), media('bad-video', 'video', { duration: undefined }))
    await rejectsBeforeUpload(refTask(['image'], ['bad-video']), /视频.*时长/)
    expect(getMedia).toHaveBeenCalledWith('image')
    expect(getMedia).toHaveBeenCalledWith('bad-video')
  })

  it('rejects image bytes that the browser cannot decode before upload', async () => {
    add(media('first'), media('bad'))
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      if (blob === records.get('bad')?.blob) throw new Error('invalid image content')
      return { width: 32, height: 32, close: vi.fn() }
    }))
    await rejectsBeforeUpload(refTask(['first', 'bad']), /图片.*读取/)
  })

  it('releases decoded image resources and accepts a readable local image', async () => {
    add(media('image'))
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 32, height: 32, close })))
    expect((await body(refTask(['image']))).image_url).toMatch(/^https:\/\/n\.uguu\.se\//)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects unreadable local image blobs before upload', async () => {
    const unreadable = media('bad')
    unreadable.blob.arrayBuffer = async () => { throw new Error('read failed') }
    add(unreadable)
    await rejectsBeforeUpload(refTask(['bad']), /图片.*读取/)
  })

  it('rejects duplicate and unsynchronized references before upload', async () => {
    await rejectsBeforeUpload(refTask(['one', 'one']), /重复/)
    const selected = refTask(['one', 'hidden'])
    selected.inputs.refItems = [{ id: 'one', type: 'image' }]
    await rejectsBeforeUpload(selected, /隐藏/)
  })

  it.each([24, 60])('accepts %s FPS at the reference video boundary', async (fps) => {
    add(media('video', 'video', { blob: videoBlob(fps) }))
    expect((await body(refTask([], ['video']))).reference_videos).toHaveLength(1)
  })

  it('accepts MOV and WAV references based on their actual local MIME', async () => {
    const movie = videoBlob()
    add(media('movie', 'video', { mime: 'video/quicktime', blob: new Blob([movie], { type: 'video/quicktime' }) }))
    add(media('sound', 'audio', { mime: 'audio/wav', blob: new Blob(['wav'], { type: 'audio/wav' }) }))
    const payload = await body(refTask([], ['movie'], ['sound']))
    expect(payload.reference_videos).toHaveLength(1)
    expect(payload.audio_urls).toHaveLength(1)
    expect(payload).not.toHaveProperty('audio')
  })

  it('accepts the maximum 20-reference mix within each media duration limit', async () => {
    const images = Array.from({ length: 10 }, (_, i) => `i${i}`)
    const videos = Array.from({ length: 5 }, (_, i) => `v${i}`)
    const audios = Array.from({ length: 5 }, (_, i) => `a${i}`)
    add(...images.map((id) => media(id)), ...videos.map((id) => media(id, 'video', { duration: 3 })), ...audios.map((id) => media(id, 'audio', { duration: 3 })))
    const payload = await body(refTask(images, videos, audios))
    expect(payload.reference_image_urls).toHaveLength(9)
    expect(payload.reference_videos).toHaveLength(5)
    expect(payload.audio_urls).toHaveLength(5)
    expect(fetch).toHaveBeenCalledTimes(20)
  })

  it.each([
    ['missing image', 'image', undefined, /图片.*不存在/],
    ['image MIME', 'image', { mime: 'text/plain' }, /图片.*格式|图片.*MIME/],
    ['image Blob MIME', 'image', { blob: new Blob(['x'], { type: 'video/mp4' }) }, /图片.*格式|图片.*MIME/],
    ['image size', 'image', { size: 30 * 1024 ** 2 + 1 }, /30/],
    ['video size', 'video', { size: 50 * 1024 ** 2 + 1 }, /50/],
    ['video MIME', 'video', { mime: 'video/webm', blob: new Blob(['x'], { type: 'video/webm' }) }, /MP4.*MOV/],
    ['video missing duration', 'video', { duration: undefined }, /视频.*时长/],
    ['video nonfinite duration', 'video', { duration: Infinity }, /视频.*时长/],
    ['video short duration', 'video', { duration: 1.9 }, /2.*15/],
    ['video long duration', 'video', { duration: 15.1 }, /2.*15/],
    ['video low FPS', 'video', { blob: videoBlob(23) }, /24.*60/],
    ['video high FPS', 'video', { blob: videoBlob(61) }, /24.*60/],
    ['video missing FPS', 'video', { blob: new Blob(['invalid'], { type: 'video/mp4' }) }, /帧率/],
    ['audio size', 'audio', { size: 15 * 1024 ** 2 + 1 }, /15/],
    ['audio MIME', 'audio', { mime: 'audio/ogg', blob: new Blob(['x'], { type: 'audio/ogg' }) }, /MP3.*WAV/],
    ['audio missing duration', 'audio', { duration: undefined }, /音频.*时长/],
    ['audio nonfinite duration', 'audio', { duration: NaN }, /音频.*时长/],
    ['audio short duration', 'audio', { duration: 1 }, /2.*15/],
    ['audio long duration', 'audio', { duration: 16 }, /2.*15/],
  ] as Array<[string, 'image' | 'video' | 'audio', Partial<MediaRecord> | undefined, RegExp]>)('rejects %s before external uploads', async (_name, type, overrides, match) => {
    add(media('good-image'))
    if (overrides) add(media('bad', type, overrides))
    const selected = refTask(type === 'image' ? ['good-image', 'bad'] : ['good-image'], type === 'video' ? ['bad'] : [], type === 'audio' ? ['bad'] : [])
    await rejectsBeforeUpload(selected, match)
  })

  it('rejects media counts before loading or uploading them', async () => {
    await rejectsBeforeUpload(refTask(Array.from({ length: 11 }, (_, i) => `i${i}`)), /10/)
    await rejectsBeforeUpload(refTask([], Array.from({ length: 6 }, (_, i) => `v${i}`)), /5/)
    await rejectsBeforeUpload(refTask(['image'], [], Array.from({ length: 6 }, (_, i) => `a${i}`)), /5/)
    expect(getMedia).not.toHaveBeenCalled()
  })

  it('rejects total reference media duration before uploads', async () => {
    add(media('image'), media('v1', 'video', { duration: 8 }), media('v2', 'video', { duration: 8 }))
    await rejectsBeforeUpload(refTask([], ['v1', 'v2']), /视频.*总时长.*15/)
    add(media('a1', 'audio', { duration: 8 }), media('a2', 'audio', { duration: 8 }))
    await rejectsBeforeUpload(refTask(['image'], [], ['a1', 'a2']), /音频.*总时长.*15/)
  })

  it('limits output with a video reference to 15 seconds', async () => {
    add(media('video', 'video'))
    const selected = refTask([], ['video'])
    selected.params.duration = 16
    await rejectsBeforeUpload(selected, /4.*15/)
    selected.params.duration = 15
    expect((await body(selected)).seconds).toBe('15')
  })

  it('stops before any video POST if an upload fails', async () => {
    add(media('one'), media('two'))
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: 'private details' })))
    await expect(wanAdapter.buildSubmit({ task: refTask(['one', 'two']), profile })).rejects.toThrow(/素材上传.*失败/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/media-upload/uguu')
  })

  it('skips local reads and uploads when the task was canceled', async () => {
    add(media('image'))
    const controller = new AbortController()
    controller.abort()
    await expect(wanAdapter.buildSubmit({ task: refTask(['image']), profile, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(getMedia).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops before uploads when canceled during local metadata validation', async () => {
    const controller = new AbortController()
    const selected = media('image')
    selected.blob.arrayBuffer = async () => { controller.abort(); return new ArrayBuffer(5) }
    add(selected)
    await expect(wanAdapter.buildSubmit({ task: refTask(['image']), profile, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops the active upload and does not upload the next reference after cancellation', async () => {
    add(media('one'), media('two'))
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      controller.abort()
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Response(JSON.stringify({ success: true, files: [{ url: 'https://n.uguu.se/a.png' }] }))
    })
    await expect(wanAdapter.buildSubmit({ task: refTask(['one', 'two']), profile, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('builds only authenticated query and content endpoints', () => {
    for (const [spec, path] of [[wanAdapter.buildPoll('task/a', profile), 'task%2Fa'], [wanAdapter.buildContent('task/a', profile), 'task%2Fa/content']] as const) {
      expect(spec.url).toBe(`/api-proxy/v1/videos/${path}`)
      expect(spec.init.method).toBe('GET')
      expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer mock-video-key')
    }
    expect(() => wanAdapter.buildPoll('a', { ...profile, apiKey: '' })).toThrow(/API Key/)
    expect(() => wanAdapter.buildContent('a', { ...profile, apiKey: '' })).toThrow(/API Key/)
  })

  it('parses documented ids and status without inferring success from progress', () => {
    expect(wanAdapter.parseSubmit({ id: 'task-1', status: 'queued' })).toEqual({ taskId: 'task-1', status: 'queued' })
    expect(wanAdapter.parseSubmit({ id: 'task-2', status: 'in_progress' })).toEqual({ taskId: 'task-2', status: 'running' })
    expect(wanAdapter.parseSubmit({ data: { id: 'task-3' } })).toEqual({ taskId: 'task-3', status: 'queued' })
    expect(() => wanAdapter.parseSubmit({ id: ' ' })).toThrow(/任务 ID/)
    expect(wanAdapter.parsePoll({ status: 'queued', progress: 100 })).toMatchObject({ status: 'queued', progress: 100 })
    expect(wanAdapter.parsePoll({ status: 'in_progress', progress: 55 })).toMatchObject({ status: 'running', progress: 55 })
    expect(wanAdapter.parsePoll({ status: 'completed', progress: 100, video_url: 'https://private.test/content' })).toMatchObject({ status: 'succeeded', progress: 100 })
    expect(wanAdapter.parsePoll({ data: { status: 'completed', progress: 100 } })).toMatchObject({ status: 'succeeded' })
    expect(wanAdapter.parsePoll({ status: 'unknown', progress: 100 })).toEqual({ status: 'queued', progress: 100 })
  })

  it('uses safe localized error.message for failed tasks', () => {
    expect(wanAdapter.parsePoll({ status: 'failed', error: { code: 'video_generation_failed', message: '视频生成失败，请调整提示词或参考素材后重试。' } })).toMatchObject({ status: 'failed', error: '视频生成失败，请调整提示词或参考素材后重试。' })
    expect(wanAdapter.parsePoll({ status: 'failed', error: { message: 'private.provider.test sk-secret' } })).toMatchObject({ status: 'failed', error: '视频生成失败，请调整提示词或参考素材后重试' })
    expect(wanAdapter.parsePoll({ status: 'failed', error: { message: '内部接口 https://private.example/token 无法连接' } })).toMatchObject({ status: 'failed', error: '视频生成失败，请调整提示词或参考素材后重试' })
  })

  it('keeps malformed query responses recoverable without the permanent-error keyword', () => {
    for (const response of [null, {}, { status: 'new-state' }, { data: {} }]) {
      try { wanAdapter.parsePoll(response); throw new Error('expected query rejection') }
      catch (error) {
        expect((error as Error).message).toBe('暂时无法确认视频任务状态，请稍后重试')
        expect((error as Error).message).not.toContain('未知状态')
      }
    }
  })
})
