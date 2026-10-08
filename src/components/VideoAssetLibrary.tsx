import { useEffect, useMemo, useRef, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { getMediaBlobUrl, getMediaPosterBlobUrl } from '../lib/videoDb'
import { getVideoAssetPreviewSource } from '../lib/videoAssetBridge'
import { formatAssetDuration, formatAssetSize, filterVideoAssets, groupVideoAssetsByDate, type AssetFilterType } from '../lib/videoAssetLibrary'
import type { VideoAssetRecord } from '../lib/videoAssetTypes'
import { useVideoAssetStore } from '../videoAssetStore'

interface Props {
  open: boolean
  onClose: () => void
  onUse?: (assets: VideoAssetRecord[]) => void
}

export default function VideoAssetLibrary({ open, onClose, onUse }: Props) {
  const { assets, categories, loading, error, load, upload, remove, addCategory, rename, move, renameCategory, removeCategory } = useVideoAssetStore()
  const [type, setType] = useState<AssetFilterType>('all')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<VideoAssetRecord | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(open, onClose)
  usePreventBackgroundScroll(open, scrollRef)
  useEffect(() => { if (open) void load() }, [open, load])
  const visible = useMemo(() => filterVideoAssets(assets, { type, categoryId, query }), [assets, type, categoryId, query])
  const groups = useMemo(() => groupVideoAssetsByDate(visible), [visible])
  const selectedAssets = assets.filter((asset) => selected.has(asset.id))

  if (!open) return null
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const uploadFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const limit = file.type.startsWith('image/') ? 30 : file.type.startsWith('video/') ? 50 : file.type.startsWith('audio/') ? 15 : 0
      if (!limit || file.size > limit * 1024 * 1024) continue
      try { await upload(file, categoryId) } catch { /* keep successful files */ }
    }
  }
  const newCategory = async () => {
    const name = window.prompt('分类名称')
    if (name) { try { await addCategory(name) } catch (cause) { window.alert(cause instanceof Error ? cause.message : '创建分类失败') } }
  }
  const renameAsset = async (asset: VideoAssetRecord) => {
    const name = window.prompt('素材名称', asset.displayName)
    if (name) await rename(asset.id, name)
  }
  const moveSelected = async () => {
    const name = window.prompt('输入分类名称，留空表示未分类', categories.find((item) => item.id === categoryId)?.name ?? '')
    if (name === null) return
    const target = categories.find((item) => item.name === name.trim())
    await move([...selected], target?.id ?? null)
  }
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="资产库">
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[1120px] flex-col border-l border-[color:var(--app-border)] bg-[color:var(--app-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--app-border)] px-5 py-4">
          <div><h2 className="text-xl font-bold text-[color:var(--app-text)]">资产库 <span className="ml-2 text-sm font-normal text-[color:var(--app-text-muted)]">{assets.length} 个素材</span></h2><p className="mt-1 text-xs text-[color:var(--app-text-muted)]">素材仅保存在当前浏览器</p></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">↑ 上传素材</button><button type="button" onClick={onClose} aria-label="关闭资产库" className="rounded-xl border border-[color:var(--app-border)] px-3 py-2 text-xl text-[color:var(--app-text)]">×</button></div>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.heic,.heif,.mov,.mp4,.wav,.mp3,.m4a" className="hidden" onChange={(event) => { void uploadFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-56 shrink-0 flex-col border-r border-[color:var(--app-border)] p-4 sm:flex">
            <SideButton active={categoryId === null} onClick={() => setCategoryId(null)}>▱ 全部 <span>{assets.length}</span></SideButton>
            <SideButton active={categoryId === '__uncategorized'} onClick={() => setCategoryId('__uncategorized')}>□ 未分类 <span>{assets.filter((item) => !item.categoryId).length}</span></SideButton>
            <div className="mt-5 flex-1 space-y-1">{categories.map((category) => <div key={category.id} className="flex items-center gap-1"><SideButton active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{`□ ${category.name}`}</SideButton><button type="button" aria-label={`重命名分类 ${category.name}`} onClick={() => { const name = window.prompt('分类名称', category.name); if (name) void renameCategory(category.id, name) }} className="rounded px-1 text-xs text-[color:var(--app-text-muted)]">⋯</button><button type="button" aria-label={`删除分类 ${category.name}`} onClick={() => { if (window.confirm(`删除分类“${category.name}”？素材将移到未分类`)) void removeCategory(category.id) }} className="rounded px-1 text-xs text-red-400">×</button></div>)}</div>
            <button type="button" onClick={() => void newCategory()} className="rounded-xl border border-dashed border-[color:var(--app-border)] px-3 py-3 text-left text-sm text-violet-400">＋ 新建分类</button>
          </aside>
          <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap gap-2 sm:items-center"><div className="flex gap-2 overflow-x-auto"><TypeButton active={type === 'all'} onClick={() => setType('all')}>全部</TypeButton><TypeButton active={type === 'image'} onClick={() => setType('image')}>图片</TypeButton><TypeButton active={type === 'video'} onClick={() => setType('video')}>视频</TypeButton><TypeButton active={type === 'audio'} onClick={() => setType('audio')}>音频</TypeButton></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称" className="min-w-[180px] flex-1 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2 text-sm text-[color:var(--app-text)] outline-none" /></div>
            <div className="mb-4 flex gap-2 sm:hidden"><select value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value || null)} className="flex-1 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2 text-sm text-[color:var(--app-text)]"><option value="">全部分类</option><option value="__uncategorized">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            {loading ? <div className="flex min-h-72 items-center justify-center text-[color:var(--app-text-muted)]">正在加载资产…</div> : error ? <div role="alert" className="rounded-xl border border-red-400/40 p-4 text-red-400">{error}</div> : groups.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center text-[color:var(--app-text-muted)]"><div className="mb-3 text-5xl">▧</div><p>暂无资产</p><p className="mt-1 text-xs">上传图片、视频或音频后会显示在这里</p></div> : groups.map((group) => <section key={group.label} className="mb-7"><h3 className="mb-3 text-sm font-semibold text-[color:var(--app-text-muted)]">{group.label}</h3><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{group.items.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selected.has(asset.id)} onToggle={() => toggle(asset.id)} onPreview={() => setPreview(asset)} onRename={() => void renameAsset(asset)} />)}</div></section>)}
          </main>
        </div>
        {selectedAssets.length > 0 && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-5 py-3"><span className="mr-auto text-sm text-[color:var(--app-text-muted)]">已选 {selectedAssets.length} 项</span><button type="button" onClick={() => void moveSelected()} className="rounded-lg border border-[color:var(--app-border)] px-3 py-2 text-sm text-[color:var(--app-text)]">移动分类</button><button type="button" onClick={() => { onUse?.(selectedAssets); setSelected(new Set()); onClose() }} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white">添加到当前创作</button><button type="button" onClick={() => void remove([...selected])} className="rounded-lg px-3 py-2 text-sm text-red-400">从资产库移除</button></footer>}
      </div>
      {preview && <VideoAssetPreview asset={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function SideButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm ${active ? 'bg-violet-500/15 text-violet-300' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)]'}`}>{children}</button> }
function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-full border px-4 py-2 text-sm ${active ? 'border-violet-400 bg-violet-500/20 text-violet-300' : 'border-[color:var(--app-border)] text-[color:var(--app-text-muted)]'}`}>{children}</button> }

function AssetCard({ asset, selected, onToggle, onPreview, onRename }: { asset: VideoAssetRecord; selected: boolean; onToggle: () => void; onPreview: () => void; onRename: () => void }) {
  const [source, setSource] = useState<string | undefined>()
  const poster = useMediaBlobUrl(asset.storage === 'media' && asset.type === 'video' ? asset.storageId : null, getMediaPosterBlobUrl)
  const mediaImage = useMediaBlobUrl(asset.storage === 'media' && asset.type === 'image' ? asset.storageId : null, getMediaBlobUrl)
  useEffect(() => {
    let active = true
    if (asset.storage === 'images') void getVideoAssetPreviewSource(asset).then((next) => { if (active) setSource(next) })
    else setSource(undefined)
    return () => { active = false }
  }, [asset])
  const image = source || mediaImage
  return <article className={`group relative overflow-hidden rounded-xl border bg-[color:var(--app-surface)] ${selected ? 'border-violet-400 ring-2 ring-violet-400/40' : 'border-[color:var(--app-border)]'}`}><button type="button" onClick={onPreview} className="block aspect-video w-full bg-[color:var(--app-input)]">{image || poster ? <img src={image || poster || undefined} alt={asset.displayName} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-3xl text-[color:var(--app-text-muted)]">{asset.type === 'audio' ? '♫' : asset.type === 'video' ? '▶' : '▧'}</span>}</button><label className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded bg-black/60" onClick={(event) => event.stopPropagation()}><input aria-label={`选择素材 ${asset.displayName}`} type="checkbox" checked={selected} onChange={onToggle} className="accent-violet-500" /></label><button type="button" onClick={onRename} className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100">编辑</button><div className="p-2"><p className="truncate text-sm text-[color:var(--app-text)]" title={asset.displayName}>{asset.displayName}</p><p className="mt-1 truncate text-xs text-[color:var(--app-text-muted)]">{asset.type === 'video' || asset.type === 'audio' ? `${formatAssetDuration(asset.duration)} · ` : ''}{formatAssetSize(asset.size)}</p></div></article>
}

function VideoAssetPreview({ asset, onClose }: { asset: VideoAssetRecord; onClose: () => void }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => { let active = true; void getVideoAssetPreviewSource(asset).then((next) => { if (active) setUrl(next) }); return () => { active = false; if (url?.startsWith('blob:')) URL.revokeObjectURL(url) } }, [asset])
  useCloseOnEscape(true, onClose)
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="素材预览" onClick={onClose}><div className="max-h-[90vh] w-full max-w-3xl rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h3 className="truncate text-sm font-semibold text-[color:var(--app-text)]">{asset.displayName}</h3><button type="button" onClick={onClose} className="text-xl text-[color:var(--app-text-muted)]">×</button></div>{asset.type === 'image' ? <img src={url || undefined} alt={asset.displayName} className="max-h-[70vh] w-full object-contain" /> : asset.type === 'video' ? <video src={url || undefined} controls autoPlay muted className="max-h-[70vh] w-full bg-black" /> : <audio src={url || undefined} controls autoPlay className="w-full" />}</div></div>
}
