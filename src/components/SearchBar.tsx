import { clearFailedTasks, useStore } from '../store'
import { filterGalleryTasks, toggleVisibleGallerySelection, type GalleryStatusFilter } from '../lib/galleryPresentation'
import { TrashIcon } from './icons'
import WorkspaceMoreMenu from './WorkspaceMoreMenu'
import { pickStudioAssets } from '../lib/portalAssets'

const STATUS_OPTIONS: { label: string; value: GalleryStatusFilter }[] = [
  { label: '全部', value: 'all' }, { label: '生成中', value: 'running' },
  { label: '已完成', value: 'done' }, { label: '失败', value: 'error' },
]

export default function SearchBar() {
  const galleryFilters = useStore((s) => s.galleryFilters) ?? {}
  const setGalleryFilters = useStore((s) => s.setGalleryFilters)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const tasks = useStore((s) => s.tasks)
  const models = [...new Set(tasks.map(task => task.apiModel).filter((model): model is string => Boolean(model)))]
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const failedTasks = filterGalleryTasks(tasks, searchQuery, 'error', filterFavorite, galleryFilters)
  const visibleTasks = filterGalleryTasks(tasks, searchQuery, filterStatus, filterFavorite, galleryFilters)
  const visibleIds = visibleTasks.map((task) => task.id)
  const existingSelection = (selectedTaskIds ?? []).filter((id) => visibleIds.includes(id))
  const hasFilters = Boolean(searchQuery || filterFavorite || filterStatus !== 'all' || galleryFilters.model || galleryFilters.time && galleryFilters.time !== 'all' || galleryFilters.aspect && galleryFilters.aspect !== 'all')

  const handleClearFailed = () => {
    if (!failedTasks.length) return
    setConfirmDialog({
      title: '清除失败记录',
      message: `确定清除当前筛选范围内的失败记录吗？\n将删除 ${failedTasks.length} 条失败记录，并同步清理孤立图片资源。`,
      confirmText: '删除', cancelText: '取消', tone: 'danger',
      action: () => clearFailedTasks(failedTasks.map((task) => task.id)),
    })
  }

  return (
    <section data-no-drag-select aria-label="画廊筛选" className="mt-4 mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {typeof window !== 'undefined' && window.__AAP__?.baseUrl && <button type="button" onClick={() => void pickStudioAssets('gallery')} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-gray-900">从素材库选择</button>}
        <div className="relative min-w-0 flex-1 basis-48">
          <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input aria-label="搜索画廊记录" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} type="search" placeholder="搜索提示词、模型、参数…" className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition" />
        </div>
        <button type="button" aria-pressed={filterFavorite} onClick={() => setFilterFavorite(!filterFavorite)} className={`rounded-xl border px-3 py-2.5 text-sm transition ${filterFavorite ? 'border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400' : 'border-gray-200 bg-white text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300'}`}>
          <span aria-hidden="true">{filterFavorite ? '★' : '☆'}</span> 收藏
        </button>
        <button type="button" disabled={!visibleIds.length} onClick={() => setSelectedTaskIds(toggleVisibleGallerySelection(existingSelection, visibleIds))} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 disabled:opacity-40 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300">
          批量选择
        </button>
        {typeof window !== 'undefined' && window.__AAP__?.baseUrl && <WorkspaceMoreMenu mode="gallery" />}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <select aria-label="筛选模型" value={galleryFilters.model ?? ''} onChange={e => setGalleryFilters({ ...galleryFilters, model: e.target.value })} className="min-w-0 max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300 sm:max-w-64"><option value="">全部模型</option>{models.sort().map(model => <option key={model} value={model}>{model}</option>)}</select>
        <select aria-label="筛选时间" value={galleryFilters.time ?? 'all'} onChange={e => setGalleryFilters({ ...galleryFilters, time: e.target.value as typeof galleryFilters.time })} className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300"><option value="all">全部时间</option><option value="today">今天</option><option value="week">近 7 天</option><option value="month">近 30 天</option></select>
        <select aria-label="筛选请求画幅" title="按生成时的画幅参数筛选，自动画幅不归入横竖分类" value={galleryFilters.aspect ?? 'all'} onChange={e => setGalleryFilters({ ...galleryFilters, aspect: e.target.value as typeof galleryFilters.aspect })} className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300"><option value="all">全部画幅</option><option value="square">方形</option><option value="landscape">横向</option><option value="portrait">纵向</option></select>
        <span role="status" className="col-span-3 self-center text-xs text-gray-500 sm:ml-auto">{visibleTasks.length} 条记录</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="任务状态" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-white/[0.04]">
          {STATUS_OPTIONS.map((option) => (
            <button key={option.value} type="button" aria-pressed={filterStatus === option.value} onClick={() => setFilterStatus(option.value)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs sm:text-sm transition ${filterStatus === option.value ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
              {`${option.label} (${filterGalleryTasks(tasks, searchQuery, option.value, filterFavorite, galleryFilters).length})`}
            </button>
          ))}
        </div>
        {hasFilters && <button type="button" className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400" onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterFavorite(false); setGalleryFilters({}) }}>重置筛选</button>}
        {filterStatus === 'error' && <button type="button" disabled={!failedTasks.length} aria-label={`清除 ${failedTasks.length} 条失败记录`} onClick={handleClearFailed} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 disabled:opacity-40"><TrashIcon className="h-4 w-4" />清除失败</button>}
        {existingSelection.length > 0 && <span className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400" role="status">已选 {existingSelection.length} 条<button type="button" onClick={clearSelection} className="underline underline-offset-2">取消选择</button></span>}
      </div>
    </section>
  )
}
