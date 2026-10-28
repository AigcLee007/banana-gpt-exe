/** Explicit local-data namespaces. Deliberately independent of legacy config backups. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openAppDatabase } from './db'
import type { AgentConversation, StoredImage, StoredImageThumbnail, TaskRecord } from '../types'
import type { MediaPosterRecord, MediaRecord, VideoTaskRecord } from './videoTypes'
import type { VideoAssetCategoryRecord, VideoAssetRecord } from './videoAssetTypes'

export type WorkspaceDataScope = 'gallery' | 'agent' | 'video'
export interface WorkspaceSnapshot {
  tasks: TaskRecord[]
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  agentConversations: AgentConversation[]
  videoTasks: VideoTaskRecord[]
  media: MediaRecord[]
  mediaPosters: MediaPosterRecord[]
  videoAssets: VideoAssetRecord[]
  videoAssetCategories: VideoAssetCategoryRecord[]
}
const STORES = ['tasks', 'images', 'thumbnails', 'agentConversations', 'videoTasks', 'media', 'mediaPosters', 'videoAssets', 'videoAssetCategories'] as const
const SCOPES: WorkspaceDataScope[] = ['gallery', 'agent', 'video']
const FORMAT = 'studio-local-workspace'
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
type Row = { id: string }
type JsonObject = Record<string, any>

export function emptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return Object.fromEntries(STORES.map((store) => [store, []])) as unknown as WorkspaceSnapshot
}
function scopesOf(scopes: WorkspaceDataScope[]) {
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !SCOPES.includes(scope))) throw new Error('请选择有效的数据范围')
  return new Set(scopes)
}
function pick<T>(value: unknown, keys: string): T {
  const record = object(value)
  return Object.fromEntries(keys.split(' ').filter((key) => record[key] !== undefined).map((key) => [key, record[key]])) as T
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份记录格式无效')
  return value as JsonObject
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new Error('备份引用格式无效')
  return value
}
function optionalIds(value: unknown): string[] { return value === undefined ? [] : ids(value) }
function optionalId(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'string' || !value) throw new Error('备份引用格式无效')
  return [value]
}
function taskImageIds(task: TaskRecord) {
  return [...ids(task.inputImageIds), ...ids(task.outputImages), ...optionalIds(task.transparentOriginalImages), ...optionalIds(task.streamPartialImageIds), ...optionalId(task.maskImageId), ...optionalId(task.maskTargetImageId)]
}
function conversationTaskIds(conversations: AgentConversation[]) {
  return new Set(conversations.flatMap((conversation) => [...conversation.rounds, ...conversation.messages].flatMap((item) => optionalIds(item.outputTaskIds))))
}
function conversationImageIds(conversations: AgentConversation[]) {
  return conversations.flatMap((conversation) => [...conversation.rounds, ...conversation.messages].flatMap((item) => [...optionalIds(item.inputImageIds), ...optionalId(item.maskImageId), ...optionalId(item.maskTargetImageId)]))
}
function videoMediaIds(task: VideoTaskRecord) {
  const input = object(task.inputs)
  return [...ids(input.refImageIds), ...ids(input.refVideoIds), ...ids(input.refAudioIds), ...optionalId(input.firstFrameId), ...optionalId(input.lastFrameId), ...optionalId(input.sourceVideoId), ...optionalId(task.outputVideoId), ...optionalId(task.posterImageId), ...optionalId(task.lastFrameImageId), ...(input.refItems === undefined ? [] : input.refItems.map((item: JsonObject) => optionalId(object(item).id)[0]))]
}
function sanitizeTask(value: unknown): TaskRecord {
  const task = pick<TaskRecord>(value, 'id prompt params actualParams actualParamsByImage revisedPromptByImage transparentOutput transparentPrompt transparentOriginalImages inputImageIds maskTargetImageId maskImageId outputImages streamPartialImageIds status createdAt finishedAt elapsed isFavorite sourceMode agentConversationId agentRoundId agentMessageId agentToolCallId agentBatchCallId agentToolAction apiModel')
  task.params = pick(task.params, 'size geminiAspectRatio geminiImageSize geminiOutputPixels quality output_format output_compression moderation n transparent_output')
  if (typeof task.prompt !== 'string' || !['done', 'error'].includes(task.status) || typeof task.createdAt !== 'number') throw new Error('备份包含无效或正在运行的图片任务')
  task.error = null // Upstream error strings and raw payloads may contain credentials.
  taskImageIds(task)
  // Arbitrary provider response maps are excluded; only known parameter fields survive.
  if (task.actualParams) task.actualParams = pick(task.actualParams, 'size quality output_format output_compression moderation n transparent_output')
  if (task.actualParamsByImage) task.actualParamsByImage = Object.fromEntries(Object.entries(object(task.actualParamsByImage)).map(([id, params]) => [id, pick(params, 'size quality output_format output_compression moderation n transparent_output')]))
  return task
}
function sanitizeConversation(value: unknown): AgentConversation {
  const conversation = pick<AgentConversation>(value, 'id title activeRoundId createdAt updatedAt rounds messages')
  if (typeof conversation.title !== 'string' || !Array.isArray(conversation.rounds) || !Array.isArray(conversation.messages)) throw new Error('Agent 会话格式无效')
  conversation.rounds = conversation.rounds.map((value) => {
    const round = pick<AgentConversation['rounds'][number]>(value, 'id index parentRoundId userMessageId assistantMessageId prompt inputImageIds maskTargetImageId maskImageId outputTaskIds status createdAt finishedAt')
    if (!['done', 'error'].includes(round.status) || typeof round.prompt !== 'string') throw new Error('备份包含无效或正在运行的 Agent 轮次')
    ids(round.inputImageIds); ids(round.outputTaskIds)
    return { ...round, error: null }
  })
  conversation.messages = conversation.messages.map((value) => {
    const message = pick<AgentConversation['messages'][number]>(value, 'id role content roundId inputImageIds maskTargetImageId maskImageId outputTaskIds createdAt')
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('Agent 消息格式无效')
    return message
  })
  conversationImageIds([conversation]); conversationTaskIds([conversation])
  return conversation
}
function sanitizeVideoTask(value: unknown): VideoTaskRecord {
  const task = pick<VideoTaskRecord>(value, 'id prompt mode model params inputs status progress outputVideoId posterImageId lastFrameImageId actual parentTaskId estimatedCredits adapter createdAt finishedAt elapsed isFavorite')
  if (!['done', 'error', 'canceled'].includes(task.status) || typeof task.prompt !== 'string' || typeof task.model !== 'string') throw new Error('备份包含无效或正在运行的视频任务')
  task.params = pick(task.params, 'duration resolution aspectRatio audio seed negativePrompt cameraFixed watermark promptEnhance n')
  task.inputs = pick(task.inputs, 'firstFrameId lastFrameId refImageIds refVideoIds refAudioIds refItems sourceVideoId')
  if (task.inputs.refItems) task.inputs.refItems = task.inputs.refItems.map((item) => pick(item, 'id type'))
  if (task.actual) task.actual = pick(task.actual, 'duration width height hasAudio')
  task.error = null
  videoMediaIds(task)
  return task
}
function assertRows(rows: Row[]) {
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('备份包含无效或重复的记录 ID')
    seen.add(row.id)
  }
}
function requireReferences(data: WorkspaceSnapshot) {
  for (const key of STORES) assertRows(data[key])
  const imageIds = new Set(data.images.map((item) => item.id))
  const taskIds = new Set(data.tasks.map((item) => item.id))
  const mediaIds = new Set(data.media.map((item) => item.id))
  const categories = new Set(data.videoAssetCategories.map((item) => item.id))
  const requireIds = (refs: Iterable<string>, available: Set<string>) => {
    for (const id of refs) if (!available.has(id)) throw new Error('备份缺少关联作品或素材，请重新导出完整备份')
  }
  requireIds(data.tasks.flatMap(taskImageIds), imageIds)
  requireIds(conversationImageIds(data.agentConversations), imageIds)
  requireIds(conversationTaskIds(data.agentConversations), taskIds)
  requireIds(data.videoTasks.flatMap(videoMediaIds), mediaIds)
  requireIds(data.thumbnails.map((item) => item.id), imageIds)
  requireIds(data.mediaPosters.map((item) => item.id), mediaIds)
  for (const asset of data.videoAssets) {
    requireIds([asset.storageId], asset.storage === 'images' ? imageIds : mediaIds)
    requireIds(optionalId(asset.derivedMediaId), mediaIds)
    requireIds(optionalId(asset.categoryId), categories)
  }
}

/** Pure cleanup plan: only candidate data belonging to the selected namespace is collected. */
export function planWorkspaceCleanup(data: WorkspaceSnapshot, scopes: WorkspaceDataScope[], draftImageIds: string[] = [], clearedDraftImageIds: string[] = []): WorkspaceSnapshot {
  const selected = scopesOf(scopes)
  const result = { ...data }
  const retainedConversations = selected.has('agent') ? [] : data.agentConversations
  const retainedTaskIds = conversationTaskIds(retainedConversations)
  result.tasks = selected.has('gallery') ? data.tasks.filter((task) => retainedTaskIds.has(task.id)) : data.tasks
  result.agentConversations = retainedConversations
  if (selected.has('video')) {
    result.videoTasks = []; result.media = []; result.mediaPosters = []; result.videoAssets = []; result.videoAssetCategories = []
  }
  const candidates = new Set([
    ...clearedDraftImageIds,
    ...(selected.has('gallery') ? data.tasks.flatMap(taskImageIds) : []),
    ...(selected.has('agent') ? conversationImageIds(data.agentConversations) : []),
    ...(selected.has('video') && selected.has('gallery') ? data.videoAssets.filter((asset) => asset.storage === 'images').map((asset) => asset.storageId) : []),
  ])
  const retained = new Set([...draftImageIds, ...result.tasks.flatMap(taskImageIds), ...conversationImageIds(retainedConversations), ...result.videoAssets.filter((asset) => asset.storage === 'images').map((asset) => asset.storageId)])
  result.images = data.images.filter((image) => !candidates.has(image.id) || retained.has(image.id))
  const kept = new Set(result.images.map((image) => image.id))
  result.thumbnails = data.thumbnails.filter((image) => kept.has(image.id))
  return result
}

