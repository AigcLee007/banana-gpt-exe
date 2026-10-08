import type { VideoAdapter, PollResult } from '../videoApi'
import type { VideoApiProfileSnapshot, VideoReferenceItem, VideoTaskRecord } from '../videoTypes'
import { getMedia } from '../videoDb'
import { buildVideoApiUrl } from '../videoTransport'
import { serializeVideoPrompt } from '../videoPromptMentions'

const MODELS = { 'sd2.0-15s': 15, 'sd2.5-30s': 30 } as const
const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const MAX_REFERENCE_IMAGES = 30
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

function proxyUrl(profile: VideoApiProfileSnapshot, path = '') {
  return buildVideoApiUrl(profile, `videos${path ? `/${path}` : ''}`, true)
}

function authHeaders(profile: VideoApiProfileSnapshot) {
  const key = profile.apiKey.trim()
  if (!key) throw new Error('请先在设置 → API 配置中填写 API Key')
  return { Authorization: `Bearer ${key}` }
}

function modelDuration(model: string): number {
  if (Object.prototype.hasOwnProperty.call(MODELS, model)) return MODELS[model as keyof typeof MODELS]
  throw new Error('当前任务模型与 SD 视频适配器不匹配')
}

function dataUrlBytes(value: string): number | null {
  const prefix = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,/i)
  if (!prefix) return null
  const payload = value.slice(prefix[0].length)
  if (!payload || payload.length % 4 !== 0) return null

  let padding = 0
  while (padding < payload.length && payload[payload.length - 1 - padding] === '=') padding += 1
  if (padding > 2) return null
  const contentLength = payload.length - padding
  if (!contentLength || (padding === 1 && contentLength % 4 !== 3) || (padding === 2 && contentLength % 4 !== 2)) return null

  for (let index = 0; index < contentLength; index += 1) {
    const code = payload.charCodeAt(index)
    const valid = code >= 0x41 && code <= 0x5a
      || code >= 0x61 && code <= 0x7a
      || code >= 0x30 && code <= 0x39
      || code === 0x2b || code === 0x2f
    if (!valid) return null
  }
  // Canonical Base64 requires unused bits in a padded quartet to be zero.
  const lastValue = payload.charCodeAt(contentLength - 1)
  const alphabetIndex = lastValue >= 0x41 && lastValue <= 0x5a
    ? lastValue - 0x41
    : lastValue >= 0x61 && lastValue <= 0x7a
      ? lastValue - 0x61 + 26
      : lastValue >= 0x30 && lastValue <= 0x39
        ? lastValue - 0x30 + 52
        : lastValue === 0x2b ? 62 : 63
  if ((padding === 2 && (alphabetIndex & 0x0f) !== 0) || (padding === 1 && (alphabetIndex & 0x03) !== 0)) return null
  return Math.max(0, (payload.length * 3 / 4) - padding)
}

function validateImageUrl(value: string): string {
  const url = value.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url
  } catch { /* Local paths and malformed URLs cannot be sent to the service. */ }
  const bytes = dataUrlBytes(url)
  if (bytes !== null && bytes <= MAX_IMAGE_BYTES) return url
  if (bytes !== null && bytes > MAX_IMAGE_BYTES) throw new Error('参考图片不能超过 15 MB')
  throw new Error('参考图片必须是 HTTP(S) URL 或 JPEG、PNG、WEBP 图片 Data URL')
}

function assertImageMime(mime: string): void {
  if (!ALLOWED_MIMES.has(mime.trim().toLowerCase())) throw new Error('参考图片 MIME 必须是 JPEG、PNG 或 WEBP 图片')
}

