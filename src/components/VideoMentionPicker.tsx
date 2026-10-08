import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import type { VideoMediaMetadata } from '../hooks/useVideoMediaMetadata'
import { getMediaBlobUrl, getMediaPosterBlobUrl } from '../lib/videoDb'
import { labelVideoReferences } from '../lib/videoPromptMentions'
import type { VideoReferenceItem, VideoReferenceType } from '../lib/videoTypes'

export function videoMediaTypeLabel(type: VideoReferenceType) {
  return type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'
}

/** Shared by picker tiles and inline chips; URLs are released by the existing hook. */
export function VideoMentionThumbnail({ item, removed = false }: { item: VideoReferenceItem; removed?: boolean }) {
  const url = useMediaBlobUrl(!removed && item.type === 'image' ? item.id : null, getMediaBlobUrl)
  const poster = useMediaBlobUrl(!removed && item.type === 'video' ? item.id : null, getMediaPosterBlobUrl)
  const src = item.type === 'video' ? poster : url
  return src
    ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <span aria-hidden="true">{removed ? '×' : item.type === 'audio' ? '♪' : item.type === 'video' ? '▶' : '▧'}</span>
}

export interface VideoMentionPickerHandle {
  /** Also called by the editor, which retains focus until the user clicks search. */
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean
}

export interface VideoMentionPickerProps {
  id?: string
  anchor: { left: number; top: number; bottom: number }
  references: VideoReferenceItem[]
  metadata: Record<string, VideoMediaMetadata>
  library?: VideoReferenceItem[]
  query: string
  onQueryChange: (query: string) => void
  onPick: (item: VideoReferenceItem, source: 'current' | 'library') => void | Promise<void>
  onClose: () => void
  canAddLibrary?: boolean
  busy?: boolean
  error?: string
  editorElement?: HTMLElement | null
}

interface Candidate {
  item: VideoReferenceItem
  label: string
  filename: string
  source: 'current' | 'library'
}

const pickerCss = `
.vmp-popup{position:fixed;z-index:200;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--app-border,#394150);border-radius:12px;background:var(--app-surface-elevated,#202631);color:var(--app-text,#f3f4f6);box-shadow:0 12px 40px #0004;font-family:inherit;font-size:13px;line-height:1.5;overflow:hidden}
.vmp-search{box-sizing:border-box;width:100%;border:0;border-bottom:1px solid var(--app-border,#394150);background:var(--app-input,#171d27);color:inherit;padding:11px 12px;outline:none;font:inherit;flex-shrink:0}
.vmp-search:focus{box-shadow:inset 0 -2px #22c55e}
.vmp-scroll{overflow:auto;min-height:0;padding:8px;overscroll-behavior:contain}
.vmp-heading{margin:4px 4px 7px;color:var(--app-text-muted,#a4adbb);font-size:11px;font-weight:600}
.vmp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px}
.vmp-option{display:flex;align-items:center;gap:8px;min-width:0;padding:7px;border:1px solid transparent;border-radius:8px;background:var(--app-input,#171d27);color:inherit;text-align:left;font:inherit;cursor:pointer}
.vmp-option[data-active=true]{border-color:#22c55e;background:var(--app-surface,#27342c)}
.vmp-option:disabled{opacity:.45;cursor:not-allowed}
.vmp-thumb{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:6px;overflow:hidden;background:var(--app-surface,#293140);font-size:19px}
.vmp-copy{min-width:0;flex:1}.vmp-filename{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.vmp-label{display:block;color:var(--app-text-muted,#a4adbb);font-size:11px}
.vmp-empty{padding:10px;color:var(--app-text-muted,#a4adbb);font-size:12px}
.vmp-footer{flex-shrink:0;border-top:1px solid var(--app-border,#394150);padding:8px 12px;color:var(--app-text-muted,#a4adbb);font-size:11px}
.vmp-error{color:#f87171;padding:0 12px 8px;font-size:12px}
`