function selectSnapshot(data: WorkspaceSnapshot, scopes: WorkspaceDataScope[]) {
  const selected = scopesOf(scopes)
  const result = emptyWorkspaceSnapshot()
  if (selected.has('agent')) result.agentConversations = data.agentConversations.map(sanitizeConversation)
  const dependent = conversationTaskIds(result.agentConversations)
  result.tasks = data.tasks.filter((task) => selected.has('gallery') || dependent.has(task.id)).map(sanitizeTask)
  if (selected.has('video')) {
    result.videoTasks = data.videoTasks.map(sanitizeVideoTask)
    result.media = data.media.map((item) => pick(item, 'id blob mime size filename duration width height source uploadedAt hash'))
    result.mediaPosters = data.mediaPosters.map((item) => pick(item, 'id blob width height'))
    result.videoAssets = data.videoAssets.map((item) => pick(item, 'id type displayName categoryId createdAt updatedAt mime size duration width height source storage storageId derivedMediaId removedAt'))
    result.videoAssetCategories = data.videoAssetCategories.map((item) => pick(item, 'id name createdAt updatedAt'))
  }
  const imageIds = new Set([...result.tasks.flatMap(taskImageIds), ...conversationImageIds(result.agentConversations), ...result.videoAssets.filter((asset) => asset.storage === 'images').map((asset) => asset.storageId)])
  result.images = data.images.filter((image) => imageIds.has(image.id)).map((image) => pick(image, 'id dataUrl source createdAt width height'))
  result.thumbnails = data.thumbnails.filter((image) => imageIds.has(image.id)).map((image) => pick(image, 'id thumbnailDataUrl width height thumbnailVersion'))
  requireReferences(result)
  return result
}

