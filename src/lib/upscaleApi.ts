// 图片高清放大：调用中转站的 upscale-standard / upscale-creative 两个模型。
//
// 同步接口 POST /v1/images/edits 一次拿图；大图或网络不稳定时用任务接口
// POST /v1/videos（名字沿用视频协议，交付的是图片）提交后轮询，连接中断也不会丢图。
// 结果地址只保留 5 小时，调用方必须马上转存到本地。

import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { buildVideoApiUrl } from './videoTransport'
import { fetchImageUrlAsDataUrl, isDataUrl } from './imageApiShared'
import { dataUrlToBlob } from './canvasImage'
import type { ApiProfile } from '../types'

export type UpscaleModelId = 'upscale-standard' | 'upscale-creative'
export type UpscaleFormat = 'png' | 'jpg' | 'webp'

export interface UpscaleModelOption {
  id: UpscaleModelId
  label: string
  description: string
  /** 可选倍数 */
  factors: number[]
  defaultFactor: number
  /** 可选输出格式；空数组表示该模型不支持选择格式 */
  formats: UpscaleFormat[]
  defaultFormat: UpscaleFormat | null
  /** 展示给用户的价格说明 */
  priceText: string
}

export const UPSCALE_MODELS: UpscaleModelOption[] = [
  {
    id: 'upscale-standard',
    label: '标准高清',
    description: '忠实还原，细节不乱改，适合大多数图片',
    factors: [1, 2, 3, 4, 5, 6, 7, 8],
    defaultFactor: 2,
    formats: ['jpg', 'png', 'webp'],
    defaultFormat: 'jpg',
    priceText: '0.03 元 / 百万像素（按输出尺寸）',
  },
  {
    id: 'upscale-creative',
    label: '商用 · 创意',
    description: '重新生成纹理和细节，画面更锐利，会改动原图细节；固定放大 2 倍',
    factors: [2],
    defaultFactor: 2,
    formats: [],
    defaultFormat: null,
    priceText: '0.7 元 / 张',
  },
]

export const UPSCALE_MAX_INPUT_BYTES = 30 * 1024 * 1024
/** 输出像素上限：100 百万像素（约 10000 × 10000）。和中转站插件的结算上限一致，超过就不让提交。 */
export const UPSCALE_MAX_OUTPUT_PIXELS = 100_000_000
const POLL_INTERVAL_MS = 6000
const POLL_MAX_MS = 25 * 60 * 1000

export interface UpscaleParams {
  model: UpscaleModelId
  factor: number
  format: UpscaleFormat | null
}

export interface UpscaleRequest {
  profile: ApiProfile
  params: UpscaleParams
  /** 要放大的图片 */
  imageDataUrl: string
  /** 任务方式：先提交再轮询，防止连接中断丢图 */
  asTask?: boolean
  signal?: AbortSignal
  /** 任务方式提交成功后回调，便于重启后继续查询 */
  onTaskEnqueued?: (task: { taskId: string }) => void
  /** 已有任务编号时直接继续轮询，不再重复提交（重复提交会再次扣费） */
  resumeTaskId?: string
}

export interface UpscaleResult {
  /** 放大后的图片，base64 data URL */
  image: string
  /** 服务端给出的图片地址（5 小时内有效） */
  rawUrl: string
  width?: number
  height?: number
}

export type UpscaleLimitCheck =
  | { ok: true; outputPixels: number }
  | { ok: false; outputPixels: number; maxFactor: number | null; message: string }

export function estimateOutputPixels(width: number, height: number, factor: number): number {
  return Math.round(width * factor) * Math.round(height * factor)
}

/** 这张图在该模型下，输出不超过上限的最大倍数；一个都放不下时返回 null。 */
export function getMaxAllowedFactor(width: number, height: number, model: UpscaleModelId): number | null {
  const option = UPSCALE_MODELS.find((item) => item.id === model)
  if (!option) return null
  const fits = option.factors.filter((factor) => estimateOutputPixels(width, height, factor) <= UPSCALE_MAX_OUTPUT_PIXELS)
  return fits.length ? Math.max(...fits) : null
}

