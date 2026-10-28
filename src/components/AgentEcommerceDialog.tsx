import { useEffect, useMemo, useRef, useState } from 'react'
import { ensureImageCached, useStore } from '../store'
import { buildEcommercePrompt, createEcommercePlan, ECOMMERCE_RULES_CHECKED_AT, ECOMMERCE_SOURCES, validateEcommerceBrief, type EcommerceBrief, type EcommercePhase } from '../lib/agentEcommerce'
import { buildEcommerceArchive, getEcommerceArchiveFilename, type EcommerceExportImage } from '../lib/agentEcommerceExport'
import { collectEcommerceOutputs, ECOMMERCE_OPEN_EVENT, loadEcommerceWorkspace, saveEcommerceWorkspace, type EcommerceAssignment, type EcommerceWorkspaceState } from '../lib/agentEcommerceWorkspace'
import { assertManagedLocalAsset, managedLocalAssetAllowed } from '../lib/portalAssetOwnership'
import { requestInputBarExpansion } from '../lib/inputBarPresentation'
import { normalizeParamsForSettings } from '../lib/paramCompatibility'
import { uploadEcommerceReference } from '../lib/agentEcommerceUpload'
import WorkspaceDialog, { workspaceControlClass as control } from './WorkspaceDialog'

const ownerId = () => (window.__AAP__ as { userId?: number } | undefined)?.userId
const muted = 'text-xs leading-relaxed text-[color:var(--app-text-muted)]'
const box = 'space-y-3 rounded-xl border border-[color:var(--app-border)] p-4'

export default function AgentEcommerceWorkspace() {
  const conversationId = useStore(s => s.activeAgentConversationId)
  const [owner, setOwner] = useState(ownerId)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    const sync = () => setOwner(ownerId())
    const open = () => {
      const state = useStore.getState()
      if (!state.activeAgentConversationId) state.createAgentConversation()
      sync(); setOpened(true)
    }
    window.addEventListener(ECOMMERCE_OPEN_EVENT, open)
    window.addEventListener('aap:assets-ready', sync)
    void window.__AAP_ASSETS__?.ready.then(sync).catch(() => undefined)
    return () => {
      window.removeEventListener(ECOMMERCE_OPEN_EVENT, open)
      window.removeEventListener('aap:assets-ready', sync)
    }
  }, [])
  return opened ? <AgentEcommerceDialog key={`${owner}:${conversationId}`} owner={owner} conversationId={conversationId} onClose={() => setOpened(false)} /> : null
}

function ProductThumb({ imageId, label, owner }: { imageId: string; label: string; owner: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (ownerId() !== owner || !managedLocalAssetAllowed(`image:${imageId}`, owner)) return () => { active = false }
    void ensureImageCached(imageId).then(value => { if (active && ownerId() === owner && value) setSrc(value) }).catch(() => undefined)
    return () => { active = false }
  }, [imageId, owner])
  return <div className="flex min-w-0 items-center gap-3">{src && <img src={src} alt={label} className="h-16 w-16 shrink-0 rounded-lg border border-[color:var(--app-border)] object-contain" />}<span className={muted}>{label}</span></div>
}