export async function buildWorkspaceArchive(data: WorkspaceSnapshot, scopes: WorkspaceDataScope[]): Promise<Uint8Array> {
  const selected = selectSnapshot(data, scopes)
  const files: Record<string, Uint8Array> = {}
  const images = selected.images.map((image, index) => {
    const path = `images/${index}.json`
    files[path] = strToU8(JSON.stringify(image))
    return { id: image.id, path }
  })
  const thumbnails = selected.thumbnails.map((image, index) => {
    const path = `thumbnails/${index}.json`
    files[path] = strToU8(JSON.stringify(image))
    return { id: image.id, path }
  })
  const encodeBlobs = async (records: (MediaRecord | MediaPosterRecord)[], directory: string) => Promise.all(records.map(async (record, index) => {
    const path = `${directory}/${index}.bin`
    files[path] = new Uint8Array(await record.blob.arrayBuffer())
    const { blob, ...metadata } = record
    return { ...metadata, path, blobType: blob.type }
  }))
  const manifest = {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(), scopes: [...scopesOf(scopes)],
    namespaces: {
      ...(scopes.includes('gallery') ? { gallery: { tasks: selected.tasks } } : {}),
      ...(scopes.includes('agent') ? { agent: { conversations: selected.agentConversations, tasks: selected.tasks.filter((task) => conversationTaskIds(selected.agentConversations).has(task.id)) } } : {}),
      ...(scopes.includes('video') ? { video: { tasks: selected.videoTasks, media: await encodeBlobs(selected.media, 'media'), posters: await encodeBlobs(selected.mediaPosters, 'posters'), assets: selected.videoAssets, categories: selected.videoAssetCategories } } : {}),
    }, images, thumbnails,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files, { level: 6 })
}

