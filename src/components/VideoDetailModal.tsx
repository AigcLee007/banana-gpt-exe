// 视频详情弹窗组件

import { useEffect, useState, useRef } from 'react'
import { useVideoStore } from '../videoStore'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { getMediaBlobUrl } from '../lib/videoDb'
import { formatVideoMode, formatVideoResolution, getVideoModelDefinition } from '../lib/videoModels'
import { CloseIcon } from './icons'
import { serializeVideoPrompt } from '../lib/videoPromptMentions'
import { formatVideoTaskError } from '../lib/videoApi'

export default function VideoDetailModal() {
  const {
    detailTaskId,
    tasks,
    setDetailTask,
    toggleFavorite,
    deleteTask,
    cancelTask,
    reuseTaskConfig,
  } = useVideoStore()

  const videoRef = useRef<HTMLVideoElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(Boolean(detailTaskId), () => setDetailTask(null))
  usePreventBackgroundScroll(Boolean(detailTaskId), modalRef)

  const task = tasks.find((t) => t.id === detailTaskId)

  const videoUrl = useMediaBlobUrl(task?.outputVideoId, getMediaBlobUrl)

  if (!task) return null

  const handleClose = () => {
    setDetailTask(null)
  }

  const handleDownload = async () => {
    if (!videoUrl) return
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = `video-${task.id}.mp4`
    a.click()
  }

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(serializeVideoPrompt(task.prompt, task.inputs.refItems ?? [], false))
  }

  const handleReuseConfig = () => {
    reuseTaskConfig(task.id)
    handleClose()
  }

  const handleDelete = async () => {
    if (confirm('确定删除这个视频任务吗？')) {
      await deleteTask(task.id)
      handleClose()
    }
  }

  const handleCancel = () => {
    if (confirm('确定取消这个任务吗？')) {
      cancelTask(task.id)
    }
  }

  return (
    <div ref={modalRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-app-surface rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-text">视频详情</h2>
          <button
            onClick={handleClose}
            className="text-app-text-muted hover:text-app-text transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧：播放器 */}
            <div className="space-y-4">
              {task.status === 'done' && videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full rounded-xl bg-black"
                  style={{ aspectRatio: task.params.aspectRatio }}
                />
              ) : task.status === 'running' || task.status === 'queued' ? (
                <div className="w-full aspect-video rounded-xl bg-app-surface-elevated flex items-center justify-center text-app-text-muted">
                  {task.status === 'queued' ? '排队中' : `生成中 ${task.progress || 0}%`}
                </div>
              ) : task.status === 'error' ? (
                <div className="w-full aspect-video rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500">
                  生成失败
                </div>
              ) : (
                <div className="w-full aspect-video rounded-xl bg-app-surface-elevated flex items-center justify-center text-app-text-muted">
                  已取消
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex flex-wrap gap-2">
                {task.status === 'done' && (
                  <>
                    <button
                      onClick={handleDownload}
                      className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
                    >
                      下载视频
                    </button>
                    <button
                      onClick={() => toggleFavorite(task.id)}
                      className={`px-4 py-2 rounded-xl font-medium transition-colors ${
                        task.isFavorite
                          ? 'bg-yellow-500 text-white'
                          : 'bg-app-surface-elevated text-app-text hover:bg-app-surface-more-elevated'
                      }`}
                    >
                      {task.isFavorite ? '★ 已收藏' : '☆ 收藏'}
                    </button>
                  </>
                )}
                {(task.status === 'running' || task.status === 'queued') && (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                  >
                    取消任务
                  </button>
                )}
                <button
                  onClick={handleCopyPrompt}
                  className="px-4 py-2 rounded-xl bg-app-surface-elevated hover:bg-app-surface-more-elevated text-app-text font-medium transition-colors"
                >
                  复制提示词
                </button>
                <button
                  onClick={handleReuseConfig}
                  className="px-4 py-2 rounded-xl bg-app-surface-elevated hover:bg-app-surface-more-elevated text-app-text font-medium transition-colors"
                >
                  复用配置
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 font-medium transition-colors"
                >
                  删除
                </button>
              </div>
            </div>

            {/* 右侧：参数和信息 */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-app-text-muted mb-2">提示词</h3>
                <p className="text-app-text whitespace-pre-wrap">{serializeVideoPrompt(task.prompt, task.inputs.refItems ?? [], false) || '无'}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-app-text-muted mb-2">参数</h3>
                <div className="space-y-1 text-sm text-app-text">
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">模式</span>
                    <span>{formatVideoMode(task.mode)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">模型</span>
                    <span>{getVideoModelDefinition(task.model)?.displayName ?? task.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">时长</span>
                    <span>{task.params.duration}秒</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">分辨率</span>
                    <span>{formatVideoResolution(task.params.resolution)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">比例</span>
                    <span>{task.params.aspectRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">音频</span>
                    <span>{task.params.audio ? '开启' : '关闭'}</span>
                  </div>
                  {task.params.seed && (
                    <div className="flex justify-between">
                      <span className="text-app-text-muted">种子</span>
                      <span>{task.params.seed}</span>
                    </div>
                  )}
                </div>
              </div>

              {task.error && (
                <div>
                  <h3 className="text-sm font-medium text-app-text-muted mb-2">错误信息</h3>
                  <p className="text-red-500 text-sm">{formatVideoTaskError(task.error)}</p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-app-text-muted mb-2">统计</h3>
                <div className="space-y-1 text-sm text-app-text">
                  <div className="flex justify-between">
                    <span className="text-app-text-muted">创建时间</span>
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                  </div>
                  {task.finishedAt && (
                    <div className="flex justify-between">
                      <span className="text-app-text-muted">完成时间</span>
                      <span>{new Date(task.finishedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {task.elapsed && (
                    <div className="flex justify-between">
                      <span className="text-app-text-muted">耗时</span>
                      <span>{Math.round(task.elapsed / 1000)}秒</span>
                    </div>
                  )}
                  {task.estimatedCredits && (
                    <div className="flex justify-between">
                      <span className="text-app-text-muted">预估积分</span>
                      <span>{task.estimatedCredits.toFixed(1)} 💎</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
