// 视频接口统一层

import type { VideoTaskRecord, VideoApiProfileSnapshot } from './videoTypes'
import type { VideoAdapterId } from './videoModels'
import { h3Adapter } from './videoAdapters/h3'
import { grokAdapter } from './videoAdapters/grok'
import { omniAdapter } from './videoAdapters/omni'
import { sdAdapter } from './videoAdapters/sd'

export interface VideoRequest {
  task: VideoTaskRecord
  profile: VideoApiProfileSnapshot
}

export interface RequestSpec {
  url: string
  init: RequestInit
}

export interface PollResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  error?: string
  videoUrl?: string
}

export interface VideoAdapter {
  redactServiceErrors?: boolean
  buildSubmit(request: VideoRequest): Promise<RequestSpec>
  parseSubmit(res: unknown): { taskId: string; status?: 'queued' | 'running' }
  buildPoll(taskId: string, profile: VideoApiProfileSnapshot): RequestSpec
  parsePoll(res: unknown): PollResult
  buildContent(taskId: string, profile: VideoApiProfileSnapshot): RequestSpec
}

const adapters: Record<VideoAdapterId, VideoAdapter> = {
  h3: h3Adapter,
  grok: grokAdapter,
  omni: omniAdapter,
  sd: sdAdapter,
}

export function formatVideoApiError(status: number, rawText: string, phase = '提交'): string {
  let payload: unknown
  try {
    payload = rawText ? JSON.parse(rawText) : undefined
  } catch {
    payload = undefined
  }
  const detail = findVideoErrorDetail(payload) || rawText.trim() || `HTTP ${status}`
  return `${phase}失败（${status}）：${formatVideoTaskError(detail, status)}`
}

/** Converts relay/provider wording into a message that a video-workbench user can act on. */
export function formatVideoTaskError(detail: string, status?: number): string {
  const message = detail.trim()
  const wrapped = message.match(/^(提交|查询|下载)失败\s*[（(](\d+)[）)]\s*[:：]\s*([\s\S]*)$/)
  if (wrapped) return formatVideoApiError(Number(wrapped[2]), wrapped[3], wrapped[1])
  if (message.startsWith('{')) {
    try {
      const nested = findVideoErrorDetail(JSON.parse(message))
      if (nested && nested !== message) return formatVideoTaskError(nested, status)
    } catch { /* Non-JSON error text is handled below. */ }
  }
  const lower = message.toLowerCase()
  const invalidKeyMessage = 'API Key 无效或无权使用该视频模型，请在设置 → API 配置中检查密钥和模型权限'
  if (!message || /^http\s+\d+$/i.test(message)) {
    if (status === 401 || status === 403) return invalidKeyMessage
    if (status === 404) return '视频任务不存在或已过期'
    if (status === 429) return '视频服务当前繁忙，请稍后重试'
    if (status !== undefined && status >= 500) return '中转站暂时不可用，请稍后重试'
    return '视频请求未成功，请稍后重试'
  }
  if (lower.includes('grok_imagine_video_api_key is not configured') || lower.includes('api key is not configured') || lower.includes('api_key is not configured') || message.includes('视频服务尚未配置密钥') || message.includes('视频 API 配置缺少 API Key')) {
    return '请先在设置 → API 配置中填写 API Key'
  }
  if (message.includes('视频服务认证失败，请联系管理员检查 API Key')) return invalidKeyMessage
  // Keep actionable Chinese messages stable when stored errors are formatted again.
  if (/[一-鿿]/.test(message)) return message
  if (/(?:invalid|incorrect|expired|missing)\s+(?:api[ _]?key|key)|authentication|unauthorized/i.test(lower)) {
    return invalidKeyMessage
  }
  if (lower.includes('invalid image') || lower.includes('image') && (lower.includes('invalid') || lower.includes('unsupported') || lower.includes('read'))) {
    return '参考图片无效或无法读取，请换一张 PNG/JPEG 图片'
  }
  if (lower.includes('prompt') && (lower.includes('required') || lower.includes('missing') || lower.includes('empty'))) {
    return '请填写视频提示词，或上传一张图片'
  }
  if (lower.includes('seconds') || lower.includes('duration')) return '视频时长必须是 1 到 15 秒'
  if (lower.includes('aspect_ratio') || lower.includes('aspect ratio')) return '画面比例不受支持，请重新选择'
  if (lower.includes('resolution')) return '清晰度不受支持，请重新选择'
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error')) {
    return '无法连接视频服务，请检查网络后重试'
  }
  if (status === 401 || status === 403) return invalidKeyMessage
  if (status === 404) return '视频任务不存在或已过期'
  if (status === 429) return '视频服务当前繁忙，请稍后重试'
  if (status !== undefined && status >= 500) return '中转站暂时不可用，请稍后重试'
  return '视频请求未成功，请检查参数后重试'
}

function findVideoErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : undefined
  for (const value of [record.error, record.fail_reason, record.message, nested?.error, nested?.fail_reason, nested?.message]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object') return findVideoErrorDetail(value) || JSON.stringify(value)
  }
  return undefined
}

export async function submitVideoTask(
  task: VideoTaskRecord,
): Promise<{ remoteTaskId: string; status: 'queued' | 'running'; recoverable: boolean }> {
  const adapter = adapters[task.adapter]
  const profile = task.apiProfile
  if (!adapter || !profile) throw new Error('视频任务缺少有效的 API 配置')

  const { url, init } = await adapter.buildSubmit({ task, profile })
  const response = await fetch(url, init)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(formatVideoApiError(response.status, adapter.redactServiceErrors ? '' : text))
  }

  const { taskId, status } = adapter.parseSubmit(await response.json())
  return { remoteTaskId: taskId, status: status || 'queued', recoverable: true }
}

export async function pollVideoTask(
  remoteTaskId: string,
  task: VideoTaskRecord,
): Promise<PollResult> {
  const adapter = adapters[task.adapter]
  const profile = task.apiProfile
  if (!adapter || !profile) throw new Error('视频任务缺少有效的 API 配置')

  const { url, init } = adapter.buildPoll(remoteTaskId, profile)
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(formatVideoApiError(response.status, adapter.redactServiceErrors ? '' : text, '查询'))
  }
  return adapter.parsePoll(await response.json())
}

export async function downloadVideoContent(
  remoteTaskId: string,
  task: VideoTaskRecord,
): Promise<Blob> {
  const adapter = adapters[task.adapter]
  const profile = task.apiProfile
  if (!adapter || !profile) throw new Error('视频任务缺少有效的 API 配置')
  const { url, init } = adapter.buildContent(remoteTaskId, profile)
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(formatVideoApiError(response.status, adapter.redactServiceErrors ? '' : text, '下载'))
  }
  return response.blob()
}