const VideoMentionPicker = forwardRef<VideoMentionPickerHandle, VideoMentionPickerProps>(function VideoMentionPicker({
  id, anchor, references, metadata, library = [], query, onQueryChange, onPick, onClose,
  canAddLibrary = false, busy = false, error, editorElement,
}, ref) {
  const generatedId = useId()
  const popupId = id ?? `video-mention-${generatedId}`
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.bottom + 6, width: 420, maxHeight: 360 })
  const candidates = useMemo(() => {
    const currentIds = new Set(references.map(item => item.id))
    const seen = new Set<string>()
    const current: Candidate[] = labelVideoReferences(references).map(item => ({
      item, label: item.label, filename: metadata[item.id]?.filename || `${videoMediaTypeLabel(item.type)}素材`, source: 'current',
    }))
    const saved: Candidate[] = library.filter(item => {
      if (currentIds.has(item.id) || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    }).map(item => ({ item, label: videoMediaTypeLabel(item.type), filename: metadata[item.id]?.filename || `素材 ${item.id.slice(0, 8)}`, source: 'library' }))
    const needle = query.trim().toLocaleLowerCase()
    const matches = (candidate: Candidate) => !needle || `${candidate.filename} ${candidate.label} ${videoMediaTypeLabel(candidate.item.type)}`.toLocaleLowerCase().includes(needle)
    return { current: current.filter(matches), saved: saved.filter(matches) }
  }, [references, library, metadata, query])
  const selectable = [...candidates.current, ...(canAddLibrary ? candidates.saved : [])]
  const keyOf = (candidate: Candidate) => `${candidate.source}:${candidate.item.id}`
  const foundIndex = selectable.findIndex(candidate => keyOf(candidate) === activeKey)
  const activeIndex = foundIndex < 0 ? 0 : foundIndex
  const active = selectable[activeIndex]

  useLayoutEffect(() => {
    const place = () => {
      const viewport = window.visualViewport
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8
      const topEdge = (viewport?.offsetTop ?? 0) + 8
      const width = Math.max(1, Math.min(420, (viewport?.width ?? window.innerWidth) - 16))
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16
      const below = Math.max(0, bottomEdge - anchor.bottom - 6)
      const above = Math.max(0, anchor.top - topEdge - 6)
      const openAbove = below < 280 && above > below
      const maxHeight = Math.max(1, Math.min(360, Math.max(above, below), bottomEdge - topEdge))
      const height = Math.min(rootRef.current?.getBoundingClientRect().height ?? 360, maxHeight)
      const next = {
        left: Math.max(leftEdge, Math.min(anchor.left, leftEdge + (viewport?.width ?? window.innerWidth) - 16 - width)),
        top: Math.max(topEdge, Math.min(openAbove ? anchor.top - height - 6 : anchor.bottom + 6, bottomEdge - height)),
        width, maxHeight,
      }
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next)
    }
    place()
    const observer = new ResizeObserver(place)
    if (rootRef.current) observer.observe(rootRef.current)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [anchor])

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeKey, activeIndex, query])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !editorElement?.contains(event.target)) onClose()
    }
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !editorElement?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
    }
  }, [onClose, editorElement])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      editorElement?.focus({ preventScroll: true })
      return true
    }
    const rowStep = selectable.length > 2 ? 2 : 1
    const delta = event.key === 'ArrowDown' ? rowStep : event.key === 'ArrowUp' ? -rowStep
      : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta) {
      event.preventDefault()
      if (!busy && selectable.length) {
        const index = ((activeIndex + delta) % selectable.length + selectable.length) % selectable.length
        setActiveKey(keyOf(selectable[index]))
      }
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      if (active && !busy) void onPick(active.item, active.source)
      return true
    }
    return false
  }
  useImperativeHandle(ref, () => ({ handleKeyDown }))

  const section = (items: Candidate[], title: string) => (
    <section aria-label={title}>
      <h3 className="vmp-heading">{title}</h3>
      {items.length ? <div className="vmp-grid">{items.map(candidate => {
        const selected = !!active && keyOf(candidate) === keyOf(active)
        return (
          <button type="button" role="option" aria-selected={selected} key={keyOf(candidate)}
            className="vmp-option" data-active={selected} tabIndex={-1}
            disabled={busy || (candidate.source === 'library' && !canAddLibrary)}
            title={candidate.filename} onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setActiveKey(keyOf(candidate))}
            onClick={() => void onPick(candidate.item, candidate.source)}>
            <span className="vmp-thumb"><VideoMentionThumbnail item={candidate.item} /></span>
            <span className="vmp-copy"><span className="vmp-filename">{candidate.filename}</span>
              <span className="vmp-label">{candidate.source === 'current' ? `@${candidate.label}` : candidate.label}</span></span>
          </button>
        )
      })}</div> : <p className="vmp-empty">{query ? '没有匹配的素材' : '暂无素材'}</p>}
    </section>
  )

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={rootRef} id={popupId} className="vmp-popup" style={position} role="dialog" aria-label="引用媒体素材" aria-busy={busy}
      onKeyDown={handleKeyDown}>
      <style>{pickerCss}</style>
      <input className="vmp-search" value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索当前素材和资产库" aria-label="搜索媒体素材" />
      <div className="vmp-scroll" role="listbox" aria-label="可引用素材">
        {section(candidates.current, `当前素材 · ${references.length}`)}
        {section(candidates.saved, '本地素材库')}
        {!canAddLibrary && candidates.saved.length > 0 && <p className="vmp-empty">暂不支持添加素材库引用</p>}
      </div>
      {error && <p className="vmp-error" role="alert">{error}</p>}
      <div className="vmp-footer">{busy ? '正在添加素材…' : '↑ ↓ ← → 选择 · Enter / Tab 插入 · Esc 关闭'}</div>
    </div>, document.body,
  )
})

export default VideoMentionPicker
