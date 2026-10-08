import type { VideoAdapter } from '../videoApi'
import type { VideoTaskRecord, VideoApiProfileSnapshot, MediaRecord } from '../videoTypes'
import { getMedia } from '../videoDb'
import { getFrameReferences, serializeVideoPrompt } from '../videoPromptMentions'
import { buildVideoApiUrl } from '../videoTransport'

const MODEL = 'grok-imagine-video-1.5'
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
const RESOLUTIONS = ['480p', '720p', '1080p'] as const

function proxyUrl(profile: VideoApiProfileSnapshot, taskPath: string) {
  return buildVideoApiUrl(profile, `videos${taskPath ? `/${taskPath.replace(/^\/+/, '')}` : ''}`, true)
}

function authHeaders(profile: VideoApiProfileSnapshot): Record<string, string> {
  const key = profile.apiKey.trim()
  if (!key) throw new Error('请先在设置 → API 配置中填写 API Key')
  return { Authorization: `Bearer ${key}` }
}

export function validateGrokImageUrl(value: string): string {
  const url = value.trim()
  if (/^https:\/\//i.test(url)) return url
  if (!/^data:image\/(?:[a-z0-9.+-]+);base64,/i.test(url)) {
    throw new Error('Grok 图片必须是 HTTPS URL 或 data:image URL')
  }
  const dimensions = dataImageDimensions(url)
  if (!dimensions || dimensions.width < 8 || dimensions.height < 8) {
    throw new Error('Grok 图片宽高不能小于 8 像素')
  }
  return url
}

function validateParams(task: VideoTaskRecord) {
  const seconds = task.params.duration
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15) {
    throw new Error('Grok seconds 必须是 1 到 15 的整数')
  }
  if (!(RATIOS as readonly string[]).includes(task.params.aspectRatio)) {
    throw new Error(`Grok aspect_ratio 不支持: ${task.params.aspectRatio}`)
  }
  if (!(RESOLUTIONS as readonly string[]).includes(task.params.resolution)) {
    throw new Error(`Grok resolution 不支持: ${task.params.resolution}`)
  }
  if (task.params.n !== 1) throw new Error('Grok 视频数量固定为 1')
}

function getError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const data = payload as Record<string, unknown>
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined
  const candidates = [data.error, data.fail_reason, data.message, nested?.error, nested?.fail_reason, nested?.message]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object') return JSON.stringify(value)
  }
  return undefined
}

function getStatus(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as Record<string, unknown>
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined
  return String(data.status ?? nested?.status ?? '').toLowerCase()
}

function getTaskId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const data = payload as Record<string, unknown>
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined
  for (const value of [data.id, data.task_id, nested?.id, nested?.task_id]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function getVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const data = payload as Record<string, unknown>
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined
  for (const value of [data.video_url, data.videoUrl, nested?.video_url, nested?.videoUrl]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function getProgress(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const data = payload as Record<string, unknown>
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined
  const value = data.progress ?? nested?.progress
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapStatus(status: string): 'queued' | 'running' | 'succeeded' | 'failed' {
  if (status === 'completed' || status === 'succeeded') return 'succeeded'
  if (status === 'failed' || status === 'failure' || status === 'expired' || status === 'cancelled') return 'failed'
  if (status === 'in_progress' || status === 'processing') return 'running'
  if (status === 'queued' || status === 'pending') return 'queued'
  throw new Error(`视频查询返回未知状态: ${status || '空'}`)
}

function dataImageDimensions(dataUrl: string): { width: number; height: number } | undefined {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,([a-z0-9+/=]+)$/i)
  if (!match) return undefined
  try {
    const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0))
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const view = new DataView(bytes.buffer)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let offset = 2; offset + 9 < bytes.length;) {
        if (bytes[offset] !== 0xff) { offset++; continue }
        const marker = bytes[offset + 1]
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
        if (length < 2) break
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
        }
        offset += 2 + length
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

async function requireImage(id: string): Promise<MediaRecord> {
  const media = await getMedia(id)
  if (!media) throw new Error(`找不到参考图片: ${id}`)
  if (!media.mime.startsWith('image/')) throw new Error('Grok 单图片模式只支持 image/*')
  if (!media.width || !media.height || media.width < 8 || media.height < 8) {
    throw new Error('Grok 图片宽高不能小于 8 像素')
  }
  return media
}

export const grokAdapter: VideoAdapter = {
  async buildSubmit({ task, profile }) {
    const headers = authHeaders(profile)
    validateParams(task)
    // The relay's 1080p route is currently unreliable; submit it as 720p.
    const resolution = task.params.resolution === '1080p' ? '720p' : task.params.resolution
    if (task.mode !== 't2v' && task.mode !== 'i2v') throw new Error('Grok 只支持文生视频和单图片图生视频')
    if (task.inputs.lastFrameId || task.inputs.refImageIds.length || task.inputs.refVideoIds.length || task.inputs.refAudioIds.length || task.inputs.refItems?.length) {
      throw new Error('Grok 不支持参考图多图、尾帧、关键帧或参考视频')
    }
    const imageUrl = task.inputs.imageUrl?.trim()
    const firstFrameId = task.inputs.firstFrameId
    if (!task.prompt.trim() && !imageUrl && !firstFrameId) throw new Error('Grok prompt 和 image 至少提供一个')
    const prompt = serializeVideoPrompt(task.prompt, getFrameReferences(firstFrameId, undefined)).trim()
    if (imageUrl) validateGrokImageUrl(imageUrl)

    if (imageUrl) {
      const body: Record<string, unknown> = {
        model: MODEL,
        ...(prompt ? { prompt } : {}),
        seconds: String(task.params.duration),
        aspect_ratio: task.params.aspectRatio,
        resolution,
        image: { url: imageUrl },
      }
      return { url: proxyUrl(profile, ''), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
    }

    if (!firstFrameId) {
      const body = { model: MODEL, prompt, seconds: String(task.params.duration), aspect_ratio: task.params.aspectRatio, resolution }
      return { url: proxyUrl(profile, ''), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
    }

    const media = await requireImage(firstFrameId)
    const form = new FormData()
    form.append('model', MODEL)
    if (prompt) form.append('prompt', prompt)
    form.append('seconds', String(task.params.duration))
    form.append('aspect_ratio', task.params.aspectRatio)
    form.append('resolution', resolution)
    form.append('input_reference', new File([media.blob], media.filename || `${firstFrameId}.png`, { type: media.mime }))
    return { url: proxyUrl(profile, ''), init: { method: 'POST', headers, body: form } }
  },

  parseSubmit(res) {
    const taskId = getTaskId(res)
    if (!taskId) throw new Error('视频创建响应缺少任务 ID')
    const status = getStatus(res)
    return { taskId, status: mapStatus(status || 'queued') === 'running' ? 'running' : 'queued' }
  },

  buildPoll(taskId, profile) {
    return { url: proxyUrl(profile, encodeURIComponent(taskId)), init: { method: 'GET', headers: authHeaders(profile) } }
  },

  parsePoll(res) {
    const status = getStatus(res)
    return { status: mapStatus(status), progress: getProgress(res), error: getError(res), videoUrl: getVideoUrl(res) }
  },

  buildContent(taskId, profile) {
    return { url: proxyUrl(profile, `${encodeURIComponent(taskId)}/content`), init: { method: 'GET', headers: authHeaders(profile) } }
  },
}
