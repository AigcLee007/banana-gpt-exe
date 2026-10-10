import type { VideoAdapter, PollResult } from '../videoApi'
import type { MediaRecord, VideoApiProfileSnapshot, VideoReferenceItem, VideoReferenceType, VideoTaskRecord } from '../videoTypes'
import { getMedia } from '../videoDb'
import { buildVideoApiUrl } from '../videoTransport'
import { labelVideoReferences, parseVideoPrompt } from '../videoPromptMentions'
import { uploadUguuMedia } from '../uguuUpload'
import { getVideoFrameRate } from '../videoFrameRate'

const MODEL = 'wan3.0-video-720p'
const TYPE_NAMES = { image: '图片', video: '视频', audio: '音频' } as const
const TYPES: VideoReferenceType[] = ['image', 'video', 'audio']
const MAX_COUNTS = { image: 10, video: 5, audio: 5 }
const MAX_MIB = { image: 30, video: 50, audio: 15 }
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime'])
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])

function authHeaders(profile: VideoApiProfileSnapshot) {
  const key = profile.apiKey.trim()
  if (!key) throw new Error('请先在设置 → API 配置中填写 API Key')
  return { Authorization: `Bearer ${key}` }
}

function apiUrl(profile: VideoApiProfileSnapshot, path = '') {
  return buildVideoApiUrl(profile, `videos${path ? `/${path}` : ''}`, true)
}

function referenceItems(task: VideoTaskRecord): VideoReferenceItem[] {
  const { mode, inputs } = task
  if (mode === 'flf2v' || inputs.lastFrameId) throw new Error('Wan 不支持首尾帧模式或尾帧')
  if (inputs.sourceVideoId) throw new Error('Wan 不支持来源视频 ID，请将视频作为本地参考素材添加')
  if (inputs.imageUrl || inputs.imageUrls?.length) throw new Error('Wan 参考素材请使用本地文件选择')
  if (!['t2v', 'i2v', 'ref2v'].includes(mode)) throw new Error('Wan 不支持所选视频模式')
  const grouped = [
    ...inputs.refImageIds.map((id) => ({ id, type: 'image' as const })),
    ...inputs.refVideoIds.map((id) => ({ id, type: 'video' as const })),
    ...inputs.refAudioIds.map((id) => ({ id, type: 'audio' as const })),
  ]
  const refs = inputs.refItems?.length ? inputs.refItems : grouped
  if (mode === 't2v') {
    if (inputs.firstFrameId || grouped.length || refs.length) throw new Error('文生视频模式不能包含参考素材')
    return []
  }
  if (mode === 'i2v') {
    if (!inputs.firstFrameId || grouped.length || refs.length) throw new Error('单图生视频需要且只能提供 1 张首帧图片，不支持隐藏参考素材')
    return [{ id: inputs.firstFrameId, type: 'image' }]
  }
  if (inputs.firstFrameId) throw new Error('参考生视频不能包含隐藏首帧，请将图片添加到参考素材')
  if (!refs.length) throw new Error('参考生视频至少需要 1 个参考素材')
  for (const ref of refs) {
    if (!ref || typeof ref.id !== 'string' || !ref.id.trim() || !TYPES.includes(ref.type)) throw new Error('参考素材记录无效，请重新添加')
  }
  if (new Set(refs.map((ref) => `${ref.type}:${ref.id}`)).size !== refs.length) throw new Error('参考素材重复，请移除重复引用')
  if (inputs.refItems?.length && grouped.some((ref) => !refs.some((item) => item.id === ref.id && item.type === ref.type))) {
    throw new Error('参考素材列表包含隐藏引用，请重新添加素材')
  }
  return refs
}

