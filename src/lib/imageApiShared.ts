import type { ApiProfile, AppMode, AppSettings, TaskParams } from '../types'
import { DEFAULT_SVG_MODEL, supportsGptImage26Params } from './imageModels'

export const STREAMING_UNSUPPORTED_HINT = ' 当前服务端可能不支持流式图片返回，可尝试关闭「流式传输」后重试。'
export const STREAMING_FORMAT_HINT = ' 流式图片通常仅支持 PNG，请尝试将输出格式切换为 PNG 后重试。'

export function appendStreamingUnsupportedHint(message: string): string {
  return `${message}${STREAMING_UNSUPPORTED_HINT}`
}

export function appendStreamingFormatHint(message: string): string {
  return `${message}${STREAMING_FORMAT_HINT}`
}

export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (streamImages !== true) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429) return message
  if (status >= 500 && status < 600) return message
  return appendStreamingUnsupportedHint(message)
}

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
}

export function applyGptImage26Params(target: Record<string, unknown>, params: TaskParams, profile: ApiProfile) {
  if (!supportsGptImage26Params(profile)) return
  if (params.complexity && params.complexity !== 'auto') target.complexity = params.complexity
  if (params.output_format === 'svg') target.svg = { model: profile.svgModel?.trim() || DEFAULT_SVG_MODEL }
  if (params.output_format === 'gif') {
    target.frame_count = params.frame_count ?? 9
    target.frame_duration_ms = params.frame_duration_ms ?? 200
  }
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  sourceMode?: AppMode
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  nativeTransparentBackground?: boolean
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  resumeMidjourneyTaskId?: string
  onMidjourneySubmitting?: () => Promise<void>
  onMidjourneyTaskEnqueued?: (task: { taskId: string }) => Promise<void>
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  const source = /^data:/i.test(value) ? value : `data:${fallbackMime};base64,${value}`
  const format = detectImageOutputFormat(source)
  return format ? source.replace(/^data:[^;,]*/i, `data:${MIME_MAP[format]}`) : source
}

/** Inspect file signatures; a requested format or Content-Type is not proof of
 * what the upstream actually generated. Remote URLs remain unverified. */
export function detectImageOutputFormat(source: string): TaskParams['output_format'] | null {
  const match = /^data:([^,]*),(.*)$/is.exec(source)
  if (!match) return null
  try {
    const base64 = /;base64(?:;|$)/i.test(match[1])
    const payload = base64 ? match[2].replace(/\s/g, '') : decodeURIComponent(match[2])
    const prefix = base64 ? atob(payload.slice(0, 32)) : payload.slice(0, 12)
    if (prefix.startsWith('\x89PNG\r\n\x1a\n')) return 'png'
    if (prefix.startsWith('\xff\xd8\xff')) return 'jpeg'
    if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'webp'
    if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'gif'
    const xml = (base64 ? atob(payload) : payload).replace(/^(?:\xef\xbb\xbf|\ufeff)/, '')
    let offset = 0
    // Read the complete prolog: valid SVGs can have long comments, a DOCTYPE
    // internal subset, and namespace-prefixed root elements.
    while (offset < xml.length) {
      while (/\s/.test(xml[offset] ?? '') && offset < xml.length) offset++
      if (xml.startsWith('<?', offset) || xml.startsWith('<!--', offset)) {
        const terminator = xml.startsWith('<?', offset) ? '?>' : '-->'
        const end = xml.indexOf(terminator, offset + 2)
        if (end < 0) return null
        offset = end + terminator.length
      } else if (xml.startsWith('<!DOCTYPE', offset)) {
        let quote = ''
        let subsetDepth = 0
        offset += 9
        for (; offset < xml.length; offset++) {
          const char = xml[offset]
          if (quote) { if (char === quote) quote = '' }
          else if (char === '"' || char === "'") quote = char
          else if (char === '[') subsetDepth++
          else if (char === ']') subsetDepth--
          else if (char === '>' && subsetDepth === 0) { offset++; break }
        }
      } else {
        return /^<(?:[A-Za-z_][\w.-]*:)?svg(?:\s|\/?>)/.test(xml.slice(offset)) ? 'svg' : null
      }
    }
  } catch {
    // Invalid base64 or percent encoding cannot identify an image format.
  }
  return null
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return normalizeBase64Image(btoa(binary), blob.type || fallbackMime)
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<string> {
  if (isDataUrl(url)) return normalizeBase64Image(url, fallbackMime)

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...(headers ? { headers } : {}),
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`)
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`)
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  try {
    const errJson = await response.json()
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail)) errorMsg = errJson.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
  } catch {
    try {
      errorMsg = await response.text()
    } catch {
      /* ignore */
    }
  }
  return errorMsg
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high' || record.quality === 'xhigh' || record.quality === 'max') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp' || record.output_format === 'gif' || record.output_format === 'svg') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n
  if (record.complexity === 'auto' || record.complexity === 'low' || record.complexity === 'medium' || record.complexity === 'high') actualParams.complexity = record.complexity
  if (typeof record.frame_count === 'number') actualParams.frame_count = record.frame_count
  if (typeof record.frame_duration_ms === 'number') actualParams.frame_duration_ms = record.frame_duration_ms

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