export function AgentEcommerceDialog({ owner, conversationId, onClose }: { owner?: number; conversationId: string | null; onClose: () => void }) {
  const [value, setValue] = useState(() => loadEcommerceWorkspace(localStorage, owner, conversationId ?? ''))
  const [tab, setTab] = useState<'plan' | 'export'>('plan')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingPhase, setPendingPhase] = useState<EcommercePhase | null>(null)
  const mounted = useRef(true)
  const tasks = useStore(s => s.tasks)
  const references = useStore(s => s.inputImages)
  const conversations = useStore(s => s.agentConversations)
  const plan = useMemo(() => createEcommercePlan(value.brief), [value.brief])
  const ready = Number.isSafeInteger(owner) && owner! > 0 && !!conversationId
  const outputs = useMemo(() => ready ? collectEcommerceOutputs(tasks, conversationId!).filter(item => managedLocalAssetAllowed(`image:${item.imageId}`, owner)) : [], [tasks, conversationId, owner, ready])
  const outputIds = new Set(outputs.map(item => item.imageId))
  const running = conversations.find(item => item.id === conversationId)?.rounds.some(item => item.status === 'running') ?? false
  const confirmed = value.sampleConfirmed && !!value.sampleImageId && outputIds.has(value.sampleImageId)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!ready || ownerId() !== owner || useStore.getState().activeAgentConversationId !== conversationId) return
    try { saveEcommerceWorkspace(localStorage, owner, conversationId!, value) }
    catch { setError('本机空间不足或浏览器禁止保存，当前表单尚未保存。请先复制重要资料。') }
  }, [value, owner, conversationId, ready])

  const guard = () => {
    const state = useStore.getState()
    if (!mounted.current || !ready || ownerId() !== owner || state.activeAgentConversationId !== conversationId || state.appMode !== 'agent') throw Error('账户或会话已变化，请重新打开电商套图。')
    return state
  }
  const update = (changes: Partial<EcommerceWorkspaceState>) => {
    try { guard() } catch { setError('账户或会话已变化，请重新打开电商套图。'); return }
    setError(''); setMessage(''); setPendingPhase(null)
    setValue(previous => ({ ...previous, ...changes, reviewed: false }))
  }
  const updateBrief = (changes: Partial<EcommerceBrief>) => update({ brief: { ...value.brief, ...changes }, sampleConfirmed: false })
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { guard(); await work() }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作失败，请重试。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const fill = (phase: EcommercePhase, replace = false) => {
    try {
      const state = guard()
      if (running) throw Error('请等待当前回复完成或停止后，再开始下一阶段。')
      const errors = validateEcommerceBrief(value.brief, phase)
      if (errors.length) throw Error(errors.join(' '))
      const imagePhase = ['sample', 'main', 'secondary', 'detail'].includes(phase)
      if (imagePhase && !state.inputImages.length) throw Error('请先上传产品实拍，或从素材库选择真实参考图片。')
      for (const image of state.inputImages) assertManagedLocalAsset(`image:${image.id}`, owner)
      if (imagePhase && phase !== 'sample' && !confirmed) throw Error('请先选择并确认主图样稿，再继续分组生成。')
      if (imagePhase && phase !== 'sample' && !state.inputImages.some(image => image.id === value.sampleImageId)) throw Error('已确认样稿已从草稿移除，请再次确认并作为参考。')
      if (state.prompt.trim() && !replace) { setPendingPhase(phase); return }
      if (imagePhase) {
        const group = phase === 'sample' ? 'main' : phase
        const size = plan.find(item => item.group === group)!.generationSize
        state.setParams(normalizeParamsForSettings({ ...state.params, size, n: 1, geminiAspectRatio: undefined }, state.settings, { hasInputImages: true }))
      }
      state.setPrompt(buildEcommercePrompt(value.brief, phase, plan))
      onClose()
      requestInputBarExpansion()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '填入草稿失败。') }
  }
  const addFiles = async (files: File[]) => {
    if (!files.length) return
    if (files.length + guard().inputImages.length > 16) throw Error('每份草稿最多使用16张参考图。')
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024)) throw Error('请使用20MiB以内的PNG、JPEG或WEBP图片。')
    for (const file of files) {
      guard()
      const image = await uploadEcommerceReference(file, owner!, guard)
      const state = guard()
      if (state.inputImages.length >= 16) throw Error('参考图已满，请先在草稿中移除多余图片。')
      if (image && !state.inputImages.some(item => item.id === image.id)) { assertManagedLocalAsset(`image:${image.id}`, owner); state.addInputImage(image) }
    }
    setMessage('产品实拍已添加到当前草稿。可关闭面板预览或移除参考图。')
  }
  const upload = (files: File[]) => void perform(() => addFiles(files))
  const pickReferences = () => void perform(async () => {
    const shared = window.__AAP_ASSETS__
    if (!shared) throw Error('素材库尚未就绪，请稍后重试。')
    await shared.ready
    guard(); setPicking(true)
    try {
      const selected = await shared.pick({ source: 'agent', kinds: ['image'], multiple: true })
      guard()
      if (selected.some(item => item.asset.kind !== 'image')) throw Error('请选择产品实拍图片。')
      await addFiles(selected.map(item => new File([item.blob], item.asset.title, { type: item.blob.type })))
    } finally { if (mounted.current) setPicking(false) }
  })
  const confirmSample = () => void perform(async () => {
    const id = value.sampleImageId
    if (!id || !collectEcommerceOutputs(guard().tasks, conversationId!).some(item => item.imageId === id)) throw Error('请从当前会话成图中选择主图样稿。')
    assertManagedLocalAsset(`image:${id}`, owner)
    const dataUrl = await ensureImageCached(id)
    const state = guard()
    if (!dataUrl) throw Error('样稿原文件缺失，请重新生成或选择其他图片。')
    assertManagedLocalAsset(`image:${id}`, owner)
    if (!state.inputImages.some(image => image.id === id)) {
      if (state.inputImages.length >= 16) throw Error('参考图已满，请先移除多余图片，再加入样稿。')
      state.addInputImage({ id, dataUrl })
    }
    update({ sampleConfirmed: true })
    setMessage('样稿已确认，并添加到当前草稿作为风格参考。原始实拍请一并保留。')
  })
  const assignment = (id: string, changes: Partial<EcommerceAssignment>) => update({ assignments: { ...value.assignments, [id]: { ...(value.assignments[id] ?? { imageId: '', fit: 'contain', syntheticPerson: false }), ...changes } } })
  const download = () => void perform(async () => {
    if (!value.brief.productName.trim()) throw Error('请先填写产品名称。')
    if (!value.reviewed) throw Error('请先核对所选图片、文案和人物标记。')
    const exportPlan = plan.map(item => ({ ...item, width: value.assignments[item.id]?.width ?? item.width, height: value.assignments[item.id]?.height ?? item.height }))
    const selected = exportPlan.filter(item => value.assignments[item.id]?.imageId)
    if (!selected.length) throw Error('请至少选择一张当前会话成图。')
    const images: EcommerceExportImage[] = []
    for (const item of selected) {
      guard()
      const choice = value.assignments[item.id]
      const currentIds = new Set(collectEcommerceOutputs(useStore.getState().tasks, conversationId!).map(output => output.imageId))
      if (!currentIds.has(choice.imageId)) throw Error(`${item.id}图片已移除，请重新选择。`)
      assertManagedLocalAsset(`image:${choice.imageId}`, owner)
      const url = await ensureImageCached(choice.imageId)
      guard()
      if (!url?.startsWith('data:image/')) throw Error(`${item.id}原文件缺失，请重新选择图片。`)
      const source = await (await fetch(url)).blob()
      guard(); assertManagedLocalAsset(`image:${choice.imageId}`, owner)
      images.push({ ...item, ...choice, source })
    }
    const { bytes, report } = await buildEcommerceArchive({ productName: value.brief.productName, brief: value.brief, plan: exportPlan, copy: value.copy, images })
    guard()
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url; link.download = getEcommerceArchiveFilename(value.brief.productName)
    document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    setMessage(`已导出${report.images.length}张图片、原图、需求规划、配套文案和尺寸检查报告。`)
  })

  return <WorkspaceDialog title="电商套图" onClose={onClose} busy={busy} suspended={picking} wide>
    <p className={muted}>从真实产品出发，先聊方案、确认一张样稿，再制作主图、副图和详情模块。各阶段填入可编辑草稿，由你确认后发送。</p>
    {!ready ? <p role="alert" className="text-sm text-amber-600">账户资料尚未就绪，请稍后重新打开。当前不读取或保存电商资料。</p> : <>
      <div role="tablist" aria-label="电商套图步骤" className="flex rounded-xl bg-[color:var(--app-bg-soft)] p-1">{([['plan', '需求与计划'], ['export', '整理与导出']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} disabled={busy} onClick={() => { setTab(key); setError(''); setPendingPhase(null) }} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === key ? 'bg-[color:var(--app-surface)] font-medium shadow-sm' : 'text-[color:var(--app-text-muted)]'}`}>{label}</button>)}</div>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
      {tab === 'plan' ? <>
        <section className={box} aria-label="产品需求">
          <h3 className="text-sm font-semibold">1 · 产品与平台</h3>
          <label className="block space-y-1 text-xs">产品名称<input aria-label="产品名称" maxLength={160} className={`${control} w-full`} value={value.brief.productName} placeholder="例如：深蓝色男款冲锋衣" onChange={event => updateBrief({ productName: event.target.value })} /></label>
          <label className="block space-y-1 text-xs">目标平台<select aria-label="目标平台" className={`${control} w-full`} value={value.brief.platform} onChange={event => updateBrief({ platform: event.target.value as EcommerceBrief['platform'] })}><option value="amazon-us-apparel">Amazon · 美国站 · 成人服装</option><option value="custom">其他平台 / 自定义要求</option></select></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs">文案语言<input aria-label="文案语言" className={`${control} w-full`} maxLength={80} value={value.brief.language} onChange={event => updateBrief({ language: event.target.value })} /></label><label className="space-y-1 text-xs">目标人群<input aria-label="目标人群" className={`${control} w-full`} maxLength={500} value={value.brief.audience} placeholder="例如：日常通勤、周末徒步" onChange={event => updateBrief({ audience: event.target.value })} /></label></div>
          <label className="block space-y-1 text-xs">真实产品参数<textarea aria-label="真实产品参数" className={`${control} min-h-28 w-full resize-y`} maxLength={8000} value={value.brief.facts} placeholder="填写已核实的材质、颜色、尺寸、包装内容及可见细节。不清楚的参数可以注明待补充。" onChange={event => updateBrief({ facts: event.target.value, factsConfirmed: false })} /></label>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label="以上参数来自真实产品资料" checked={value.brief.factsConfirmed} onChange={event => updateBrief({ factsConfirmed: event.target.checked })} className="mt-0.5 accent-blue-500" />以上参数来自真实产品资料</label>
          <label className="block space-y-1 text-xs">视觉要求<textarea aria-label="视觉要求" className={`${control} min-h-20 w-full resize-y`} maxLength={4000} value={value.brief.visualNotes} placeholder="品牌调性、场景、构图，以及必须保留的细节" onChange={event => updateBrief({ visualNotes: event.target.value })} /></label>
          <label className="block space-y-1 text-xs">{value.brief.platform === 'custom' ? '自定义平台要求' : '补充平台要求（可选）'}<textarea aria-label="自定义平台要求" className={`${control} min-h-20 w-full resize-y`} maxLength={8000} value={value.brief.customRequirements} placeholder="具体平台、站点、类目、图片槽位、尺寸及文案限制" onChange={event => updateBrief({ customRequirements: event.target.value })} /></label>
        </section>
        <section className={box} aria-label="产品实拍参考">
          <h3 className="text-sm font-semibold">2 · 上传产品实拍</h3><p className={muted}>建议提供正面、背面和Logo、拉链等细节图。缺少的结构和性能资料会先询问。当前草稿共{references.length}张参考图，最多16张。</p>
          <div className="flex flex-wrap gap-2"><label className={`${control} cursor-pointer`}>上传产品实拍<input aria-label="上传产品实拍" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} className="sr-only" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; upload(files) }} /></label><button type="button" className={control} onClick={pickReferences}>从素材库选择</button></div>
        </section>
        <section className={box} aria-label="分图规划">
          <h3 className="text-sm font-semibold">3 · 讨论分图计划</h3>
          <div className="grid grid-cols-2 gap-3">{([['secondaryCount', '副图数量', 8], ['detailCount', '详情模块数量', 5]] as const).map(([key, label, max]) => <label key={key} className="space-y-1 text-xs">{label}<input aria-label={label} type="number" min={1} max={max} className={`${control} w-full`} value={value.brief[key]} onChange={event => updateBrief({ [key]: Math.max(1, Math.min(max, Number(event.target.value) || 1)) })} /></label>)}</div>
          <details><summary className="cursor-pointer text-xs">查看{plan.length}张初始规划与导出尺寸</summary><ol className="mt-3 space-y-2">{plan.map(item => <li key={item.id} className={muted}><strong className="text-[color:var(--app-text)]">{item.id} · {item.title}</strong><span className="ml-2">{item.width}×{item.height}</span><p>{item.description}</p></li>)}</ol></details>
          <button type="button" disabled={running} className={control} onClick={() => fill('plan')}>填入方案讨论</button>
        </section>
        <section className={box} aria-label="确认样稿与生成">
          <h3 className="text-sm font-semibold">4 · 先确认样稿，再分组生成</h3><p className={muted}>先生成一张主图样稿，核对商品颜色、版型、Logo与构图。确认后会加入参考图，后续各组保持同一视觉方向。</p>
          <button type="button" disabled={running} className={control} onClick={() => fill('sample')}>填入主图样稿</button>
          <label className="block space-y-1 text-xs">主图样稿<select aria-label="主图样稿 使用图片" className={`${control} w-full`} value={outputIds.has(value.sampleImageId ?? '') ? value.sampleImageId! : ''} onChange={event => update({ sampleImageId: event.target.value || null, sampleConfirmed: false })}><option value="">从当前会话成图中选择</option>{outputs.map(item => <option key={item.imageId} value={item.imageId}>{item.label}</option>)}</select></label>
          {value.sampleImageId && outputIds.has(value.sampleImageId) && <ProductThumb imageId={value.sampleImageId} label="请核对样稿中的颜色、版型与Logo" owner={owner!} />}
          <button type="button" className={control} disabled={!outputs.length || running} onClick={confirmSample}>确认样稿并作为参考</button>{confirmed && <p className="text-xs text-green-600 dark:text-green-400">样稿已确认</p>}
          <div className="flex flex-wrap gap-2">{([['main', '主图'], ['secondary', '副图'], ['detail', '详情模块']] as const).map(([phase, label]) => <button key={phase} type="button" disabled={running} className={control} onClick={() => fill(phase)}>填入{label}生成</button>)}</div>
          <button type="button" disabled={running} className={control} onClick={() => fill('copy')}>规划配套文案</button>
        </section>
        <details className={muted}><summary className="cursor-pointer">尺寸预设与平台要求 · {ECOMMERCE_RULES_CHECKED_AT}核对</summary><p className="mt-2">主图1500×2000、副图2000×2000为工作台导出预设。Amazon详情采用标准图片标题模块970×600；以商家后台实际槽位为准。使用A+需要相应商家资格。</p><div className="mt-2 flex flex-wrap gap-3">{ECOMMERCE_SOURCES.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-blue-500 underline">{source.title}</a>)}</div></details>
      </> : <>
        <p className={muted}>仅列出当前会话的成图。已选择{plan.filter(item => outputIds.has(value.assignments[item.id]?.imageId)).length}/{plan.length}项，可只导出已完成部分；原图会一并保留。留边保持完整商品，中心裁切可能裁去边缘，请按用途选择。</p>
        <p className={muted}>可按平台槽位修改每项导出宽高（64–4096像素，总像素不超过1600万）。生成阶段使用分组预设尺寸；明显改变比例时，建议先在原输入框调整生成比例并重生成，再整理导出。</p>
        {!outputs.length && <p className={muted}>当前会话暂无成图，请先完成样稿或分组生成。</p>}
        {plan.map(item => {
          const row = value.assignments[item.id]
          return <section key={item.id} className={box} aria-label={`${item.id}交付图片`}><h3 className="text-sm font-medium">{item.id} · {item.title}<span className="ml-2 text-xs font-normal text-[color:var(--app-text-muted)]">{row?.width ?? item.width}×{row?.height ?? item.height}</span></h3>
            <select aria-label={`${item.id} 使用图片`} className={`${control} w-full`} value={outputIds.has(row?.imageId) ? row.imageId : ''} onChange={event => assignment(item.id, { imageId: event.target.value })}><option value="">暂不导出此项</option>{outputs.map(output => <option key={output.imageId} value={output.imageId}>{output.label}</option>)}</select>
            <div className="grid grid-cols-2 gap-3">{(['width', 'height'] as const).map((axis) => <label key={axis} className="space-y-1 text-xs">导出{axis === 'width' ? '宽度' : '高度'}<input aria-label={`${item.id} 导出${axis === 'width' ? '宽度' : '高度'}`} type="number" min={64} max={4096} step={1} className={`${control} w-full`} value={row?.[axis] ?? item[axis]} onChange={event => assignment(item.id, { width: row?.width ?? item.width, height: row?.height ?? item.height, [axis]: Number(event.target.value) })} /></label>)}</div>
            {row?.imageId && outputIds.has(row.imageId) && <><ProductThumb imageId={row.imageId} label={item.title} owner={owner!} /><label className="block space-y-1 text-xs">尺寸处理<select aria-label={`${item.id} 尺寸处理`} className={`${control} w-full`} value={row.fit} onChange={event => assignment(item.id, { fit: event.target.value as 'contain' | 'cover' })}><option value="contain">等比留边 · 完整保留，白底补边</option><option value="cover">中心裁切 · 铺满画面，可能裁去边缘</option></select></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={`${item.id} 画面含拟真AI人物`} checked={row.syntheticPerson} onChange={event => assignment(item.id, { syntheticPerson: event.target.checked })} className="mt-0.5 accent-blue-500" />画面含拟真AI人物（导出写入人物来源标记）</label></>}
          </section>
        })}
        <label className="block space-y-2 text-xs">配套文案<textarea aria-label="配套文案" maxLength={40000} rows={8} value={value.copy} onChange={event => update({ copy: event.target.value })} placeholder="将Agent整理的商品标题、五点描述和各图文案粘贴到这里，核对后一起导出。" className={`${control} w-full resize-y`} /></label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label="已核对所选图片的商品细节、文案和人物标记" checked={value.reviewed} onChange={event => setValue(previous => ({ ...previous, reviewed: event.target.checked }))} className="mt-0.5 accent-blue-500" />已核对所选图片的商品细节、文案和人物标记</label>
        <button type="button" className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40" disabled={!value.reviewed || !plan.some(item => outputIds.has(value.assignments[item.id]?.imageId))} onClick={download}>下载电商素材包</button>
        <p className={muted}>ZIP含精确尺寸JPEG、原图、需求与规划JSON、可编辑文案和检查报告。文件检查记录尺寸、压缩和裁切情况，商品一致性及平台审核需另行核对。</p>
      </>}
      </fieldset>
      {pendingPhase && <div className="space-y-2 rounded-xl border border-amber-400/40 p-3"><p className="text-sm">当前草稿已有内容。替换后可继续编辑，尚未发送。</p><button type="button" disabled={busy} className={control} onClick={() => fill(pendingPhase, true)}>替换当前草稿</button></div>}
      <p className={muted}>表单按账户和会话保存在此浏览器。电商素材包包含需求与规划；本机数据备份ZIP暂不包含本表单记录。</p>
    </>}
    {busy && <p role="status" className={muted}>正在处理，请保持页面打开…</p>}
    {message && <p role="status" className="text-sm text-green-600 dark:text-green-400">{message}</p>}
    {error && <p role="alert" className="break-words text-sm text-red-500">{error}</p>}
  </WorkspaceDialog>
}
