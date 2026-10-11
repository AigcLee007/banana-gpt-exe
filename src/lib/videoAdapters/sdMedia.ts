import type { VideoAdapter, PollResult } from '../videoApi'
import type { MediaRecord, VideoApiProfileSnapshot, VideoReferenceItem, VideoReferenceType, VideoTaskRecord } from '../videoTypes'
import { getVideoModelDefinition } from '../videoModels'
import { getMedia } from '../videoDb'
import { buildVideoApiUrl } from '../videoTransport'
import { serializeVideoPrompt } from '../videoPromptMentions'
import { uploadUguuMedia } from '../uguuUpload'

type MediaRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_voice'
type Reference = VideoReferenceItem & { role: MediaRole }
const TYPES: VideoReferenceType[] = ['image', 'video', 'audio']
const NAMES = { image: '图片', video: '视频', audio: '音频' }
const ROLES: Record<VideoReferenceType, MediaRole> = { image: 'reference_image', video: 'reference_video', audio: 'reference_voice' }
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function headers(profile: VideoApiProfileSnapshot) {
  const key = profile.apiKey.trim()
  if (!key) throw new Error('请先在设置 → API 配置中填写 API Key')
  return { Authorization: `Bearer ${key}` }
}

function apiUrl(profile: VideoApiProfileSnapshot, path = '') {
  return buildVideoApiUrl(profile, `videos${path ? `/${path}` : ''}`, true)
}

function referencesFor(task: VideoTaskRecord): Reference[] {
  const { inputs, mode } = task
  if (inputs.sourceVideoId || inputs.imageUrl || inputs.imageUrls?.length) throw new Error('当前模型请使用工作台中的本地参考素材')
  const grouped: VideoReferenceItem[] = [
    ...inputs.refImageIds.map(id => ({ id, type: 'image' as const })),
    ...inputs.refVideoIds.map(id => ({ id, type: 'video' as const })),
    ...inputs.refAudioIds.map(id => ({ id, type: 'audio' as const })),
  ]
  const refs = inputs.refItems?.length ? inputs.refItems : grouped
  if (mode === 't2v') {
    if (inputs.firstFrameId || inputs.lastFrameId || refs.length || grouped.length) throw new Error('文生视频模式不能包含参考素材')
    return []
  }
  if (mode === 'i2v' || mode === 'flf2v') {
    if (refs.length || grouped.length) throw new Error('首尾帧模式不能包含隐藏参考素材')
    if (!inputs.firstFrameId) throw new Error('请添加首帧图片')
    if (mode === 'i2v' && inputs.lastFrameId) throw new Error('单图生视频不能包含隐藏尾帧')
    if (mode === 'flf2v' && !inputs.lastFrameId) throw new Error('首尾帧模式需要首帧和尾帧图片')
    const frames: Reference[] = [{ id: inputs.firstFrameId, type: 'image', role: 'first_frame' }]
    if (mode === 'flf2v') frames.push({ id: inputs.lastFrameId!, type: 'image', role: 'last_frame' })
    return frames
  }
  if (mode !== 'ref2v') throw new Error('当前模型不支持所选视频模式')
  if (inputs.firstFrameId || inputs.lastFrameId) throw new Error('参考模式不能包含隐藏首帧或尾帧，请将图片添加到参考素材')
  if (!refs.length) throw new Error('参考模式至少需要一个参考素材')
  if (refs.some(ref => !ref || typeof ref.id !== 'string' || !ref.id.trim() || !TYPES.includes(ref.type))) throw new Error('参考素材记录无效，请重新添加')
  if (new Set(refs.map(ref => `${ref.type}:${ref.id}`)).size !== refs.length) throw new Error('参考素材重复，请移除重复引用')
  if (grouped.some(ref => !refs.some(item => item.id === ref.id && item.type === ref.type))) throw new Error('参考素材列表包含隐藏引用，请重新添加')
  return refs.map(ref => ({ ...ref, role: ROLES[ref.type] }))
}

function validateTask(task: VideoTaskRecord, references: Reference[]): string {
  const def = getVideoModelDefinition(task.model)
  if (!def || def.adapter !== 'sdMedia') throw new Error('当前任务模型与 SD 素材适配器不匹配')
  const params = task.params
  if (params.resolution !== '720p') throw new Error('清晰度只能是 720p')
  if (!def.aspectRatios.includes(params.aspectRatio)) throw new Error('当前模型不支持该画面比例')
  if (params.n !== 1) throw new Error('视频数量固定为 1')
  const duration = def.duration
  if (!Number.isInteger(params.duration) || params.duration < duration.min || params.duration > duration.max) {
    throw new Error(duration.min === duration.max ? `视频时长固定为 ${duration.min} 秒` : `视频时长必须是 ${duration.min}–${duration.max} 秒的整数`)
  }
  const allowed = new Set(['duration', 'resolution', 'aspectRatio', 'audio', 'n'])
  if (params.audio !== false || Object.entries(params).some(([key, value]) => !allowed.has(key) && value !== undefined)) throw new Error('当前模型不支持音频开关、种子或其他隐藏参数')
  for (const type of TYPES) {
    const max = (type === 'image' ? def.modes.ref2v?.maxImages : type === 'video' ? def.modes.ref2v?.maxVideos : def.modes.ref2v?.maxAudios) ?? 0
    const count = references.filter(ref => ref.type === type).length
    if (count > max) throw new Error(max ? `参考${NAMES[type]}最多 ${max} 个（首尾帧计入图片总数）` : `当前模型不支持参考${NAMES[type]}`)
  }
  const prompt = serializeVideoPrompt(task.prompt, references).trim()
  if (prompt.includes('\u2063video-ref:') || prompt.includes('\u2064')) throw new Error('参考素材标签无效，请删除标签后重新添加')
  if (!prompt) throw new Error('请输入视频提示词')
  return prompt
}

