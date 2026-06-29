import { ensureImageCached, useStore } from '../store'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const OBJECT_URL_REVOKE_DELAY_MS = 60_000

export interface DownloadImagesResult {
  successCount: number
  failCount: number
}

export interface DownloadImagesOptions {
  apiKey?: string
}

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images', options: DownloadImagesOptions = {}): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0 }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const imageId = imageIds[index]
      const src = await resolveImageSource(imageId)
      const order = String(index + 1).padStart(2, '0')
      const baseName = multiple ? `${fileNameBase}-${order}` : fileNameBase

      if (shouldOpenInNewTab(src)) {
        openImageInNewTab(src)
        successCount++
        if (multiple) await delay(100)
        continue
      }

      const blob = await getImageBlob(getDownloadFetchUrl(src), getDownloadRequestInit(src, imageId, options))
      triggerBlobDownload(blob, `${baseName}.${getBlobExtension(blob)}`)

      successCount++
      if (multiple) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

async function resolveImageSource(imageIdOrUrl: string): Promise<string> {
  if (isDataUrl(imageIdOrUrl) || isHttpUrl(imageIdOrUrl)) return imageIdOrUrl
  return await ensureImageCached(imageIdOrUrl) ?? imageIdOrUrl
}

async function getImageBlob(src: string, init?: RequestInit): Promise<Blob> {
  const res = init ? await fetch(src, init) : await fetch(src)
  const contentType = res.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!res.ok && !isDataUrl(src)) throw new Error('读取图片失败')
  if (!isDataUrl(src) && !contentType.startsWith('image/')) throw new Error('读取图片失败')
  return await res.blob()
}

function getDownloadFetchUrl(src: string): string {
  return isHttpUrl(src) ? `/download-proxy?url=${src}` : src
}

function getDownloadRequestInit(src: string, imageIdOrUrl: string, options: DownloadImagesOptions): RequestInit | undefined {
  const apiKey = shouldForwardDownloadApiKey(src) ? (options.apiKey?.trim() || getTaskApiKeyForImage(imageIdOrUrl)) : ''
  return apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined
}

function shouldForwardDownloadApiKey(src: string): boolean {
  return src.startsWith('https://visionary.beer/')
}

function shouldOpenInNewTab(src: string): boolean {
  return src.startsWith('https://visionary.beer/')
}

function openImageInNewTab(src: string) {
  window.open(src, '_blank', 'noopener,noreferrer')
}

function getTaskApiKeyForImage(imageId: string): string {
  if (isDataUrl(imageId) || isHttpUrl(imageId)) return ''
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.outputImages?.includes(imageId) || item.transparentOriginalImages?.includes(imageId) || item.streamPartialImageIds?.includes(imageId))
  if (!task?.apiProfileId) return ''
  const profile = settings.profiles.find((item) => item.id === task.apiProfileId)
  return profile?.apiKey?.trim() ?? ''
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  triggerDirectDownload(url, fileName)
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
}

function triggerDirectDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function getBlobExtension(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()] ?? blob.type.split('/')[1] ?? 'png'
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
