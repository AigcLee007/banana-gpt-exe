import type { VideoAdapter, PollResult } from '../videoApi'
import type { VideoApiProfileSnapshot } from '../videoTypes'
import { getMedia } from '../videoDb'
import { buildVideoApiUrl } from '../videoTransport'
import { serializeVideoPrompt, getFrameReferences } from '../videoPromptMentions'

const MODEL = 'gemini-omni-flash-10s'

function proxyUrl(profile: VideoApiProfileSnapshot, path = '') {
  return buildVideoApiUrl(profile, `videos${path ? `/${path}` : ''}`, true)
}

function authHeaders(profile: VideoApiProfileSnapshot) {
  const key = profile.apiKey.trim()
  if (!key) throw new Error('请先在设置 → API 配置中填写 API Key')
  return { Authorization: `Bearer ${key}` }
}

function validateImageUrl(value: string): string {
  const url = value.trim()
  try {
    if (new URL(url).protocol === 'https:') return url
  } catch { /* Local paths cannot be sent as remote images. */ }
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(url)) return url
  throw new Error('参考图片必须是 HTTPS URL 或 data:image/...;base64,... 图片')
}

async function imageDataUrl(id: string): Promise<string> {
  const media = await getMedia(id)
  if (!media) throw new Error('参考图片不存在，请重新上传')
  if (!media.mime.startsWith('image/') || !media.blob.type.startsWith('image/')) {
    throw new Error('参考图片 MIME 必须是 image/*')
  }
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
  return record.data && typeof record.data === 'object' ? [record, record.data as Record<string, unknown>] : [record]
}

function responseStatus(res: unknown, defaultStatus = ''): PollResult['status'] {
  const status = String(responseRecords(res).find((record) => record.status != null)?.status ?? defaultStatus).trim().toLowerCase()
  if (['queued', 'pending'].includes(status)) return 'queued'
  if (['in_progress', 'processing'].includes(status)) return 'running'
  if (['completed', 'succeeded'].includes(status)) return 'succeeded'
  if (['failed', 'cancelled', 'expired'].includes(status)) return 'failed'
  throw new Error('视频查询返回未知状态，请稍后重试')
}

export const omniAdapter: VideoAdapter = {
  redactServiceErrors: true,
  async buildSubmit({ task, profile }) {
    const headers = authHeaders(profile)
    const { params, inputs, mode } = task
    if (params.duration !== 10) throw new Error('视频 seconds 只能是 10 秒')
    if (params.resolution !== '720p') throw new Error('视频 resolution 只能是 720p')
    if (!['16:9', '9:16'].includes(params.aspectRatio)) throw new Error('视频 aspect_ratio 只能是 16:9 或 9:16')
    if (params.n !== 1) throw new Error('视频数量固定为 1')
    if (mode === 'flf2v' || inputs.lastFrameId) throw new Error('当前模型不支持严格首尾帧或尾帧')
    if (inputs.refVideoIds.length || inputs.sourceVideoId || inputs.refItems?.some((item) => item.type === 'video')) throw new Error('当前模型不支持参考视频')
    if (inputs.refAudioIds.length || inputs.refItems?.some((item) => item.type === 'audio')) throw new Error('当前模型不支持参考音频')
    if (!['t2v', 'i2v', 'ref2v'].includes(mode)) throw new Error('当前模型不支持所选模式')

    const refIds = [...new Set([...inputs.refImageIds, ...(inputs.refItems ?? []).map((item) => item.id)])]
    const urls = [...(inputs.imageUrl ? [inputs.imageUrl] : []), ...(inputs.imageUrls ?? [])]
    const ids = [...(inputs.firstFrameId ? [inputs.firstFrameId] : []), ...refIds]
    const imageCount = ids.length + urls.length
    if (imageCount > 7) throw new Error('参考图片最多 7 张')
    if (mode === 't2v' && imageCount) throw new Error('文生视频模式不能包含图片，请切换到图生视频或参考图')
    if (mode === 'i2v' && imageCount !== 1) throw new Error('单图生视频需要且只能提供 1 张图片')
    if (mode === 'ref2v' && !imageCount) throw new Error('参考图生视频至少需要 1 张图片')
    const references = mode === 'ref2v' ? refIds.map((id) => ({ id, type: 'image' as const })) : getFrameReferences(inputs.firstFrameId, undefined)
    const prompt = serializeVideoPrompt(task.prompt, references).trim()
    if (!prompt) throw new Error('请输入视频提示词')
    const images = [...urls.map(validateImageUrl), ...await Promise.all(ids.map(imageDataUrl))]
    const body = {
      model: MODEL, prompt, seconds: '10', aspect_ratio: params.aspectRatio, resolution: '720p',
      ...(images.length ? { images } : {}),
    }
    return { url: proxyUrl(profile), init: { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
  },

  parseSubmit(res) {
    const taskId = responseRecords(res).flatMap((record) => [record.id, record.task_id]).find((id) => typeof id === 'string' && id.trim())
    if (typeof taskId !== 'string') throw new Error('视频创建响应缺少任务 ID')
    return { taskId: taskId.trim(), status: responseStatus(res, 'queued') === 'running' ? 'running' : 'queued' }
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
      ...(status === 'failed' ? { error: '视频任务未成功或已过期，请重新创建' } : {}),
    }
  },

  buildContent(taskId, profile) {
    return { url: proxyUrl(profile, `${encodeURIComponent(taskId)}/content`), init: { method: 'GET', headers: authHeaders(profile) } }
  },
}