function validateParams(task: VideoTaskRecord, references: VideoReferenceItem[]) {
  const { params } = task
  if (task.model !== MODEL) throw new Error(`Wan 模型必须为 ${MODEL}`)
  if (params.resolution !== '720p') throw new Error('Wan 清晰度只能是 720p')
  if (!['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'].includes(params.aspectRatio)) throw new Error('Wan 画面比例不受支持')
  if (params.n !== 1) throw new Error('Wan 视频数量固定为 1')
  const maxSeconds = references.some((ref) => ref.type === 'video') ? 15 : 30
  if (!Number.isInteger(params.duration) || params.duration < 4 || params.duration > maxSeconds) throw new Error(`Wan 输出时长必须是 4–${maxSeconds} 秒的整数`)
  const supported = new Set(['duration', 'resolution', 'aspectRatio', 'audio', 'n'])
  if (params.audio !== false || Object.entries(params).some(([key, value]) => !supported.has(key) && value !== undefined)) {
    throw new Error('Wan 不支持生成音频开关、种子或其他隐藏参数，请重新选择参数')
  }
  for (const type of TYPES) {
    if (references.filter((ref) => ref.type === type).length > MAX_COUNTS[type]) throw new Error(`参考${TYPE_NAMES[type]}最多 ${MAX_COUNTS[type]} 个`)
  }
  if (references.length > 20) throw new Error('参考素材合计最多 20 个')
  if (references.some((ref) => ref.type === 'audio') && !references.some((ref) => ref.type === 'image' || ref.type === 'video')) {
    throw new Error('参考音频必须搭配至少一张图片或一个视频')
  }
}

function serializePrompt(prompt: string, references: VideoReferenceItem[]): string {
  const labels = labelVideoReferences(references)
  const serialized = parseVideoPrompt(prompt).map((part) => {
    if (part.kind === 'text') {
      if (part.text.includes('\u2063video-ref:') || part.text.includes('\u2064')) throw new Error('参考素材标签无效，请删除标签后重新添加')
      return part.text
    }
    const ref = labels.find((item) => item.id === part.mention.id && item.type === part.mention.type)
    if (!ref) throw new Error('引用的参考素材已移除，请删除标签或重新添加素材')
    return `@${ref.type}${ref.typeOrdinal}`
  }).join('').trim()
  if (!serialized) throw new Error('请输入视频提示词')
  for (const match of serialized.matchAll(/@(image|video|audio)(\d+)\b/g)) {
    const type = match[1] as VideoReferenceType
    const ordinal = Number(match[2])
    if (ordinal < 1 || ordinal > references.filter((ref) => ref.type === type).length) throw new Error('提示词引用的素材编号不存在，请检查参考素材')
  }
  return serialized
}

async function validateMedia(media: MediaRecord, type: VideoReferenceType) {
  const name = TYPE_NAMES[type]
  const recordedMime = media.mime.toLowerCase()
  const blobMime = media.blob.type.toLowerCase()
  const validMime = (mime: string) => type === 'image' ? /^image\/[a-z0-9.+-]+$/i.test(mime) : (type === 'video' ? VIDEO_MIMES : AUDIO_MIMES).has(mime)
  if (!validMime(recordedMime) || !validMime(blobMime)) {
    throw new Error(type === 'image' ? '参考图片格式或 MIME 无效，请重新添加图片' : `参考${name}格式必须为 ${type === 'video' ? 'MP4/MOV' : 'MP3/WAV'}`)
  }
  if (!Number.isFinite(media.size) || media.size <= 0 || media.blob.size <= 0 || Math.max(media.size, media.blob.size) > MAX_MIB[type] * 1024 ** 2) {
    throw new Error(`参考${name}大小必须大于 0 且不超过 ${MAX_MIB[type]} MB`)
  }
  if (type !== 'image' && (typeof media.duration !== 'number' || !Number.isFinite(media.duration) || media.duration < 2 || media.duration > 15)) {
    throw new Error(`参考${name}时长必须是 2–15 秒，请重新添加可读取时长的素材`)
  }
  if (type === 'video') {
    const rate = await getVideoFrameRate(media.blob)
    if (rate === undefined || rate < 24 || rate > 60) throw new Error('参考视频帧率必须是 24–60 FPS，请重新添加可读取帧率的 MP4/MOV 视频')
  } else {
    try { await media.blob.arrayBuffer() }
    catch { throw new Error(`参考${name}读取失败，请重新添加素材`) }
    if (type === 'image' && typeof createImageBitmap === 'function') {
      let image: ImageBitmap | undefined
      try {
        image = await createImageBitmap(media.blob)
        if (!image.width || !image.height) throw new Error('invalid image dimensions')
      } catch { throw new Error('参考图片读取失败，请重新添加可正常显示的图片') }
      finally { image?.close() }
    }
  }
}

function responseRecords(response: unknown): Record<string, unknown>[] {
  if (!response || typeof response !== 'object') return []
  const record = response as Record<string, unknown>
  return record.data && typeof record.data === 'object' ? [record, record.data as Record<string, unknown>] : [record]
}

