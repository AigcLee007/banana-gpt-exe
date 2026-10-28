import { useEffect, useState } from 'react'
import type { AppMode } from '../types'
import { clearWorkspaceData, exportWorkspaceData, getWorkspaceDataCounts, getWorkspaceResourceCounts, importWorkspaceData, type WorkspaceDataScope } from '../lib/localWorkspaceData'
import WorkspaceDialog, { workspaceControlClass } from './WorkspaceDialog'
import { clearEcommerceWorkspaces } from '../lib/agentEcommerceWorkspace'

const CATEGORIES: { scope: WorkspaceDataScope; label: string; description: string; unit: string }[] = [
  { scope: 'gallery', label: '画廊', description: '图片生成记录与关联图片', unit: '条生成记录' },
  { scope: 'agent', label: 'Agent', description: '创作会话与关联作品；导入时一并恢复关联作品', unit: '个会话' },
  { scope: 'video', label: '视频', description: '视频任务、本地媒体、素材库与分组', unit: '个视频任务' },
]

export default function WorkspaceDataDialog({ mode, onClose }: { mode: AppMode; onClose: () => void }) {
  const [selected, setSelected] = useState<WorkspaceDataScope[]>([mode])
  const [counts, setCounts] = useState<Record<WorkspaceDataScope, number> | null>(null)
  const [resources, setResources] = useState<{ images: number; media: number; videoAssets: number } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const clearSelected = async () => {
    await clearWorkspaceData(selected)
    if (selected.includes('agent') && window.__AAP__?.baseUrl) clearEcommerceWorkspaces(localStorage, (window.__AAP__ as { userId?: number }).userId)
  }
  useEffect(() => {
    let active = true
    getWorkspaceDataCounts().then(value => { if (active) setCounts(value) }).catch(() => { if (active) setError('读取本机数据失败，请关闭后重试。') })
    getWorkspaceResourceCounts().then(value => { if (active) setResources(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await operation(); setCounts(await getWorkspaceDataCounts()); setResources(await getWorkspaceResourceCounts()); setMessage(success); setConfirm(false); setFile(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。') }
    finally { setBusy(false) }
  }
  return <WorkspaceDialog title="本机数据管理" onClose={onClose} busy={busy}>
    <p className="text-sm leading-relaxed text-[color:var(--app-text-muted)]">管理当前浏览器保存的创作内容。账户、余额和其他设备的数据不在此范围内。备份不包含渠道密钥。</p>
    <fieldset disabled={busy} className="space-y-2"><legend className="mb-3 text-sm font-medium">选择处理范围</legend>{CATEGORIES.map(({ scope, label, description, unit }) => <label key={scope} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${selected.includes(scope) ? 'border-blue-400/50 bg-blue-500/5' : 'border-[color:var(--app-border)]'}`}><input type="checkbox" checked={selected.includes(scope)} aria-label={`${label}数据`} className="mt-1 h-4 w-4 accent-blue-500" onChange={event => { setSelected(event.target.checked ? [...selected, scope] : selected.filter(item => item !== scope)); setConfirm(false); setMessage(''); setError('') }} /><div className="min-w-0 flex-1"><span className="text-sm font-medium">{label}</span><p className="mt-1 text-xs leading-relaxed text-[color:var(--app-text-muted)]">{description}</p></div><span className="shrink-0 text-xs text-[color:var(--app-text-muted)]">{counts ? `${counts[scope]} ${unit}` : '读取中…'}</span></label>)}</fieldset>
    <p className="text-xs leading-relaxed text-[color:var(--app-text-muted)]">清理画廊时，仍被未选会话引用的生成记录与共享图片会保留。清理 Agent 会保留画廊中的作品，并清理当前账户的电商表单。电商表单保存在本浏览器，暂不包含在本机备份ZIP中，可在电商素材包中导出需求与规划。正在生成时请先完成或停止任务。</p>
    {resources && <p className="!mt-2 text-xs text-[color:var(--app-text-muted)]">本机共有 {resources.images} 张共享图片、{resources.media} 份视频媒体、{resources.videoAssets} 项视频素材。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={workspaceControlClass} disabled={busy || !counts || !selected.length} onClick={() => void run(() => exportWorkspaceData(selected), '所选本机数据已导出。')}>导出 ZIP</button><label className={`${workspaceControlClass} cursor-pointer ${busy || !selected.length ? 'pointer-events-none opacity-40' : ''}`}>选择备份文件<input aria-label="选择本机备份文件" type="file" accept=".zip,application/zip" disabled={busy || !selected.length} className="sr-only" onChange={event => { setFile(event.target.files?.[0] ?? null); setConfirm(false); setError(''); event.target.value = '' }} /></label></div>
    {file && <div className="space-y-3 rounded-xl border border-[color:var(--app-border)] p-3"><p className="break-all text-xs">已选择：{file.name}</p><p className="text-xs leading-relaxed text-[color:var(--app-text-muted)]">仅导入勾选范围，保留现有内容；记录冲突或文件不完整时取消导入。</p><button type="button" disabled={busy || !selected.length || !counts} className={workspaceControlClass} onClick={() => void run(() => importWorkspaceData(file, selected), '所选数据已导入。')}>导入所选范围</button></div>}
    <div className="border-t border-[color:var(--app-border)] pt-4">
      {confirm ? <div className="space-y-3 rounded-xl border border-red-400/30 bg-red-500/5 p-3"><p className="text-sm font-medium">确认清理所选本机数据？</p><p className="text-xs leading-relaxed text-[color:var(--app-text-muted)]">{CATEGORIES.filter(item => selected.includes(item.scope)).map(item => `${item.label}：${counts?.[item.scope] ?? 0} ${item.unit}`).join('；')}。{selected.includes('video') ? '还会清理视频本地媒体、素材库及分组。' : ''}此操作不可撤销，建议先导出备份。</p><div className="flex gap-2"><button type="button" disabled={busy} className="rounded-xl bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void run(clearSelected, '所选本机数据已清理；仍被引用的作品已保留。')}>确认清理本机数据</button><button type="button" disabled={busy} className={workspaceControlClass} onClick={() => setConfirm(false)}>取消</button></div></div> : <button type="button" disabled={busy || !counts || !selected.length} className="rounded-xl px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-40" onClick={() => { setConfirm(true); setError(''); setMessage('') }}>清理所选本机数据…</button>}
    </div>
    {busy && <p role="status" className="text-sm text-[color:var(--app-text-muted)]">正在处理，请保持页面打开…</p>}
    {message && <p role="status" className="text-sm text-green-600 dark:text-green-400">{message}</p>}
    {error && <p role="alert" className="break-words text-sm text-red-500">{error}</p>}
  </WorkspaceDialog>
}
