// 视频任务卡片组件

import { useState, useEffect } from 'react'
import { useVideoStore } from '../videoStore'
import type { VideoTaskRecord } from '../lib/videoTypes'
import { formatVideoMode, formatVideoResolution } from '../lib/videoModels'
import { getMediaPosterBlobUrl, getMediaBlobUrl } from '../lib/videoDb'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { serializeVideoPrompt } from '../lib/videoPromptMentions'
import { formatVideoTaskError } from '../lib/videoApi'

interface VideoTaskCardProps {
  task: VideoTaskRecord
}

export default function VideoTaskCard({ task }: VideoTaskCardProps) {
  const { selectedTaskIds, toggleSelectTask, setDetailTask } = useVideoStore()
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const videoUrl = useMediaBlobUrl(task.outputVideoId, getMediaBlobUrl)
  const posterSource = posterUrl || (!task.posterImageId ? null : null)

  const isSelected = selectedTaskIds.has(task.id)
  const errorMessage = task.error ? formatVideoTaskError(task.error) : null

  useEffect(() => {
    let active = true
    let url: string | undefined
    setPosterUrl(null)
    if (!task.posterImageId) return () => undefined
    getMediaPosterBlobUrl(task.posterImageId).then((nextUrl) => {
      if (active && nextUrl) {
        url = nextUrl
        setPosterUrl(nextUrl)
      } else if (nextUrl) {
        URL.revokeObjectURL(nextUrl)
      }
    })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [task.posterImageId])

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelectTask(task.id)
    } else {
      setDetailTask(task.id)
    }
  }

  const statusLabel =
    task.status === 'queued'
      ? '排队中'
      : task.status === 'running'
      ? `生成中 ${task.progress || 0}%`
      : task.status === 'error'
      ? '失败'
      : task.status === 'canceled'
      ? '已取消'
      : ''

  const elapsed = task.finishedAt
    ? Math.round((task.finishedAt - task.createdAt) / 1000)
    : Math.round((Date.now() - task.createdAt) / 1000)

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{ aspectRatio: task.params.aspectRatio === '16:9' ? '16/9' : '1' }}
    >
      {/* 封面或占位符 */}
      {posterUrl ? (
        <img src={posterUrl} alt="封面" className="h-full w-full object-cover" />
      ) : videoUrl ? (
        <video src={videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[color:var(--app-surface-elevated)] text-sm text-[color:var(--app-text-muted)]">
          <div className="max-w-[90%] text-center">
            <div>{task.status === 'done' ? '视频预览不可用' : statusLabel}</div>
            {task.status === 'error' && errorMessage && <div className="mt-2 break-words text-xs text-red-500" title={errorMessage}>{errorMessage}</div>}
          </div>
        </div>
      )}

      {/* 悬停时播放视频 */}
      {isHovering && videoUrl && (
        <video
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-xl text-white">▶</span>
      </div>
      {task.status === 'done' && (
        <div className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-xs text-white">▶ 播放</div>
      )}

      <label className="absolute left-2 top-2 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-black/60 text-white" onClick={(e) => e.stopPropagation()} aria-label={isSelected ? '取消选择任务' : '选择任务'}>
        <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTask(task.id)} className="h-4 w-4 accent-blue-500" />
      </label>
      {task.status !== 'done' && (
        <div className="absolute left-2 top-10 z-10 rounded-full bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {statusLabel}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-8 text-white">
        <div className="truncate text-sm font-medium">{serializeVideoPrompt(task.prompt, task.inputs.refItems ?? [], false) || '无提示词'}</div>
        <div className="mt-1 text-xs text-white/75">{formatVideoMode(task.mode)} · {task.params.duration}s · {formatVideoResolution(task.params.resolution)}</div>
      </div>

      {/* 收藏标记 */}
      {task.isFavorite && (
        <div className="absolute top-2 right-2">
          <span className="text-yellow-400 text-lg">★</span>
        </div>
      )}

      {/* 选中标记 */}
      {isSelected && (
        <div className="absolute top-2 left-2">
          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
