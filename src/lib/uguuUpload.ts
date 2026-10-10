import type { MediaRecord } from './videoTypes'

const UPLOAD_TIMEOUT_MS = 120_000
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
}

function uploadEndpoint(): string {
  const protocol = typeof window === 'undefined' ? '' : window.location.protocol
  if (protocol === 'app:') return 'app://local/media-upload/uguu'
  if (protocol === 'file:') throw new Error('请通过桌面安装版或网页服务启动后上传素材')
  return '/media-upload/uguu'
}

function uploadFilename(media: MediaRecord): string {
  const name = media.filename
  if (name && name.trim() && name.length <= 200 && !/[\\/\u0000-\u001f\u007f]/.test(name) && name !== '.' && name !== '..') return name
  return `media.${EXTENSIONS[media.mime.toLowerCase()] ?? EXTENSIONS[media.blob.type.toLowerCase()] ?? 'bin'}`
}

function responseUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (record.success !== true || !Array.isArray(record.files) || record.files.length !== 1) return undefined
  const file = record.files[0]
  if (!file || typeof file !== 'object' || typeof file.url !== 'string' || /[\s\u0000-\u001f\u007f]/.test(file.url)) return undefined
  try {
    const url = new URL(file.url)
    if (url.protocol !== 'https:' || url.username || url.password || (url.hostname !== 'uguu.se' && !url.hostname.endsWith('.uguu.se'))) return undefined
    return file.url
  } catch { return undefined }
}

/** Uploads the local blob afresh; temporary public URLs are never cached or persisted. */
export async function uploadUguuMedia(media: MediaRecord, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const endpoint = uploadEndpoint()
  const body = new FormData()
  body.append('files[]', media.blob, uploadFilename(media))
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  let response: Response
  let payload: unknown
  try {
    try {
      response = await fetch(endpoint, { method: 'POST', body, credentials: 'omit', signal: controller.signal })
    } catch {
      signal?.throwIfAborted()
      throw new Error(controller.signal.aborted ? '素材上传超时，请稍后重试' : '素材上传失败，请检查网络后重试')
    }
    signal?.throwIfAborted()
    if (!response.ok) throw new Error('素材上传失败，请稍后重试')
    try { payload = await response.json() }
    catch {
      signal?.throwIfAborted()
      throw new Error(controller.signal.aborted ? '素材上传超时，请稍后重试' : '素材上传失败，未收到有效的素材链接')
    }
    signal?.throwIfAborted()
    const url = responseUrl(payload)
    if (!url) throw new Error('素材上传失败，未收到有效的素材链接')
    return url
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel) }
}
