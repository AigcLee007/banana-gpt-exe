import { createInputImageFromFile, useStore } from '../store'
import { useVideoStore } from '../videoStore'
import { getAllImages, getImage } from './db'
import { getAllMedia, getMedia } from './videoDb'
import { getVideoModelDefinition } from './videoModels'
import { createArchiveQueue, localAssetRows, validateAssetSelection, type ArchiveRecord, type PortalAssets, type SelectedAsset } from './portalAssetAdapter'
import { managedLocalAssetAllowed, assertManagedLocalAsset } from './portalAssetOwnership'

declare global { interface Window { __AAP_ASSETS__?: PortalAssets } }
type Source = 'gallery' | 'agent' | 'video'
const sourceLabels = { gallery: '画廊', agent: 'Agent', video: '视频' }
let queue: ReturnType<typeof createArchiveQueue> | undefined
let bound = false

export function studioAssetLimits(source: Source): Record<string, number> {
  if (source !== 'video') return { text: 1, image: Math.max(0, 16 - (useStore.getState().appMode === source ? useStore.getState().inputImages.length : 0)) }
  const state = useVideoStore.getState()
  const model = getVideoModelDefinition(state.model)
  if (state.inputMode !== 'reference') return { text: 1, image: Math.max(0, (model?.modes.flf2v ? 2 : model?.modes.i2v ? 1 : 0) - Number(!!state.firstFrameId) - Number(!!state.lastFrameId)) }
  const spec = model?.modes.ref2v
  return { text: 1, image: Math.max(0, (spec?.maxImages || 0) - state.refImageIds.length), video: Math.max(0, (spec?.maxVideos || 0) - state.refVideoIds.length), audio: Math.max(0, (spec?.maxAudios || 0) - state.refAudioIds.length) }
}

export async function useStudioAssets(source: Source, items: SelectedAsset[]) {
  if (!items.length) return
  validateAssetSelection(items, studioAssetLimits(source))
  const text = items.filter(item => item.asset.kind === 'text').map(async item => item.text ?? item.blob.text())
  // Decode before changing the active draft, including text fetched by another panel.
  const prompt = (await Promise.all(text)).join('\n\n')
  const media = items.filter(item => item.asset.kind !== 'text')
  if (source === 'video') {
    const state = useVideoStore.getState()
    const definition = getVideoModelDefinition(state.model)
    for (const item of media) {
      const kind = item.asset.kind
      const allowed = kind === 'image' ? definition?.imageMimeTypes : kind === 'video' ? definition?.videoMimeTypes : definition?.audioMimeTypes
      const max = kind === 'image' ? definition?.maxImageBytes : kind === 'video' ? definition?.maxVideoBytes : definition?.maxAudioBytes
      if (allowed && !allowed.includes(item.blob.type) || max && item.blob.size > max) throw new Error('所选素材类型或大小不符合当前视频模型要求')
    }
    const prepared = []
    for (const item of media) prepared.push({ id: await state.uploadFile(new File([item.blob], item.asset.title, { type: item.blob.type })), type: item.asset.kind as 'image' | 'video' | 'audio' })
    useStore.getState().setAppMode('video')
    for (const item of prepared) {
      const current = useVideoStore.getState()
      if (current.inputMode === 'reference') current.addReference(item)
      else if (!current.firstFrameId) current.setFirstFrame(item.id)
      else current.setLastFrame(item.id)
    }
    if (prompt) state.setPrompt([state.prompt, prompt].filter(Boolean).join('\n\n'))
  } else {
    const prepared = []
    for (const item of media) prepared.push(await createInputImageFromFile(new File([item.blob], item.asset.title, { type: item.blob.type })))
    useStore.getState().setAppMode(source)
    const state = useStore.getState()
    if (state.inputImages.length + prepared.length > 16) throw new Error('当前草稿参考图数量超出上限')
    for (const image of prepared) if (image) state.addInputImage(image)
    if (prompt) state.setPrompt([state.prompt, prompt].filter(Boolean).join('\n\n'))
  }
  useStore.getState().showToast('素材已添加到草稿，请确认后生成', 'success')
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('aap:composer-expand'))
}

