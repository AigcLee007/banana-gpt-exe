import type { TaskRecord } from '../types'

export type GalleryStatusFilter = 'all' | 'running' | 'done' | 'error'
export interface GalleryFilters {
  model?: string
  time?: 'all' | 'today' | 'week' | 'month'
  aspect?: 'all' | 'square' | 'landscape' | 'portrait'
}

function getRequestedAspect(task: TaskRecord) {
  const params = task.actualParams ?? task.params
  const ratio = params.geminiAspectRatio ?? task.params.geminiAspectRatio
  const match = ratio?.match(/^(\d+):(\d+)$/) ?? (params.size ?? task.params.size).match(/^(\d+)x(\d+)$/)
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return 'unknown'
  return Number(match[1]) === Number(match[2]) ? 'square' : Number(match[1]) > Number(match[2]) ? 'landscape' : 'portrait'
}

export function getGalleryTaskState(task: TaskRecord) {
  if (task.status === 'error' && (task.falRecoverable || task.customRecoverable)) return 'recovering'
  if (task.status === 'error' && task.error === '已停止生成。') return 'stopped'
  return task.status
}

export function filterGalleryTasks(tasks: TaskRecord[], query: string, status: GalleryStatusFilter, favorites: boolean, filters: GalleryFilters = {}, now = Date.now()) {
  const q = query.trim().toLowerCase()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const since = filters.time === 'today' ? today.getTime() : filters.time === 'week' ? now - 7 * 86400000 : filters.time === 'month' ? now - 30 * 86400000 : -Infinity
  return tasks.filter((task) => {
    if (favorites && !task.isFavorite) return false
    if (filters.model && filters.model !== task.apiModel) return false
    if (task.createdAt < since) return false
    if (filters.aspect && filters.aspect !== 'all' && getRequestedAspect(task) !== filters.aspect) return false
    const state = getGalleryTaskState(task)
    const effectiveStatus = state === 'recovering' ? 'running' : state === 'stopped' ? 'error' : state
    if (status !== 'all' && effectiveStatus !== status) return false
    return !q || [task.prompt, task.apiModel, task.apiProfileName, JSON.stringify(task.params)].join(' ').toLowerCase().includes(q)
  }).sort((a, b) => b.createdAt - a.createdAt)
}

export function toggleVisibleGallerySelection(selected: string[], visible: string[]) {
  return visible.length > 0 && visible.every((id) => selected.includes(id))
    ? []
    : [...new Set(visible)]
}