/** Old v3 ZIPs mixed settings with works. Read only the explicit works fields. */
function parseLegacyWorkspaceArchive(manifest: JsonObject, payload: (path: unknown) => Uint8Array, scopes: WorkspaceDataScope[]): WorkspaceSnapshot {
  if (scopes.includes('video')) throw new Error('旧版备份不包含视频数据，请仅选择画廊或 Agent 后导入')
  if (!Array.isArray(manifest.tasks) || !manifest.imageFiles) throw new Error('旧版备份缺少作品数据，请选择包含作品和图片的 ZIP')
  const data = emptyWorkspaceSnapshot()
  data.tasks = manifest.tasks.map(sanitizeTask)
  if (manifest.agentConversations !== undefined && !Array.isArray(manifest.agentConversations)) throw new Error('旧版备份 Agent 会话格式无效')
  data.agentConversations = (manifest.agentConversations ?? []).map(sanitizeConversation)
  const imageDataUrl = (path: unknown) => {
    const bytes = payload(path)
    const extension = String(path).split('.').pop()?.toLowerCase() ?? 'png'
    const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>)[extension] ?? 'image/png'
    let binary = ''
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
    return `data:${mime};base64,${btoa(binary)}`
  }
  data.images = Object.entries(object(manifest.imageFiles)).map(([id, value]) => {
    const info = object(value)
    return { ...pick<StoredImage>(info, 'createdAt source width height'), id, dataUrl: imageDataUrl(info.path) }
  })
  data.thumbnails = Object.entries(object(manifest.thumbnailFiles ?? {})).map(([id, value]) => {
    const info = object(value)
    return { ...pick<StoredImageThumbnail>(info, 'width height thumbnailVersion'), id, thumbnailDataUrl: imageDataUrl(info.path) }
  })
  requireReferences(data)
  return selectSnapshot(data, scopes)
}

