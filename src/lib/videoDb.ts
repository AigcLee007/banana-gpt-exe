// 视频数据库存储层

import type { VideoTaskRecord, MediaRecord, MediaPosterRecord } from './videoTypes'
import { dbTransaction } from './db'
import { createLocalId } from './localId'

const STORE_VIDEO_TASKS = 'videoTasks'
const STORE_MEDIA = 'media'
const STORE_MEDIA_POSTERS = 'mediaPosters'
const MEDIA_METADATA_TIMEOUT_MS = 10_000

// ===== Video Tasks =====

export function getAllVideoTasks(): Promise<VideoTaskRecord[]> {
  return dbTransaction(STORE_VIDEO_TASKS, 'readonly', (s) => (s as IDBObjectStore).getAll())
}

export function getVideoTask(id: string): Promise<VideoTaskRecord | undefined> {
  return dbTransaction(STORE_VIDEO_TASKS, 'readonly', (s) => (s as IDBObjectStore).get(id))
}

export function putVideoTask(task: VideoTaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_VIDEO_TASKS, 'readwrite', (s) => (s as IDBObjectStore).put(task))
}

export function deleteVideoTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_VIDEO_TASKS, 'readwrite', (s) => (s as IDBObjectStore).delete(id))
}

export function clearVideoTasks(): Promise<undefined> {
  return dbTransaction(STORE_VIDEO_TASKS, 'readwrite', (s) => (s as IDBObjectStore).clear())
}

// ===== Media =====

export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return dbTransaction(STORE_MEDIA, 'readonly', (s) => (s as IDBObjectStore).get(id))
}

export function getAllMedia(): Promise<MediaRecord[]> {
  return dbTransaction(STORE_MEDIA, 'readonly', (s) => (s as IDBObjectStore).getAll())
}

export function putMedia(media: MediaRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_MEDIA, 'readwrite', (s) => (s as IDBObjectStore).put(media))
}

export function deleteMedia(id: string): Promise<undefined> {
  return dbTransaction([STORE_MEDIA, STORE_MEDIA_POSTERS], 'readwrite', (stores) => {
    const [mediaStore, posterStore] = stores as IDBObjectStore[]
    mediaStore.delete(id)
    posterStore.delete(id)
  })
}

export function clearMedia(): Promise<undefined> {
  return dbTransaction([STORE_MEDIA, STORE_MEDIA_POSTERS], 'readwrite', (stores) => {
    const [mediaStore, posterStore] = stores as IDBObjectStore[]
    mediaStore.clear()
    posterStore.clear()
  })
}

// ===== Media Posters =====

export function getMediaPoster(id: string): Promise<MediaPosterRecord | undefined> {
  return dbTransaction(STORE_MEDIA_POSTERS, 'readonly', (s) => (s as IDBObjectStore).get(id))
}

export function putMediaPoster(poster: MediaPosterRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_MEDIA_POSTERS, 'readwrite', (s) => (s as IDBObjectStore).put(poster))
}

// ===== 辅助函数 =====

export async function hashBlob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return `fallback-${Date.now()}-${Math.random()}`
  }
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function extractVideoPoster(
  blob: Blob,
  maxSize: number = 720,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const finish = (result: { blob: Blob; width: number; height: number } | null) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }

    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.addEventListener('loadeddata', () => {
      try {
        video.currentTime = Math.min(0.5, Number.isFinite(video.duration) ? video.duration / 2 : 0)
      } catch {
        finish(null)
      }
    }, { once: true })

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas')
        let { videoWidth: w, videoHeight: h } = video
        if (w === 0 || h === 0) {
          finish(null)
          return
        }

        const scale = Math.min(1, maxSize / Math.max(w, h))
        w = Math.round(w * scale)
        h = Math.round(h * scale)
        canvas.width = w
        canvas.height = h

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finish(null)
          return
        }

        ctx.drawImage(video, 0, 0, w, h)
        canvas.toBlob(
          (posterBlob) => finish(posterBlob ? { blob: posterBlob, width: w, height: h } : null),
          'image/jpeg',
          0.9,
        )
      } catch {
        finish(null)
      }
    }, { once: true })

    video.addEventListener('error', () => finish(null), { once: true })
    timeoutId = setTimeout(() => finish(null), MEDIA_METADATA_TIMEOUT_MS)
    video.src = url
  })
}

