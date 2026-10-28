import { useState, useEffect } from 'react'
import { useVideoStore } from '../videoStore'
import type { VideoTaskRecord } from '../lib/videoTypes'
import { formatVideoMode, formatVideoResolution } from '../lib/videoModels'
import { getMediaPosterBlobUrl, getMediaBlobUrl } from '../lib/videoDb'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { serializeVideoPrompt } from '../lib/videoPromptMentions'
import { formatVideoTaskError } from '../lib/videoApi'

export default function VideoTaskCard({ task }: { task: VideoTaskRecord }) {
  const { selectedTaskIds, toggleSelectTask, setDetailTask, cancelTask, reuseTaskConfig } = useVideoStore()
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const videoUrl = useMediaBlobUrl(task.outputVideoId, getMediaBlobUrl)
  const isSelected = selectedTaskIds.has(task.id)
  const active = task.status === 'queued' || task.status === 'running'
  const processing = active && task.processing
  const progress = !processing && task.status === 'running' && typeof task.progress === 'number' && Number.isFinite(task.progress)
    ? Math.min(100, Math.max(0, Math.round(task.progress))) : undefined
  const errorMessage = task.error ? formatVideoTaskError(task.error) : null
  const statusLabel = task.status === 'done' ? '已完成' : task.status === 'error' ? '生成失败'
    : task.status === 'canceled' ? '已停止跟踪' : processing ? '处理中'
    : task.status === 'queued' ? '排队中' : `生成中${progress === undefined ? '' : ` ${progress}%`}`
  const statusTone = task.status === 'done' ? 'bg-emerald-500/15 text-emerald-600 [.dark_&]:text-emerald-300'
    : task.status === 'error' ? 'bg-red-500/10 text-red-600 [.dark_&]:text-red-300'
    : active ? 'bg-blue-500/10 text-blue-600 [.dark_&]:text-blue-300'
    : 'bg-[color:var(--app-surface-elevated)] text-[color:var(--app-text-muted)]'

  useEffect(() => {
    let mounted = true
    let url: string | undefined
    setPosterUrl(null)
    if (!task.posterImageId) return () => undefined
    getMediaPosterBlobUrl(task.posterImageId).then((nextUrl) => {
      if (mounted && nextUrl) { url = nextUrl; setPosterUrl(nextUrl) }
      else if (nextUrl) URL.revokeObjectURL(nextUrl)
    }).catch(() => { /* A missing poster still allows the local video preview. */ })
    return () => { mounted = false; if (url) URL.revokeObjectURL(url) }
  }, [task.posterImageId])

  const openTask = (event: React.MouseEvent) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelectTask(task.id)
    else setDetailTask(task.id)
  }

  return (
    <article data-video-task={task.id} aria-busy={active} className={`group min-w-0 overflow-hidden rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] shadow-sm transition-shadow hover:shadow-lg ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="relative overflow-hidden bg-[color:var(--app-surface-elevated)]" style={{ aspectRatio: '16/9' }} onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}>
        <button type="button" onClick={openTask} aria-label={task.status === 'done' && videoUrl ? '播放视频' : '查看视频任务'} className="absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400">
          {posterUrl ? <img src={posterUrl} alt="视频封面" className="h-full w-full object-contain" />
            : videoUrl ? <video src={videoUrl} muted playsInline preload="metadata" className="h-full w-full object-contain" />
            : <span className="flex h-full flex-col items-center justify-center gap-3 px-5 text-sm text-[color:var(--app-text-muted)]">
              {active ? <span aria-hidden="true" className="h-7 w-7 rounded-full border-2 border-blue-500/20 border-t-blue-500 motion-safe:animate-spin" /> : <span aria-hidden="true" className="text-3xl">{task.status === 'error' ? '!' : '▧'}</span>}
              <span>{processing ? '正在下载并保存视频' : task.status === 'queued' ? '任务已提交，等待生成' : task.status === 'running' ? '画面正在生成，请稍候' : task.status === 'done' ? '视频预览不可用' : task.status === 'error' ? '本次未能生成视频' : '已停止本机任务跟踪'}</span>
              {active && progress !== undefined && <span role="progressbar" aria-label="视频生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1.5 w-32 overflow-hidden rounded-full bg-blue-500/15"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} /></span>}
            </span>}
          {isHovering && videoUrl && <video src={videoUrl} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-contain" />}
          {task.status === 'done' && videoUrl && <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-xl text-white">▶</span></span>}
        </button>
        <label className="absolute left-3 top-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-black/55 text-white" aria-label={isSelected ? '取消选择任务' : '选择任务'}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTask(task.id)} className="h-4 w-4 accent-blue-500" />
        </label>
        {task.isFavorite && <span aria-label="已收藏" className="absolute right-3 top-3 text-lg text-yellow-400">★</span>}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2"><span role="status" className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone}`}>{statusLabel}</span><span className="text-xs text-[color:var(--app-text-muted)]">{task.params.duration}s · {formatVideoResolution(task.params.resolution)} · {task.params.aspectRatio}</span></div>
        <button type="button" onClick={openTask} className="block w-full truncate text-left text-sm font-medium text-[color:var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" title={serializeVideoPrompt(task.prompt, task.inputs.refItems ?? [], false)}>{serializeVideoPrompt(task.prompt, task.inputs.refItems ?? [], false) || '无提示词'}</button>
        <div className="text-xs text-[color:var(--app-text-muted)]">{formatVideoMode(task.mode)}</div>
        {task.status === 'error' && errorMessage && <p className="line-clamp-2 break-words text-xs leading-relaxed text-red-500" title={errorMessage}>{errorMessage}</p>}
        {active && <div><button type="button" onClick={() => cancelTask(task.id)} className="rounded-lg border border-[color:var(--app-border)] px-3 py-1.5 text-xs text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)]">停止跟踪</button><p className="mt-2 text-[11px] leading-relaxed text-[color:var(--app-text-muted)]">仅停止本机跟踪，上游任务与计费可能继续。</p></div>}
        {(task.status === 'error' || task.status === 'canceled') && <button type="button" onClick={() => { reuseTaskConfig(task.id); document.querySelector('[data-video-creation-panel]')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) }} className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-500/20 [.dark_&]:text-blue-300">调整后重试</button>}
      </div>
    </article>
  )
}