async function imageDataUrl(id: string): Promise<string> {
  const media = await getMedia(id)
  if (!media) throw new Error('参考图片不存在，请重新上传')
  assertImageMime(media.mime)
  assertImageMime(media.blob.type)
  if (media.blob.size > MAX_IMAGE_BYTES) throw new Error('参考图片不能超过 15 MB')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('参考图片读取失败'))
    reader.onerror = () => reject(new Error('参考图片读取失败，请重新上传'))
    reader.onabort = () => reject(new Error('参考图片读取已取消'))
    reader.readAsDataURL(media.blob)
  })
  return validateImageUrl(dataUrl)
}

function responseRecords(res: unknown): Record<string, unknown>[] {
  if (!res || typeof res !== 'object') return []
  const record = res as Record<string, unknown>
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : undefined
  return nested ? [record, nested] : [record]
}

function responseStatus(res: unknown, defaultStatus = ''): PollResult['status'] {
  const status = String(responseRecords(res).find((record) => record.status != null)?.status ?? defaultStatus).trim().toLowerCase()
  if (status === 'queued' || status === 'pending') return 'queued'
  if (status === 'in_progress' || status === 'processing') return 'running'
  if (status === 'completed' || status === 'succeeded') return 'succeeded'
  if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'failed'
  throw new Error('视频查询返回未知状态，请稍后重试')
}

function findFailureReason(res: unknown): string | undefined {
  const fields = ['error', 'fail_reason', 'failReason', 'message', 'detail', 'reason'] as const
  const visit = (value: unknown, depth = 0): string | undefined => {
    if (depth > 3) return undefined
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    for (const field of fields) {
      const result = visit(record[field], depth + 1)
      if (result) return result
    }
    return undefined
  }
  for (const record of responseRecords(res)) {
    const reason = visit(record)
    if (reason) return reason
  }
  return undefined
}