function loadMediaMetadata(
  blob: Blob,
  element: HTMLVideoElement | HTMLAudioElement,
): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const video = element instanceof HTMLVideoElement ? element : undefined

    const finish = () => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined
      const result = {
        duration,
        width: video?.videoWidth || undefined,
        height: video?.videoHeight || undefined,
      }
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }

    element.preload = 'metadata'
    element.addEventListener('loadedmetadata', finish, { once: true })
    element.addEventListener('error', finish, { once: true })
    timeoutId = setTimeout(finish, MEDIA_METADATA_TIMEOUT_MS)
    element.src = url
  })
}

export async function getVideoDuration(blob: Blob): Promise<number | undefined> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  return (await loadMediaMetadata(blob, video)).duration
}

export async function getAudioDuration(blob: Blob): Promise<number | undefined> {
  return (await loadMediaMetadata(blob, document.createElement('audio'))).duration
}

export async function getVideoDimensions(
  blob: Blob,
): Promise<{ width: number; height: number } | undefined> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const { width, height } = await loadMediaMetadata(blob, video)
  return width && height ? { width, height } : undefined
}

export async function uploadMediaFile(
  file: File,
  source: 'upload' | 'generated' | 'extracted',
): Promise<string> {
  const id = createLocalId()
  const blob = new Blob([file], { type: file.type })
  const mime = file.type
  const size = file.size

  let duration: number | undefined
  let width: number | undefined
  let height: number | undefined
  let hash: string | undefined

  if (mime.startsWith('video/')) {
    duration = await getVideoDuration(blob)
    const dims = await getVideoDimensions(blob)
    if (dims) {
      width = dims.width
      height = dims.height
    }
    const poster = await extractVideoPoster(blob)
    if (poster) {
      await putMediaPoster({ id, blob: poster.blob, width: poster.width, height: poster.height })
    }
  } else if (mime.startsWith('audio/')) {
    duration = await getAudioDuration(blob)
  } else if (mime.startsWith('image/')) {
    const dims = await getImageDimensions(blob)
    if (dims) {
      width = dims.width
      height = dims.height
    }
    hash = await hashBlob(blob)
  }

  const media: MediaRecord = {
    id,
    blob,
    mime,
    size,
    filename: file.name || undefined,
    duration,
    width,
    height,
    source,
    uploadedAt: Date.now(),
    hash,
  }

  await putMedia(media)
  return id
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const finish = (dimensions?: { width: number; height: number }) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      img.src = ''
      URL.revokeObjectURL(url)
      resolve(dimensions)
    }
    img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : undefined)
    img.onerror = () => finish()
    timeoutId = setTimeout(() => finish(), MEDIA_METADATA_TIMEOUT_MS)
    img.src = url
  })
}

export async function getMediaBlobUrl(id: string): Promise<string | undefined> {
  const media = await getMedia(id)
  if (!media) return undefined
  return URL.createObjectURL(media.blob)
}

export async function getMediaPosterBlobUrl(id: string): Promise<string | undefined> {
  const poster = await getMediaPoster(id)
  if (!poster) return undefined
  return URL.createObjectURL(poster.blob)
}

export async function calculateMediaStorageSize(): Promise<number> {
  const allMedia = await getAllMedia()
  return allMedia.reduce((sum, m) => sum + m.size, 0)
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  const isPersisted = await navigator.storage.persisted()
  if (isPersisted) return true
  return navigator.storage.persist()
}