async function validateFile(media: MediaRecord, type: VideoReferenceType) {
  if (![media.mime, media.blob.type].every(mime => mime.toLowerCase().startsWith(`${type}/`))) throw new Error(`参考${NAMES[type]}格式无效，请重新添加`)
  if (!Number.isFinite(media.size) || media.size <= 0 || media.blob.size <= 0 || Math.max(media.size, media.blob.size) > MAX_UPLOAD_BYTES) throw new Error(`工作台单个参考素材必须大于 0 且不超过 50 MB`)
  try { await media.blob.arrayBuffer() }
  catch { throw new Error(`参考${NAMES[type]}读取失败，请重新添加`) }
  if (type === 'image' && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(media.blob)
      if (!bitmap.width || !bitmap.height) throw new Error('Invalid image dimensions')
    } catch { throw new Error('参考图片读取失败，请重新添加可正常显示的图片') }
    finally { bitmap?.close() }
  }
}

function responseRecord(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('视频响应格式无效，请稍后重试')
  const record = response as Record<string, unknown>
  return record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? { ...record, ...record.data } : record
}

function safeFailure(value: unknown): string {
  const message = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>).message : undefined
  if (typeof message === 'string' && message.trim() && message.length <= 300 && /[一-鿿]/.test(message)
      && !/[\u0000-\u001f\u007f<>]|https?:\/\/|\b[a-z0-9-]+\.(?:com|net|org|test|se|io)\b|\bsk-|bearer|token|secret|sd-2(?:\.|-)/i.test(message)) return message.trim()
  return '视频生成失败，请检查提示词或参考素材后重试'
}

function statusValue(value: unknown): { status: PollResult['status']; error?: string } {
  if (typeof value !== 'string') return { status: 'queued' }
  const raw = value.trim()
  const [name, ...detail] = raw.split(':')
  const normalized = name.trim().toLowerCase()
  const error = detail.join(':').trim()
  if (['running', 'in_progress', 'processing'].includes(normalized)) return { status: 'running' }
  if (['succeeded', 'completed', 'success'].includes(normalized)) return { status: 'succeeded' }
  if (['failed', 'failure', 'error'].includes(normalized)) return { status: 'failed', ...(error ? { error: safeFailure(error) } : {}) }
  return { status: 'queued' }
}

function videoResultAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const address = value.trim()
  if (!address || address.toLowerCase() === 'video') return undefined
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) return address
  if (address.startsWith('/') || address.startsWith('./') || address.startsWith('../')) return address
  if (/\.(?:mp4|webm|mov)(?:[?#].*)?$/i.test(address)) return address
  return undefined
}

export const sdMediaAdapter: VideoAdapter = {
  redactServiceErrors: true,
  async buildSubmit({ task, profile, signal }) {
    signal?.throwIfAborted()
    const authorization = headers(profile)
    const references = referencesFor(task)
    const prompt = validateTask(task, references)
    const localMedia = await Promise.all(references.map(async ref => {
      signal?.throwIfAborted()
      const media = await getMedia(ref.id)
      signal?.throwIfAborted()
      if (!media) throw new Error(`参考${NAMES[ref.type]}不存在，请重新添加素材`)
      await validateFile(media, ref.type)
      return { ref, media }
    }))
    signal?.throwIfAborted()
    const media: { type: MediaRole; url: string }[] = []
    for (const item of localMedia) {
      signal?.throwIfAborted()
      const url = await uploadUguuMedia(item.media, signal)
      signal?.throwIfAborted()
      media.push({ type: item.ref.role, url })
    }
    return {
      url: apiUrl(profile),
      init: { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: task.model,
        prompt,
        seconds: String(task.params.duration),
        resolution: '720p',
        aspect_ratio: task.params.aspectRatio,
        ...(media.length ? { media } : {}),
      }) },
    }
  },
  parseSubmit(response) {
    const record = responseRecord(response)
    const parsedStatus = statusValue(record.status)
    if (parsedStatus.status === 'failed' || record.error) throw new Error(parsedStatus.error || safeFailure(record.error))
    const taskId = [record.id, record.task_id].find(value => typeof value === 'string' && value.trim())
    if (typeof taskId !== 'string') throw new Error('视频创建响应缺少任务 ID')
    return { taskId: taskId.trim(), status: parsedStatus.status === 'running' ? 'running' : 'queued' }
  },
  buildPoll(taskId, profile) {
    return { url: apiUrl(profile, encodeURIComponent(taskId)), init: { method: 'GET', headers: headers(profile) } }
  },
  parsePoll(response) {
    const record = responseRecord(response)
    const parsedStatus = statusValue(record.status)
    const status = parsedStatus.status
    const progress = typeof record.progress === 'number' && Number.isFinite(record.progress) ? Math.min(100, Math.max(0, record.progress)) : undefined
    const videoUrl = videoResultAddress(record.object)
    return {
      status,
      ...(progress !== undefined ? { progress } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(status === 'failed' ? { error: parsedStatus.error || safeFailure(record.error) } : {}),
    }
  },
  buildContent(taskId, profile) {
    return { url: apiUrl(profile, `${encodeURIComponent(taskId)}/content`), init: { method: 'GET', headers: headers(profile) } }
  },
}
