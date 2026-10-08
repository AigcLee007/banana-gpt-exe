import { useEffect, useState } from 'react'
import { getMedia } from '../lib/videoDb'

export interface VideoMediaMetadata {
  id: string
  filename?: string
  mime?: string
  duration?: number
  width?: number
  height?: number
}

const metadataCache = new Map<string, VideoMediaMetadata>()

function fallbackFilename(id: string, fallback?: string) {
  return fallback || `素材 ${id.slice(0, 8)}`
}

async function getCachedMetadata(id: string): Promise<VideoMediaMetadata> {
  const cached = metadataCache.get(id)
  if (cached) return cached
  const media = await getMedia(id)
  const metadata: VideoMediaMetadata = {
    id,
    filename: media?.filename,
    mime: media?.mime,
    duration: media?.duration,
    width: media?.width,
    height: media?.height,
  }
  metadataCache.set(id, metadata)
  return metadata
}

/**
 * Loads only the requested media records, keyed by ID. Blob data stays in IndexedDB;
 * callers receive lightweight metadata suitable for reference trays.
 */
export function useVideoMediaMetadata(
  ids: readonly (string | null | undefined)[],
  filenameFallback?: (id: string) => string | undefined,
): Record<string, VideoMediaMetadata> {
  const idsKey = Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).sort().join('|')
  const [metadata, setMetadata] = useState<Record<string, VideoMediaMetadata>>({})

  useEffect(() => {
    const requestedIds = idsKey ? idsKey.split('|') : []
    let active = true
    if (!requestedIds.length) {
      setMetadata({})
      return () => undefined
    }

    Promise.all(requestedIds.map((id) => getCachedMetadata(id))).then((records) => {
      if (!active) return
      const next: Record<string, VideoMediaMetadata> = {}
      for (const media of records) {
        next[media.id] = {
          ...media,
          filename: media.filename || fallbackFilename(media.id, filenameFallback?.(media.id)),
        }
      }
      setMetadata(next)
    }).catch(() => {
      if (!active) return
      setMetadata(Object.fromEntries(requestedIds.map((id) => [id, { id, filename: fallbackFilename(id, filenameFallback?.(id)) }])))
    })

    return () => { active = false }
  }, [filenameFallback, idsKey])

  return metadata
}
