import { getMedia } from './videoDb'
import type { VideoTaskRecord } from './videoTypes'

const MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/ogg': 'ogv',
  'video/mpeg': 'mpeg',
  'video/x-msvideo': 'avi',
  'video/x-m4v': 'm4v',
  'video/mp2t': 'ts',
}
const OBJECT_URL_REVOKE_DELAY_MS = 60_000

export interface DownloadVideosResult {
  successCount: number
  skipCount: number
  failCount: number
}

/** Export only locally stored outputs; never fall back to remote URLs or APIs. */
export async function downloadVideoTasks(tasks: VideoTaskRecord[]): Promise<DownloadVideosResult> {
  const result: DownloadVideosResult = { successCount: 0, skipCount: 0, failCount: 0 }

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    if (task.status !== 'done' || !task.outputVideoId) {
      result.skipCount++
      continue
    }

    try {
      const media = await getMedia(task.outputVideoId)
      if (!media || !(media.blob instanceof Blob) || media.blob.size === 0) {
        result.failCount++
        continue
      }

      const mime = (media.blob.type || media.mime).split(';')[0].trim().toLowerCase()
      const subtype = mime.startsWith('video/') ? mime.slice('video/'.length) : ''
      const extension = MIME_EXTENSIONS[mime] ?? (/^[a-z0-9]+$/.test(subtype) ? subtype : 'bin')
      const taskId = task.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      triggerBlobDownload(media.blob, `video-${taskId}-${index + 1}.${extension}`)
      result.successCount++
    } catch {
      result.failCount++
    }
  }

  return result
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Give the browser time to consume the blob, including on click failure.
    window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
  }
}