/** 检查输出是否超过上限。页面置灰按钮和提交前校验都用它，保证两边结论一致。 */
export function checkUpscaleLimit(width: number, height: number, params: Pick<UpscaleParams, 'model' | 'factor'>): UpscaleLimitCheck {
  const outputPixels = estimateOutputPixels(width, height, params.factor)
  if (!(width > 0 && height > 0)) return { ok: true, outputPixels: 0 }
  if (outputPixels <= UPSCALE_MAX_OUTPUT_PIXELS) return { ok: true, outputPixels }

  const maxFactor = getMaxAllowedFactor(width, height, params.model)
  const megapixels = Math.round(outputPixels / 1_000_000)
  const limit = UPSCALE_MAX_OUTPUT_PIXELS / 1_000_000
  const option = UPSCALE_MODELS.find((item) => item.id === params.model)
  // 固定倍数的模型（商用 · 创意只有 2 倍）没有可调的倍数，只能换模型或缩小图片
  const advice = option && option.factors.length > 1 && maxFactor
    ? `这张图最多可放大 ${maxFactor} 倍`
    : params.model === 'upscale-creative'
      ? '商用 · 创意固定放大 2 倍，请换成「标准高清」并降低倍数，或先缩小图片'
      : '这张图太大，放大后超出上限，请先缩小图片'
  return {
    ok: false,
    outputPixels,
    maxFactor,
    message: `放大后约 ${megapixels} 百万像素，超过 ${limit} 百万像素的上限。${advice}`,
  }
}

export function getUpscaleModel(id: string | undefined): UpscaleModelOption | undefined {
  return UPSCALE_MODELS.find((model) => model.id === id)
}

/** 把用户选择整理成合法参数：倍数、格式超出该模型范围时回到默认值。 */
export function normalizeUpscaleParams(input: Partial<UpscaleParams> | undefined): UpscaleParams {
  const model = getUpscaleModel(input?.model) ?? UPSCALE_MODELS[0]
  const factor = model.factors.includes(Number(input?.factor)) ? Number(input?.factor) : model.defaultFactor
  const format = model.formats.length
    ? (model.formats.includes(input?.format as UpscaleFormat) ? (input?.format as UpscaleFormat) : model.defaultFormat)
    : null
  return { model: model.id, factor, format }
}

export function describeUpscale(params: UpscaleParams): string {
  const model = getUpscaleModel(params.model)
  return `高清放大 ${params.factor} 倍 · ${model?.label ?? params.model}`
}

function authHeaders(profile: ApiProfile): Record<string, string> {
  return { Authorization: `Bearer ${profile.apiKey.trim()}` }
}

function requestUrl(profile: ApiProfile, path: string): string {
  const proxyConfig = readClientDevProxyConfig()
  return buildApiUrl(profile.baseUrl, path, proxyConfig, shouldUseApiProxy(profile.apiProxy, proxyConfig))
}

/**
 * 任务方式的 videos 路径要走服务器代理的专用放行规则（/api-proxy/v1/videos）。
 * buildApiUrl 在 baseUrl 已以 /v1 结尾时会去掉 v1，拼出 /api-proxy/videos，
 * 被 nginx 兜底规则拦成 403；视频功能用的 buildVideoApiUrl 固定带 v1，这里复用它。
 */
function taskUrl(profile: ApiProfile, path: string): string {
  return buildVideoApiUrl({ profileId: profile.id, baseUrl: profile.baseUrl, apiKey: profile.apiKey, apiProxy: profile.apiProxy }, path)
}

function imageExtension(dataUrl: string): string {
  const mime = /^data:(image\/[a-z0-9.+-]+)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? 'image/png'
  if (mime === 'image/jpeg') return 'jpg'
  return mime.replace('image/', '') || 'png'
}

async function buildForm(request: UpscaleRequest, fileField: 'image' | 'input_reference'): Promise<FormData> {
  const { params, imageDataUrl } = request
  if (!isDataUrl(imageDataUrl)) throw new Error('要放大的图片已不存在')
  const blob = await dataUrlToBlob(imageDataUrl)
  if (blob.size > UPSCALE_MAX_INPUT_BYTES) throw new Error('图片超过 30MB，请压缩后再放大')

  const form = new FormData()
  form.append('model', params.model)
  form.append('upscale_factor', String(params.factor))
  if (params.format) form.append('output_format', params.format)
  form.append(fileField, blob, `input.${imageExtension(imageDataUrl)}`)
  return form
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return { __raw: text }
  }
}

/** 从已解析的响应里取出错误文字（response 已被读过，不能再交给 getApiErrorMessage）。 */
export function extractErrorDetail(payload: Record<string, unknown>): string {
  const error = payload.error
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown }
    const message = typeof record.message === 'string' ? record.message : ''
    const code = typeof record.code === 'string' ? record.code : ''
    // 把 code 也带上，下面按它判断模型未开通、余额不足
    return [code, message].filter(Boolean).join(' ')
  }
  if (typeof error === 'string') return error
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.__raw === 'string') return payload.__raw.slice(0, 200)
  return ''
}

