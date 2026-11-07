import type { ApiProfile } from '../types'
import { buildRootApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { assertImageInputPayloadSize, fetchImageUrlAsDataUrl, getApiErrorMessage, normalizeBase64Image, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { getImageReferenceLimit, getMidjourneyRatios, isMidjourneyModel, MIDJOURNEY_QUALITIES } from './midjourneyModels'
export { MIDJOURNEY_HIGH, MIDJOURNEY_LOW } from './midjourneyModels'

export class MidjourneyTaskError extends Error {
  constructor(message: string, public taskId?: string, public recoverable = false, public phase: 'failure' | 'unknown' | 'polling' = 'failure') { super(message) }
}

function validReference(value: string) {
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i.test(value) && value.split(',')[1]) return true
  if (/[\s\\<>"`\x00-\x1f\x7f]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    return !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host) && !host.endsWith('.local')
  } catch { return false }
}

export function buildMidjourneyRequest(opts: CallApiOptions, profile: ApiProfile) {
  if (!isMidjourneyModel(profile.model)) throw new Error('未知的 Midjourney 模型')
  if (!opts.prompt.trim() || opts.prompt.length > 32768) throw new Error('prompt 必须是非空字符串，最多 32768 个字符')
  if (opts.maskDataUrl) throw new Error('Midjourney 基础生图不支持遮罩，请移除遮罩')
  if (!getMidjourneyRatios(profile.model).includes(opts.params.size)) throw new Error('size 必须为该模型支持的画面比例')
  const quality = opts.params.midjourneyQuality ?? '1'
  if (!MIDJOURNEY_QUALITIES.includes(quality)) throw new Error('quality 仅支持 0.25、0.5、1、2')
  const hd = opts.params.midjourneyHd ?? false
  if (typeof hd !== 'boolean') throw new Error('hd 必须是布尔值')
  const limit = getImageReferenceLimit(profile.model)
  if (opts.inputImageDataUrls.length > limit) throw new Error(`参考图最多 ${limit} 张`)
  if (opts.inputImageDataUrls.some(value => !validReference(value))) throw new Error('参考图必须为公网 HTTP(S) 图片 URL 或有效的图片 Base64 data URL')
  assertImageInputPayloadSize(opts.inputImageDataUrls.reduce((sum, value) => sum + value.length, 0))
  return {
    model: profile.model, prompt: opts.prompt, size: opts.params.size, n: 1,
    quality, hd,
    ...(opts.inputImageDataUrls.length ? { images: opts.inputImageDataUrls } : {}),
  }
}

function requestUrl(profile: ApiProfile, path: string) {
  const proxy = readClientDevProxyConfig()
  return buildRootApiUrl(profile.baseUrl, path, proxy, shouldUseApiProxy(profile.apiProxy, proxy))
}

async function requestJson(profile: ApiProfile, path: string, body?: unknown) {
  const response = await fetch(requestUrl(profile, path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${profile.apiKey.trim()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1, profile.timeout) * 1000),
    cache: 'no-store', redirect: 'error',
  })
  if (!response.ok) {
    const error = new Error(await getApiErrorMessage(response)) as Error & { retryable?: boolean }
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
    throw error
  }
  return await response.json() as Record<string, any>
}

function detail(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return detail((value as Record<string, unknown>).message) || JSON.stringify(value)
  return ''
}

/** Use the existing credentialless download proxy, falling back to first-party task artifacts.
 * The key is sent only to the configured API origin, never to a result URL. */
async function readImages(profile: ApiProfile, taskId: string, data: Array<{ url?: string; b64_json?: string }>): Promise<CallApiResult> {
  const rawImageUrls = data.flatMap(item => typeof item.url === 'string' && /^https?:\/\//i.test(item.url) ? [item.url] : [])
  let artifacts: Array<{ content_url?: string }> | undefined
  const images: string[] = []
  for (let index = 0; index < data.length; index++) {
    const item = data[index]
    if (typeof item.b64_json === 'string' && item.b64_json) { images.push(normalizeBase64Image(item.b64_json, 'image/png')); continue }
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) continue
    try {
      images.push(await fetchImageUrlAsDataUrl(`/download-proxy?url=${encodeURIComponent(item.url)}`, 'image/png'))
    } catch {
      try {
        artifacts ??= (await requestJson(profile, `v1/tasks/${encodeURIComponent(taskId)}/artifacts`)).artifacts
        const contentUrl = artifacts?.[index]?.content_url
        // Only accept the known first-party content route. Do not forward auth to arbitrary URLs.
        const base = new URL(profile.baseUrl, typeof location !== 'undefined' ? location.href : 'https://local.invalid')
        const content = contentUrl ? new URL(contentUrl, base) : null
        const pathPrefix = base.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
        const expected = `${pathPrefix}/v1/tasks/${encodeURIComponent(taskId)}/artifacts/`
        if (!content || content.origin !== base.origin || !content.pathname.startsWith(expected) || !/^\/[^?#]*$/.test(content.pathname)) throw new Error('无效的本站产物地址')
        const path = content.pathname.slice(pathPrefix.length).replace(/^\//, '') + content.search
        const response = await fetch(requestUrl(profile, path), { headers: { Authorization: `Bearer ${profile.apiKey.trim()}` }, redirect: 'error', cache: 'no-store' })
        if (!response.ok) throw new Error('本站产物下载失败')
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        images.push(normalizeBase64Image(btoa(binary), response.headers.get('content-type')?.split(';')[0] || 'image/png'))
      } catch {
        throw new MidjourneyTaskError(`图片已生成，下载失败；保留任务 ${taskId}，稍后继续查询下载`, taskId, true, 'polling')
      }
    }
  }
  if (!images.length) throw new MidjourneyTaskError(`任务 ${taskId} 成功但没有可识别图片，请联系管理员`, taskId, false, 'unknown')
  return { images, rawImageUrls, actualParams: { n: 1 }, actualParamsList: images.map(() => ({ n: 1 })) }
}

export async function callMidjourneyImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  let taskId = opts.resumeMidjourneyTaskId
  const redact = (message: string) => profile.apiKey ? message.split(profile.apiKey).join('[REDACTED]') : message
  try {
    if (!taskId) {
      const payload = buildMidjourneyRequest(opts, profile)
      await opts.onMidjourneySubmitting?.()
      const created = await requestJson(profile, 'midjourney-v82/generations', payload)
      taskId = typeof created.task_id === 'string' ? created.task_id : undefined
      if (!taskId) throw new Error('Midjourney 未返回 task_id；请先检查本站任务记录，避免重复提交')
      await opts.onMidjourneyTaskEnqueued?.({ taskId })
    }
    let failures = 0
    while (true) {
      let task: Record<string, any>
      try {
        task = await requestJson(profile, `midjourney-v82/tasks/${encodeURIComponent(taskId)}`)
        failures = 0
      } catch (error) {
        const retryable = (error as { retryable?: boolean }).retryable ?? (error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name)))
        if (!retryable) throw new MidjourneyTaskError(detail(error instanceof Error ? error.message : error), taskId, false, 'unknown')
        if (++failures >= 3) throw new MidjourneyTaskError(`任务 ${taskId} 查询连接中断，将继续查询`, taskId, true, 'polling')
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }
      if (task.status === 'SUCCESS') return await readImages(profile, taskId, Array.isArray(task.result?.data) ? task.result.data : [])
      if (task.status === 'FAILURE') throw new MidjourneyTaskError(detail(task.error) || 'Midjourney 任务失败', taskId)
      if (!['NOT_START', 'SUBMITTED', 'QUEUED', 'PENDING', 'IN_PROGRESS', 'RUNNING', 'PROCESSING'].includes(task.status)) {
        throw new MidjourneyTaskError(`Midjourney 状态 ${String(task.status)}，请保留任务 ${taskId} 联系管理员`, taskId, false, 'unknown')
      }
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  } catch (error) {
    if (error instanceof MidjourneyTaskError) { error.message = redact(error.message); throw error }
    throw new MidjourneyTaskError(redact(error instanceof Error ? error.message : String(error)), taskId)
  }
}