function safeFailureMessage(reason: string | undefined): string {
  const fallback = '视频任务未成功或已过期，请检查任务状态后重试'
  if (!reason) return fallback
  const message = reason.trim()
  if (message.length === 0 || message.length > 180) return fallback
  const hasAddress = /[a-z][a-z0-9+.-]*:\/\/|\b(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\[[0-9a-f:]+\]|[A-Za-z]:\\/i.test(message)
  const hasInternalDetail = /api[ _-]?key|authorization|bearer|token|secret|password|credential|private|internal|upstream|provider|vendor|supplier|channel|backend|traceback|stack trace|\bkey\s*[:=]|上游|内部|私有|供应商|渠道|密钥|令牌|密码|凭证|后台|服务端|堆栈/i.test(message)
  const hasStructuredDetail = /[{}<>\u0000-\u001f]|\b[a-z0-9_-]{24,}\b/i.test(message)
  if (hasAddress || hasInternalDetail || hasStructuredDetail) return fallback
  const isChinese = /[\u3400-\u9fff]/.test(message)
  const isPlainEnglish = /^[\x20-\x7e]+$/.test(message)
  if (!isChinese && !isPlainEnglish) return fallback
  return `视频任务失败：${message}`
}

function uniqueImages(task: VideoTaskRecord): { ids: string[]; urls: string[] } {
  const inputs = task.inputs
  const ids: string[] = []
  const seenIds = new Set<string>()
  const addId = (id: unknown) => {
    if (typeof id !== 'string' || !id.trim() || seenIds.has(id)) return
    seenIds.add(id)
    ids.push(id)
  }
  // Keep the reference tile order when the UI supplies refItems.
  for (const item of inputs.refItems ?? []) if (item.type === 'image') addId(item.id)
  addId(inputs.firstFrameId)
  for (const id of inputs.refImageIds) addId(id)

  const urls: string[] = []
  const seenUrls = new Set<string>()
  const addUrl = (url: unknown) => {
    if (typeof url !== 'string' || !url.trim() || seenUrls.has(url.trim())) return
    seenUrls.add(url.trim())
    urls.push(url.trim())
  }
  addUrl(inputs.imageUrl)
  for (const url of inputs.imageUrls ?? []) addUrl(url)
  return { ids, urls }
}

function assertUnsupportedInputs(task: VideoTaskRecord): void {
  const inputs = task.inputs
  if (task.mode === 'flf2v' || inputs.lastFrameId) throw new Error('当前模型不支持严格首尾帧或尾帧')
  if (inputs.refVideoIds.length || inputs.sourceVideoId || inputs.refItems?.some((item) => item.type === 'video')) throw new Error('当前模型不支持参考视频')
  if (inputs.refAudioIds.length || inputs.refItems?.some((item) => item.type === 'audio')) throw new Error('当前模型不支持参考音频')
  if (!['t2v', 'i2v', 'ref2v'].includes(task.mode)) throw new Error('当前模型不支持所选模式')
}

export const sdAdapter: VideoAdapter = {
  redactServiceErrors: true,

  async buildSubmit({ task, profile }) {
    const headers = authHeaders(profile)
    const duration = modelDuration(task.model)
    if (task.params.duration !== duration) throw new Error(`视频 seconds 只能是 ${duration} 秒`)
    if (task.params.resolution !== '720p' && task.params.resolution !== '1080p') throw new Error('视频 resolution 只能是 720p 或 1080p')
    if (!(ALLOWED_RATIOS as readonly string[]).includes(task.params.aspectRatio)) throw new Error('视频 aspect_ratio 只能是 16:9、9:16、1:1、4:3、3:4 或 21:9')
    if (task.params.n !== 1) throw new Error('视频数量固定为 1')
    assertUnsupportedInputs(task)

    const { ids, urls } = uniqueImages(task)
    const count = ids.length + urls.length
    if (count > MAX_REFERENCE_IMAGES) throw new Error('参考图片最多 30 张')
    if (task.mode === 't2v' && count) throw new Error('文生视频模式不能包含图片，请切换到图生视频或参考图')
    if (task.mode === 'i2v' && count !== 1) throw new Error('单图生视频需要且只能提供 1 张图片')
    if (task.mode === 'ref2v' && !count) throw new Error('参考图生视频至少需要 1 张图片')

    const references: VideoReferenceItem[] = ids.map((id) => ({ id, type: 'image' }))
    const prompt = serializeVideoPrompt(task.prompt, references).trim()
    if (!prompt) throw new Error('请输入视频提示词')

    // Validate remote images before allocating Data URLs for local images.
    const images = urls.map(validateImageUrl)
    for (const id of ids) images.push(await imageDataUrl(id))
    const body = {
      model: task.model, prompt, seconds: duration,
      resolution: task.params.resolution, aspect_ratio: task.params.aspectRatio, n: 1,
      ...(images.length ? { reference_images: images } : {}),
    }
    return { url: proxyUrl(profile), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
  },

  parseSubmit(res) {
    const taskId = responseRecords(res).flatMap((record) => [record.id, record.task_id]).find((id) => typeof id === 'string' && id.trim())
    if (typeof taskId !== 'string') throw new Error('视频创建响应缺少任务 ID')
    const submitStatus = responseStatus(res, 'queued')
    return { taskId: taskId.trim(), status: submitStatus === 'running' ? 'running' : 'queued' }
  },

  buildPoll(taskId, profile) {
    return { url: proxyUrl(profile, encodeURIComponent(taskId)), init: { method: 'GET', headers: authHeaders(profile) } }
  },

  parsePoll(res) {
    const status = responseStatus(res)
    const progress = responseRecords(res).find((record) => typeof record.progress === 'number')?.progress
    return {
      status,
      progress: typeof progress === 'number' && Number.isFinite(progress) ? progress : 0,
      ...(status === 'failed' ? { error: safeFailureMessage(findFailureReason(res)) } : {}),
    }
  },

  buildContent(taskId, profile) {
    return { url: proxyUrl(profile, `${encodeURIComponent(taskId)}/content`), init: { method: 'GET', headers: authHeaders(profile) } }
  },
}