/** Stage and validate every namespace and payload before any IndexedDB write. */
export function parseWorkspaceArchive(bytes: Uint8Array, scopes: WorkspaceDataScope[]): WorkspaceSnapshot {
  scopesOf(scopes)
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('备份超过 512 MB，请分范围导出')
  // Check declared inflated size before decompression, including files not referenced by the manifest.
  let inflated = 0
  const files = unzipSync(bytes, { filter: (entry) => {
    inflated += entry.originalSize
    if (!Number.isFinite(inflated) || inflated > MAX_ARCHIVE_BYTES) throw new Error('备份解压后超过 512 MB')
    return true
  } })
  const payload = (path: unknown) => {
    if (typeof path !== 'string' || !files[path]) throw new Error('备份缺少素材文件')
    return files[path]
  }
  const manifest = object(JSON.parse(strFromU8(payload('manifest.json'))))
  if (manifest.version === 3 && manifest.format === undefined) return parseLegacyWorkspaceArchive(manifest, payload, scopes)
  if (manifest.format !== FORMAT || manifest.version !== 1) throw new Error('请选择新版工作区本地数据备份 ZIP')
  const available = [...scopesOf(manifest.scopes)]
  if (scopes.some((scope) => !available.includes(scope))) throw new Error('备份不包含所选数据范围')
  const namespaces = object(manifest.namespaces)
  const data = emptyWorkspaceSnapshot()
  const rows = (value: unknown): JsonObject[] => {
    if (!Array.isArray(value)) throw new Error('备份列表格式无效')
    return value.map(object)
  }
  const allTasks = new Map<string, TaskRecord>()
  for (const scope of available) {
    const namespace = object(namespaces[scope])
    if (scope === 'gallery' || scope === 'agent') {
      const tasks = rows(namespace.tasks).map(sanitizeTask)
      assertRows(tasks)
      for (const task of tasks) {
        if (allTasks.has(task.id) && JSON.stringify(allTasks.get(task.id)) !== JSON.stringify(task)) throw new Error('备份关联任务冲突')
        allTasks.set(task.id, task)
      }
      if (scope === 'agent') data.agentConversations = rows(namespace.conversations).map(sanitizeConversation)
    } else {
      data.videoTasks = rows(namespace.tasks).map(sanitizeVideoTask)
      const decodeBlob = (record: JsonObject) => new Blob([payload(record.path).slice().buffer as ArrayBuffer], { type: typeof record.blobType === 'string' ? record.blobType : '' })
      data.media = rows(namespace.media).map((record) => ({ ...pick<MediaRecord>(record, 'id mime size filename duration width height source uploadedAt hash'), blob: decodeBlob(record) }))
      data.mediaPosters = rows(namespace.posters).map((record) => ({ ...pick<MediaPosterRecord>(record, 'id width height'), blob: decodeBlob(record) }))
      data.videoAssets = rows(namespace.assets).map((record) => {
        const asset = pick<VideoAssetRecord>(record, 'id type displayName categoryId createdAt updatedAt mime size duration width height source storage storageId derivedMediaId removedAt')
        if (!['media', 'images'].includes(asset.storage) || !['image', 'video', 'audio'].includes(asset.type)) throw new Error('视频素材格式无效')
        return asset
      })
      data.videoAssetCategories = rows(namespace.categories).map((record) => pick(record, 'id name createdAt updatedAt'))
    }
  }
  data.tasks = [...allTasks.values()]
  const decodeImage = (record: JsonObject, thumbnail = false) => {
    const image = object(JSON.parse(strFromU8(payload(record.path))))
    if (image.id !== record.id || typeof image[thumbnail ? 'thumbnailDataUrl' : 'dataUrl'] !== 'string' || !/^data:image\//.test(image[thumbnail ? 'thumbnailDataUrl' : 'dataUrl'])) throw new Error('备份图片格式无效')
    return image
  }
  data.images = rows(manifest.images).map((record) => pick(decodeImage(record), 'id dataUrl source createdAt width height'))
  data.thumbnails = rows(manifest.thumbnails).map((record) => pick(decodeImage(record, true), 'id thumbnailDataUrl width height thumbnailVersion'))
  requireReferences(data)
  // Select using the original namespace task membership; Agent dependencies are shared Gallery rows.
  const selected = selectSnapshot(data, scopes)
  if (!scopes.includes('gallery')) return selected
  const galleryIds = new Set(rows(namespaces.gallery.tasks).map((task) => task.id))
  const dependent = conversationTaskIds(selected.agentConversations)
  selected.tasks = selected.tasks.filter((task) => galleryIds.has(task.id) || dependent.has(task.id))
  return selected
}

/** All stores share one IndexedDB transaction: failures leave every namespace unchanged. */
async function databaseSnapshot(mode: IDBTransactionMode, update?: (data: WorkspaceSnapshot) => WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const db = await openAppDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...STORES], mode)
    const data = emptyWorkspaceSnapshot()
    let result = data
    let remaining = STORES.length
    let failure: unknown
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('本地数据事务已中止'))
    tx.onerror = () => reject(failure ?? tx.error ?? new Error('本地数据操作失败'))
    tx.oncomplete = () => resolve(result)
    for (const key of STORES) {
      const request = tx.objectStore(key).getAll()
      request.onsuccess = () => {
        ;(data[key] as Row[]) = request.result
        if (--remaining || !update) return
        try {
          result = update(data)
          for (const store of STORES) {
            const previous = new Map<string, Row>(data[store].map((row) => [row.id, row]))
            const kept = new Set(result[store].map((row) => row.id))
            for (const row of data[store]) if (!kept.has(row.id)) tx.objectStore(store).delete(row.id)
            for (const row of result[store]) if (previous.get(row.id) !== row) tx.objectStore(store).put(row)
          }
        } catch (error) { failure = error; tx.abort() }
      }
    }
  })
}
async function runtime() {
  const [{ useStore }, { useVideoStore }, { useVideoAssetStore }] = await Promise.all([import('../store'), import('../videoStore'), import('../videoAssetStore')])
  return { useStore, useVideoStore, useVideoAssetStore }
}
function assertIdle(data: WorkspaceSnapshot) {
  if (data.tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable) || data.agentConversations.some((conversation) => conversation.rounds.some((round) => round.status === 'running')) || data.videoTasks.some((task) => task.status === 'running' || task.status === 'queued' || task.processing)) throw new Error('存在正在运行或等待恢复的任务，请完成或停止任务后再操作本地数据')
}
function assertRuntimeIdle(stores: Awaited<ReturnType<typeof runtime>>) {
  const state = stores.useStore.getState()
  const video = stores.useVideoStore.getState()
  assertIdle({ ...emptyWorkspaceSnapshot(), tasks: state.tasks, agentConversations: state.agentConversations, videoTasks: video.tasks })
  if (video.isGenerating || video.uploadingFiles.size || stores.useVideoAssetStore.getState().loading || Object.keys(state.agentGeneratingTitleIds).length) throw new Error('正在生成、上传或加载素材，请稍后再操作本地数据')
}
async function refresh(stores: Awaited<ReturnType<typeof runtime>>, data: WorkspaceSnapshot, cleared: WorkspaceDataScope[] = []) {
  const state = stores.useStore.getState()
  const active = data.agentConversations.some((item) => item.id === state.activeAgentConversationId) ? state.activeAgentConversationId : data.agentConversations[0]?.id ?? null
  stores.useStore.setState({ tasks: data.tasks, agentConversations: data.agentConversations, activeAgentConversationId: active, selectedTaskIds: [], detailTaskId: null, lightboxImageId: null,
    ...(cleared.includes('agent') ? { agentInputDrafts: {}, agentEditingRoundId: null, agentEditingConversationId: null } : {}),
    ...(cleared.includes('gallery') ? { galleryInputDraft: null } : {}),
    ...(cleared.includes(state.appMode === 'agent' ? 'agent' : 'gallery') ? { prompt: '', inputImages: [], maskDraft: null, maskEditorImageId: null } : {}),
  })
  stores.useVideoStore.setState({ tasks: data.videoTasks, selectedTaskIds: new Set(), detailTaskId: null,
    ...(cleared.includes('video') ? { prompt: '', firstFrameId: null, lastFrameId: null, sourceVideoId: null, refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [] } : {}),
  })
  await stores.useVideoAssetStore.getState().load()
}
let mutationInProgress = false
async function mutate(operation: (stores: Awaited<ReturnType<typeof runtime>>) => Promise<void>) {
  if (mutationInProgress) throw new Error('另一项本地数据操作尚未完成')
  mutationInProgress = true
  try { const stores = await runtime(); await assertRuntimeIdle(stores); await operation(stores) } finally { mutationInProgress = false }
}
export async function getWorkspaceDataCounts(): Promise<Record<WorkspaceDataScope, number>> {
  const data = await databaseSnapshot('readonly')
  return { gallery: data.tasks.length, agent: data.agentConversations.length, video: data.videoTasks.length }
}
export async function getWorkspaceResourceCounts(): Promise<{ images: number; media: number; videoAssets: number }> {
  const data = await databaseSnapshot('readonly')
  return { images: data.images.length, media: data.media.length, videoAssets: data.videoAssets.filter((asset) => !asset.removedAt).length }
}
export async function exportWorkspaceData(scopes: WorkspaceDataScope[]): Promise<void> {
  const data = await databaseSnapshot('readonly')
  const bytes = await buildWorkspaceArchive(data, scopes)
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `studio-local-${scopes.join('-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`; anchor.click()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}
export async function importWorkspaceData(file: File, scopes: WorkspaceDataScope[]): Promise<void> {
  await mutate(async (stores) => {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('备份超过 512 MB，请分范围导出')
    const incoming = parseWorkspaceArchive(new Uint8Array(await file.arrayBuffer()), scopes)
    await assertRuntimeIdle(stores)
    const data = await databaseSnapshot('readwrite', (existing) => {
      assertRuntimeIdle(stores)
      assertIdle(existing)
      const merged = emptyWorkspaceSnapshot()
      for (const key of STORES) {
        const current = new Map<string, Row>(existing[key].map((row) => [row.id, row]))
        for (const row of incoming[key]) {
          const conflict = current.get(row.id)
          // Content-identical shared image/task records are safe to reuse. Never overwrite.
          if (conflict && JSON.stringify(conflict) !== JSON.stringify(row)) throw new Error('备份记录 ID 与现有数据冲突，未导入任何数据；请使用空白工作区恢复')
          if (conflict && (key === 'media' || key === 'mediaPosters')) throw new Error('备份媒体 ID 与现有数据冲突，未导入任何数据')
          if (!conflict) current.set(row.id, row)
        }
        ;(merged[key] as Row[]) = [...current.values()]
      }
      return merged
    })
    await refresh(stores, data)
  })
}
export async function clearWorkspaceData(scopes: WorkspaceDataScope[]): Promise<void> {
  scopesOf(scopes)
  await mutate(async (stores) => {
    const state = stores.useStore.getState()
    const retainedDraftIds: string[] = []
    const clearedDraftIds: string[] = []
    const collectDraft = (draft: { inputImages: { id: string }[]; maskDraft?: { targetImageId: string } | null; maskEditorImageId?: string | null } | null, scope: WorkspaceDataScope) => {
      if (!draft) return
      const target = scopes.includes(scope) ? clearedDraftIds : retainedDraftIds
      target.push(...draft.inputImages.map((image) => image.id), ...optionalId(draft.maskDraft?.targetImageId), ...optionalId(draft.maskEditorImageId))
    }
    collectDraft(state.galleryInputDraft, 'gallery')
    for (const draft of Object.values(state.agentInputDrafts)) collectDraft(draft, 'agent')
    collectDraft(state, state.appMode === 'agent' ? 'agent' : 'gallery')
    const data = await databaseSnapshot('readwrite', (existing) => {
      assertRuntimeIdle(stores)
      assertIdle(existing)
      return planWorkspaceCleanup(existing, scopes, retainedDraftIds, clearedDraftIds)
    })
    await refresh(stores, data, scopes)
  })
}
