import { useMemo, useState } from 'react'
import { useVideoStore } from '../videoStore'
import { useStore } from '../store'
import { downloadVideoTasks } from '../lib/downloadVideos'
import VideoTaskCard from './VideoTaskCard'
import { DownloadIcon, FavoriteIcon, TrashIcon } from './icons'
import WorkspaceMoreMenu from './WorkspaceMoreMenu'

const STATUS_FILTERS = [
  ['all', '全部'], ['queued', '排队中'], ['running', '生成中'], ['processing', '处理中'],
  ['done', '已完成'], ['error', '失败'], ['canceled', '已停止'],
] as const

interface VideoTaskGridProps {
  onOpenAssetLibrary?: () => void
}

export default function VideoTaskGrid({ onOpenAssetLibrary }: VideoTaskGridProps) {
  const { tasks, selectedTaskIds, setSelection, clearSelection, deleteTask, setTasksFavorite } = useVideoStore()
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number][0]>('all')
  const [favoriteFilter, setFavoriteFilter] = useState(false)

  const filteredTasks = useMemo(() => {
    let filtered = tasks
    if (statusFilter !== 'all') filtered = filtered.filter((task) => statusFilter === 'processing'
      ? task.status === 'running' && task.processing
      : statusFilter === 'running' ? task.status === 'running' && !task.processing : task.status === statusFilter)
    if (favoriteFilter) filtered = filtered.filter((task) => task.isFavorite)
    const query = searchQuery.trim().toLowerCase()
    if (query) filtered = filtered.filter((task) => `${task.prompt} ${task.model} ${task.params.duration}s`.toLowerCase().includes(query))
    return filtered
  }, [tasks, statusFilter, favoriteFilter, searchQuery])

  const visibleIds = filteredTasks.map((task) => task.id)
  const existingSelectedIds = [...selectedTaskIds].filter((id) => visibleIds.includes(id))
  const selectedTasks = tasks.filter((task) => existingSelectedIds.includes(task.id))
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.has(id))

  const toggleVisibleSelection = () => {
    setSelection(allVisibleSelected ? [] : visibleIds)
  }

  const batchDelete = () => setConfirmDialog({
    title: '批量删除视频任务',
    message: `确定删除选中的 ${selectedTasks.length} 个任务吗？`,
    tone: 'danger',
    action: () => { void Promise.all(selectedTasks.map((task) => deleteTask(task.id))); clearSelection() },
  })

  const batchFavorite = () => {
    const favorite = !selectedTasks.every((task) => task.isFavorite)
    void setTasksFavorite(selectedTasks.map((task) => task.id), favorite)
  }

  const batchDownload = async () => {
    const result = await downloadVideoTasks(selectedTasks)
    if (result.successCount === 0) showToast('没有可下载的本地视频', 'error')
    else showToast(`已下载 ${result.successCount} 个视频${result.failCount ? `，${result.failCount} 个失败` : ''}`, result.failCount ? 'error' : 'success')
  }

  return (
    <div data-video-gallery className="min-w-0">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-[color:var(--app-text)]">视频作品</h2><span className="text-xs text-[color:var(--app-text-muted)]">{filteredTasks.length} 个任务</span></div>
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
        <input aria-label="搜索视频任务" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索提示词、模型..." className="min-w-0 basis-48 flex-1 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-4 py-2 text-sm text-[color:var(--app-text)] outline-none focus:border-blue-400" />
        <div className="order-last flex w-full gap-1 overflow-x-auto" aria-label="任务状态筛选">
          {STATUS_FILTERS.map(([value, label]) => <FilterButton key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</FilterButton>)}
        </div>
        <button type="button" onClick={onOpenAssetLibrary} className="rounded-xl border border-[color:var(--app-border)] px-3 py-2 text-sm text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)]">▦ {typeof window !== 'undefined' && window.__AAP__?.baseUrl ? '素材库' : '资产库'}</button>
        <button type="button" aria-pressed={favoriteFilter} onClick={() => setFavoriteFilter(!favoriteFilter)} className={`rounded-xl px-3 py-2 text-sm ${favoriteFilter ? 'bg-yellow-500 text-white' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)]'}`}>★ 收藏</button>
        <button type="button" data-testid="video-select-all" onClick={toggleVisibleSelection} className="rounded-xl border border-[color:var(--app-border)] px-3 py-2 text-sm text-[color:var(--app-text-muted)]">{allVisibleSelected ? '取消全选' : '全选当前'}</button>
        {typeof window !== 'undefined' && window.__AAP__?.baseUrl && <WorkspaceMoreMenu mode="video" section="works" />}
      </div>

      {selectedTasks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-400/40 bg-blue-500/10 p-2">
          <button type="button" onClick={toggleVisibleSelection} className="rounded-lg bg-[color:var(--app-surface-elevated)] px-3 py-2 text-xs text-[color:var(--app-text)]">{allVisibleSelected ? '取消选中当前' : '全选当前'} </button>
          <span className="text-xs text-[color:var(--app-text-muted)]">已选 {selectedTasks.length} 项</span>
          <button type="button" onClick={batchFavorite} title="收藏选中" className="rounded-lg p-2 text-[color:var(--app-text)] hover:bg-[color:var(--app-surface-elevated)]"><FavoriteIcon className="h-4 w-4" /></button>
          <button type="button" onClick={() => void batchDownload()} title="下载选中" className="rounded-lg p-2 text-[color:var(--app-text)] hover:bg-[color:var(--app-surface-elevated)]"><DownloadIcon className="h-4 w-4" /></button>
          <button type="button" onClick={batchDelete} title="删除选中" className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"><TrashIcon className="h-4 w-4" /></button>
          <button type="button" onClick={clearSelection} className="ml-auto text-xs text-[color:var(--app-text-muted)]">取消选择</button>
        </div>
      )}

      {filteredTasks.length === 0 ? <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--app-border)] px-6 text-center text-[color:var(--app-text-muted)]"><div aria-hidden="true" className="text-4xl">▧</div><div className="font-medium text-[color:var(--app-text)]">{tasks.length === 0 ? '从一个镜头开始' : '没有匹配结果'}</div><p className="max-w-sm text-sm leading-relaxed">{tasks.length === 0 ? '在创作面板填写提示词，选择模型和画面参数，创建你的第一个视频。' : '试试其他状态，或清除搜索和收藏筛选。'}</p>{tasks.length > 0 && <button type="button" onClick={() => { setStatusFilter('all'); setFavoriteFilter(false); setSearchQuery('') }} className="rounded-xl border border-[color:var(--app-border)] px-4 py-2 text-sm">重置筛选</button>}</div> : <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">{filteredTasks.map((task) => <VideoTaskCard key={task.id} task={task} />)}</div>}
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition ${active ? 'bg-blue-500 text-white' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)]'}`}>{children}</button>
}
