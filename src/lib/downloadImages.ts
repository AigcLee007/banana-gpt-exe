import { ensureImageCached } from '../store'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface DownloadImagesResult {
  successCount: number
  failCount: number
}

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0 }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const src = await resolveImageSource(imageIds[index])
      const order = String(index + 1).padStart(2, '0')
      const baseName = multiple ? `${fileNameBase}-${order}` : fileNameBase

      try {
        const blob = await getImageBlob(getDownloadFetchUrl(src))
        triggerBlobDownload(blob, `${baseName}.${getBlobExtension(blob)}`)
      } catch (err) {
        if (!isHttpUrl(src)) throw err
        triggerDirectDownload(src, `${baseName}.${getUrlExtension(src)}`)
      }

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

async function getImageBlob(src: string): Promise<Blob> {
  const res = await fetch(src)
  if (!res.ok && !isDataUrl(src)) throw new Error('读取图片失败')
  return await res.blob()
}

function getDownloadFetchUrl(src: string): string {
  return isHttpUrl(src) ? `/download-proxy?url=${encodeURIComponent(src)}` : src
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  triggerDirectDownload(url, fileName)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function triggerDirectDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  if (isHttpUrl(url)) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function getBlobExtension(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()] ?? blob.type.split('/')[1] ?? 'png'
}

function getUrlExtension(url: string): string {
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase()
    return ext && /^[a-z0-9]+$/.test(ext) ? ext : 'png'
  } catch {
    return 'png'
  }
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