/** 把接口返回的错误整理成用户能看懂的中文。 */
export function formatUpscaleError(status: number, payload: Record<string, unknown>): string {
  const detail = extractErrorDetail(payload)
  const lower = detail.toLowerCase()
  if (status === 403 && /api proxy path restricted/i.test(detail)) {
    return '服务器的 API 代理没有放行放大接口，请联系管理员更新代理配置'
  }
  if (status === 401) return 'API Key 无效或已被禁用，请在设置里检查'
  if (status === 403 && lower.includes('quota')) {
    return '账户余额不足。标准高清每次需要先预扣 3 元，出图后按实际尺寸退回多扣的部分'
  }
  if (status === 403) return `没有权限使用该放大模型：${detail || '请联系管理员'}`
  if (status === 503 && lower.includes('model_not_found')) return '当前账户分组没有开通该放大模型，请联系管理员'
  if (status === 504) return '等待超时，任务仍在后台处理。请稍后在历史里重试，或改用任务方式'
  if (/supports (upscale_factor|output_format)/i.test(detail)) return detail
  if (detail) return detail
  return `放大失败（HTTP ${status}）`
}

async function parseImageResult(payload: Record<string, unknown>, signal?: AbortSignal): Promise<UpscaleResult> {
  const data = Array.isArray(payload.data) ? payload.data : []
  const first = (data[0] && typeof data[0] === 'object' ? data[0] : {}) as { url?: unknown; b64_json?: unknown }
  const url = typeof first.url === 'string' ? first.url : ''
  const b64 = typeof first.b64_json === 'string' ? first.b64_json : ''
  if (!url && !b64) throw new Error('放大服务没有返回图片')

  const image = b64
    ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
    : await fetchImageUrlAsDataUrl(url, 'image/jpeg', signal)
  return { image, rawUrl: url }
}

/** 同步方式：一次调用，等到出图（最长约 600 秒）。 */
async function upscaleSync(request: UpscaleRequest): Promise<UpscaleResult> {
  const form = await buildForm(request, 'image')
  const response = await fetch(requestUrl(request.profile, 'images/edits'), {
    method: 'POST',
    headers: authHeaders(request.profile),
    body: form,
    signal: request.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw new Error(formatUpscaleError(response.status, payload))
  return parseImageResult(payload, request.signal)
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('已取消', 'AbortError'))
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('已取消', 'AbortError'))
  }, { once: true })
})

/** 任务方式：提交拿任务编号，再轮询到完成。 */
async function upscaleTask(request: UpscaleRequest): Promise<UpscaleResult> {
  let taskId = request.resumeTaskId?.trim() ?? ''
  if (!taskId) {
    const form = await buildForm(request, 'input_reference')
    const submit = await fetch(taskUrl(request.profile, 'videos'), {
      method: 'POST',
      headers: authHeaders(request.profile),
      body: form,
      signal: request.signal,
    })
    const submitted = await readJson(submit)
    if (!submit.ok) throw new Error(formatUpscaleError(submit.status, submitted))
    taskId = typeof submitted.id === 'string' ? submitted.id : ''
    if (!taskId) throw new Error('放大服务没有返回任务编号')
    request.onTaskEnqueued?.({ taskId })
  }

  const deadline = Date.now() + POLL_MAX_MS
  while (Date.now() < deadline) {
    const poll = await fetch(taskUrl(request.profile, `videos/${encodeURIComponent(taskId)}`), {
      headers: authHeaders(request.profile),
      signal: request.signal,
    })
    const payload = await readJson(poll)
    // 查询接口临时出错不等于任务失败，继续等；明确的 4xx（如任务不存在）才终止
    if (!poll.ok && (poll.status === 401 || poll.status === 403 || poll.status === 404)) {
      throw new Error(poll.status === 404 ? '放大任务不存在或已过期' : formatUpscaleError(poll.status, payload))
    }
    if (poll.ok) {
      const status = typeof payload.status === 'string' ? payload.status : ''
      if (status === 'completed') return parseImageResult(payload, request.signal)
      if (status === 'failed') {
        const error = payload.error as { message?: unknown } | undefined
        const message = typeof error?.message === 'string' ? error.message : ''
        throw new Error(message || '放大失败，已扣费用会退回')
      }
    }
    await sleep(POLL_INTERVAL_MS, request.signal)
  }
  throw new Error('等待放大结果超时，请稍后在历史里重试')
}

/** 放大一张图。默认同步；asTask 或已有任务编号时走任务方式。 */
export async function upscaleImage(request: UpscaleRequest): Promise<UpscaleResult> {
  const normalized: UpscaleRequest = { ...request, params: normalizeUpscaleParams(request.params) }
  if (!normalized.profile.apiKey.trim()) throw new Error('请先在设置里填写 API Key')
  return normalized.asTask || normalized.resumeTaskId ? upscaleTask(normalized) : upscaleSync(normalized)
}