async function localStudioAssets(source: Source) {
  const owner = (window.__AAP__ as { userId?: number } | undefined)?.userId
  if (source === 'video') return localAssetRows((await getAllMedia()).filter(row => managedLocalAssetAllowed(`media:${row.id}`, owner) && /^(image|video|audio)\//.test(row.mime)).map(row => ({
    id: `media:${row.id}`, title: row.filename || '仅本机视频素材', kind: row.mime.split('/')[0],
    load: async () => { assertManagedLocalAsset(`media:${row.id}`, owner); const stored = await getMedia(row.id); if (!stored) throw Error('原文件缺失'); return { blob: stored.blob } },
  })))
  return localAssetRows((await getAllImages()).filter(row => managedLocalAssetAllowed(`image:${row.id}`, owner)).map(row => ({
    id: `image:${row.id}`, title: row.source === 'generated' ? '仅本机生成图片' : '仅本机参考图片', kind: 'image',
    load: async () => { assertManagedLocalAsset(`image:${row.id}`, owner); const stored = await getImage(row.id); if (!stored) throw Error('原文件缺失'); return { blob: await (await fetch(stored.dataUrl)).blob() } },
  })))
}

async function loadArchive(record: ArchiveRecord) {
  const [storage, ...parts] = record.sourceRef.split(':')
  const id = parts.join(':')
  if (storage === 'image') { const image = await getImage(id); if (!image) throw Error('原文件缺失'); return { blob: await (await fetch(image.dataUrl)).blob() } }
  const media = await getMedia(id); if (!media) throw Error('原文件缺失'); return { blob: media.blob }
}

export function studioArchiveRecords() { return queue?.records() || [] }
export async function retryStudioArchives() { await queue?.retry() }
export async function pickStudioAssets(source: Source = useStore.getState().appMode) {
  try {
    const shared = window.__AAP_ASSETS__
    if (!shared) return
    await shared.ready
    const kinds = Object.entries(studioAssetLimits(source)).filter(([, count]) => count > 0).map(([kind]) => kind)
    const selected = await shared.pick({ source, kinds, multiple: true })
    await useStudioAssets(source, selected)
  } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '添加素材失败，请重试', 'error') }
}

export function installStudioAssets() {
  let disposed = false
  let unregister: Array<() => void> = []
  const register = async () => {
    const shared = window.__AAP_ASSETS__
    if (!shared || bound) return
    await shared.ready
    if (disposed || bound) return
    bound = true
    unregister = (['gallery', 'agent', 'video'] as const).map(source => shared.register({ source, label: sourceLabels[source], kinds: source === 'video' ? ['image', 'video', 'audio', 'text'] : ['image', 'text'], use: items => useStudioAssets(source, items), local: () => localStudioAssets(source) }))
    const owner = () => (window.__AAP__ as { userId?: number } | undefined)?.userId
    const key = `aap:studio-archives:${owner()}`
    let initial: ArchiveRecord[] = []
    try { initial = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* Preserve native files. */ }
    queue = createArchiveQueue({ owner, load: loadArchive, save: input => shared.save(input), persist: value => localStorage.setItem(key, value), changed: () => window.dispatchEvent(new Event('aap:archive-state')) }, initial)
    window.dispatchEvent(new Event('aap:archive-state'))
  }
  const archive = (event: Event) => {
    const item = (event as CustomEvent<{ storage: string; id: string; title: string; source?: string }>).detail
    void (async () => {
      await register()
      const source = item.source === 'video' ? 'video' : useStore.getState().appMode === 'agent' ? 'agent' : 'gallery'
      await queue?.add({ id: `${item.storage}:${item.id}`, title: item.title, source, sourceRef: `${item.storage}:${item.id}` })
    })().catch(() => useStore.getState().showToast('未能存入本机素材库，可重试', 'error'))
  }
  window.addEventListener('aap:assets-ready', register)
  window.addEventListener('aap:studio-media', archive)
  void register().catch(() => undefined)
  return () => { disposed = true; unregister.forEach(off => off()); bound = false; window.removeEventListener('aap:assets-ready', register); window.removeEventListener('aap:studio-media', archive) }
}
