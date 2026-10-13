import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { useVideoMediaMetadata } from '../hooks/useVideoMediaMetadata'
import { getMediaBlobUrl, getMediaPosterBlobUrl } from '../lib/videoDb'
import type { VideoReferenceItem } from '../lib/videoTypes'

const PREVIEW_CLOSE_DELAY_MS = 160

function formatDuration(duration?: number) {
  if (!duration || !Number.isFinite(duration)) return undefined
  const wholeSeconds = Math.max(0, Math.round(duration))
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  return minutes ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}秒`
}

function mediaLabel(type: VideoReferenceItem['type']) {
  return type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'
}

export default function ReferenceTile({ index, item, onRemove }: { index: number; item: VideoReferenceItem; onRemove: () => void }) {
  const tileRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const closePreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const url = useMediaBlobUrl(item.id, getMediaBlobUrl)
  const posterUrl = useMediaBlobUrl(item.type === 'video' ? item.id : null, getMediaPosterBlobUrl)
  const metadataById = useVideoMediaMetadata([item.id])
  const metadata = metadataById[item.id]
  const label = mediaLabel(item.type)
  const filename = metadata?.filename || `${label}素材`
  const duration = formatDuration(metadata?.duration)

  useEffect(() => () => {
    if (closePreviewTimer.current) clearTimeout(closePreviewTimer.current)
  }, [])

  useLayoutEffect(() => {
    if (!previewOpen) {
      setPreviewPosition(null)
      return
    }

    const placePreview = () => {
      const tile = tileRef.current
      const preview = previewRef.current
      if (!tile || !preview) return
      const rect = tile.getBoundingClientRect()
      const margin = 12
      const gap = 12
      const above = Math.max(0, rect.top - margin - gap)
      const below = Math.max(0, window.innerHeight - margin - rect.bottom - gap)
      const contentHeight = preview.scrollHeight + 2
      const openAbove = above >= contentHeight || above > below
      const maxHeight = Math.max(1, openAbove ? above : below)
      const height = Math.min(contentHeight, maxHeight)
      const next = {
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - preview.getBoundingClientRect().width - margin)),
        top: openAbove ? rect.top - height - gap : rect.bottom + gap,
        maxHeight,
      }
      setPreviewPosition(previous => previous?.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next)
    }

    placePreview()
    const observer = new ResizeObserver(placePreview)
    if (previewRef.current) observer.observe(previewRef.current)
    if (tileRef.current) observer.observe(tileRef.current)
    window.addEventListener('resize', placePreview)
    window.addEventListener('scroll', placePreview, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', placePreview)
      window.removeEventListener('scroll', placePreview, true)
    }
  }, [previewOpen])

  const cancelPreviewClose = () => {
    if (closePreviewTimer.current) {
      clearTimeout(closePreviewTimer.current)
      closePreviewTimer.current = null
    }
  }

  const openPreview = () => {
    cancelPreviewClose()
    setPreviewOpen(true)
  }

  const closePreview = () => {
    cancelPreviewClose()
    setPreviewOpen(false)
  }

  const schedulePreviewClose = () => {
    cancelPreviewClose()
    closePreviewTimer.current = setTimeout(() => setPreviewOpen(false), PREVIEW_CLOSE_DELAY_MS)
  }

  const toggleAudio = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setPreviewOpen(true)
      }
    } else {
      audio.pause()
    }
  }

  const preview = previewOpen && typeof document !== 'undefined' && createPortal(
    <div
      ref={previewRef}
      data-video-reference-id={item.id}
      className="fixed z-[100] w-48 overflow-y-auto rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-elevated)] p-2 shadow-xl"
      style={{ left: previewPosition?.left ?? 0, top: previewPosition?.top ?? 0, maxHeight: previewPosition?.maxHeight, visibility: previewPosition ? 'visible' : 'hidden' }}
      onMouseEnter={cancelPreviewClose}
      onMouseLeave={schedulePreviewClose}
    >
      {item.type === 'video' ? (
        <video src={url || undefined} poster={posterUrl || undefined} muted autoPlay loop playsInline className="max-h-40 w-full rounded-lg object-contain" />
      ) : item.type === 'audio' ? (
        <audio src={url || undefined} controls className="w-full" onPlay={() => setIsAudioPlaying(true)} onPause={() => setIsAudioPlaying(false)} />
      ) : url ? (
        <img src={url} alt={`${index}. ${filename}`} className="max-h-40 w-full rounded-lg object-contain" />
      ) : (
        <div className="flex h-24 items-center justify-center text-xs text-[color:var(--app-text-muted)]">素材不可用</div>
      )}
      <p className="mt-1 truncate text-xs text-[color:var(--app-text)]" title={filename}>{filename}</p>
      <p className="text-[10px] text-[color:var(--app-text-muted)]">{label}{duration ? ` · 时长 ${duration}` : ''}</p>
    </div>,
    document.body,
  )

  return (
    <>
      <div
        ref={tileRef}
        data-video-reference-id={item.id}
        className="group relative h-16 w-16 overflow-visible rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface-elevated)]"
        title={`${index}. ${label}：${filename}`}
        onMouseEnter={openPreview}
        onMouseLeave={schedulePreviewClose}
      >
        {item.type === 'audio' ? (
          <button
            type="button"
            onClick={toggleAudio}
            onFocus={openPreview}
            aria-label={`${isAudioPlaying ? '暂停' : '播放'}第 ${index} 个音频素材`}
            className="flex h-full w-full items-center justify-center rounded-lg text-xl text-[color:var(--app-text)]"
          >
            <span aria-hidden="true">{isAudioPlaying ? 'Ⅱ' : '♫'}</span>
            <audio ref={audioRef} src={url || undefined} preload="metadata" onPlay={() => setIsAudioPlaying(true)} onPause={() => setIsAudioPlaying(false)} onEnded={() => setIsAudioPlaying(false)} />
          </button>
        ) : item.type === 'video' ? (
          <video src={url || undefined} poster={posterUrl || undefined} muted playsInline preload="metadata" className="h-full w-full rounded-lg object-cover" aria-label={`${index}. ${label}`} />
        ) : url ? (
          <img src={url} alt={`${index}. ${label}`} className="h-full w-full rounded-lg object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[color:var(--app-text-muted)]">素材不可用</div>
        )}
        <span className="absolute -left-1 -top-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" aria-label={`参考素材 ${index}`}>{index}</span>
        {duration && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">{duration}</span>}
        <button type="button" onClick={() => { closePreview(); onRemove() }} aria-label={`删除第 ${index} 个${label}素材`} className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-xs text-white hover:bg-black">×</button>
      </div>
      {preview}
    </>
  )
}