function pollStatus(records: Record<string, unknown>[]): PollResult['status'] {
  const status = records.find((record) => typeof record.status === 'string')?.status
  if (status === 'queued' || status === 'unknown') return 'queued'
  if (status === 'in_progress') return 'running'
  if (status === 'completed') return 'succeeded'
  if (status === 'failed') return 'failed'
  throw new Error('暂时无法确认视频任务状态，请稍后重试')
}

function safeFailure(records: Record<string, unknown>[]): string {
  for (const record of records) {
    const error = record.error
    const message = error && typeof error === 'object' ? (error as Record<string, unknown>).message : undefined
    if (typeof message === 'string' && message.trim() && message.length <= 300 && /[一-鿿]/.test(message) && !/[\u0000-\u001f\u007f<>]|https?:\/\/|\b[a-z0-9-]+\.(?:com|net|org|test|se|io)\b|\bsk-|bearer|cookie|token|secret/i.test(message)) return message.trim()
  }
  return '视频生成失败，请调整提示词或参考素材后重试'
}

export const wanAdapter: VideoAdapter = {
  redactServiceErrors: true,
  async buildSubmit({ task, profile, signal }) {
    signal?.throwIfAborted()
    const headers = authHeaders(profile)
    const references = referenceItems(task)
    validateParams(task, references)
    const prompt = serializePrompt(task.prompt, references)
    const mediaItems = await Promise.all(references.map(async (ref) => {
      signal?.throwIfAborted()
      const media = await getMedia(ref.id)
      signal?.throwIfAborted()
      if (!media) throw new Error(`参考${TYPE_NAMES[ref.type]}不存在，请重新添加素材`)
      return { ref, media }
    }))
    signal?.throwIfAborted()
    await Promise.all(mediaItems.map(({ ref, media }) => validateMedia(media, ref.type)))
    signal?.throwIfAborted()
    for (const type of ['video', 'audio'] as const) {
      const total = mediaItems.filter(({ ref }) => ref.type === type).reduce((sum, { media }) => sum + media.duration!, 0)
      if (total > 15) throw new Error(`参考${TYPE_NAMES[type]}总时长不能超过 15 秒`)
    }
    const urls: Record<VideoReferenceType, string[]> = { image: [], video: [], audio: [] }
    // Sequential uploads stop at the first failure, after every local validation has passed.
    for (const type of TYPES) {
      for (const { media } of mediaItems.filter(({ ref }) => ref.type === type)) {
        signal?.throwIfAborted()
        urls[type].push(await uploadUguuMedia(media, signal))
        signal?.throwIfAborted()
      }
    }
    const body = {
      model: MODEL, prompt, aspect_ratio: task.params.aspectRatio, resolution: '720p', seconds: String(task.params.duration),
      ...(urls.image.length ? { image_url: urls.image[0] } : {}),
      ...(urls.image.length > 1 ? { reference_image_urls: urls.image.slice(1) } : {}),
      ...(urls.video.length ? { reference_videos: urls.video } : {}),
      ...(urls.audio.length ? { audio_urls: urls.audio } : {}),
    }
    return { url: apiUrl(profile), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
  },
  parseSubmit(response) {
    const records = responseRecords(response)
    const id = records.map((record) => record.id).find((value) => typeof value === 'string' && value.trim())
    if (typeof id !== 'string') throw new Error('视频创建响应缺少任务 ID')
    return { taskId: id.trim(), status: records.some((record) => record.status === 'in_progress') ? 'running' : 'queued' }
  },
  buildPoll(taskId, profile) {
    return { url: apiUrl(profile, encodeURIComponent(taskId)), init: { method: 'GET', headers: authHeaders(profile) } }
  },
  parsePoll(response) {
    const records = responseRecords(response)
    const status = pollStatus(records)
    const progress = records.map((record) => record.progress).find((value) => typeof value === 'number' && Number.isFinite(value))
    return { status, ...(typeof progress === 'number' ? { progress } : {}), ...(status === 'failed' ? { error: safeFailure(records) } : {}) }
  },
  buildContent(taskId, profile) {
    return { url: apiUrl(profile, `${encodeURIComponent(taskId)}/content`), init: { method: 'GET', headers: authHeaders(profile) } }
  },
}
