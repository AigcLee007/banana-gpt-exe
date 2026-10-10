// 视频工作台状态管理

import { create } from 'zustand'
import { createLocalId } from './lib/localId'
import { persist } from 'zustand/middleware'
import type { VideoMode, VideoParams } from './lib/videoModels'
import type { VideoTaskRecord, VideoReferenceItem } from './lib/videoTypes'
import {
  DEFAULT_VIDEO_MODEL,
  normalizeVideoParams,
  fallbackVideoMode,
  estimateVideoCredits,
  getVideoModelDefinition,
} from './lib/videoModels'
import {
  getMedia,
  getAllVideoTasks,
  putVideoTask,
  deleteVideoTask,
  deleteMedia,
  uploadMediaFile,
  requestPersistentStorage,
} from './lib/videoDb'
import { submitVideoTask, pollVideoTask, downloadVideoContent, formatVideoTaskError } from './lib/videoApi'
import { getActiveApiProfile } from './lib/apiProfiles'
import { useStore } from './store'
import { groupVideoReferences, serializeVideoPrompt, getFrameReferences } from './lib/videoPromptMentions'

export interface VideoStoreState {
  // 当前参数
  mode: VideoMode
  inputMode: 'create' | 'reference'
  model: string
  params: VideoParams
  prompt: string

  // 素材
  firstFrameId: string | null
  lastFrameId: string | null
  refImageIds: string[]
  refVideoIds: string[]
  refAudioIds: string[]
  refItems: VideoReferenceItem[]
  sourceVideoId: string | null

  // 任务列表
  tasks: VideoTaskRecord[]
  selectedTaskIds: Set<string>
  detailTaskId: string | null

  // UI 状态
  isGenerating: boolean
  uploadingFiles: Set<string>

  // Actions
  setMode: (mode: VideoMode) => void
  setInputMode: (mode: 'create' | 'reference') => void
  setModel: (model: string) => void
  setParams: (params: Partial<VideoParams>) => void
  setPrompt: (prompt: string) => void
  setFirstFrame: (id: string | null) => void
  setLastFrame: (id: string | null) => void
  addReference: (item: VideoReferenceItem) => void
  setReferenceItems: (items: VideoReferenceItem[]) => void
  removeReference: (id: string) => void
  setRefImages: (ids: string[]) => void
  addRefImage: (id: string) => void
  removeRefImage: (id: string) => void
  setRefVideos: (ids: string[]) => void
  addRefVideo: (id: string) => void
  removeRefVideo: (id: string) => void
  setRefAudios: (ids: string[]) => void
  addRefAudio: (id: string) => void
  removeRefAudio: (id: string) => void
  setSourceVideo: (id: string | null) => void
  swapFirstLastFrame: () => void

  uploadFile: (file: File) => Promise<string>
  generateVideo: () => Promise<void>
  cancelTask: (id: string) => void
  deleteTask: (id: string) => Promise<void>
  toggleFavorite: (id: string) => void
  setTasksFavorite: (ids: string[], favorite: boolean) => Promise<void>
  setSelection: (ids: string[]) => void
  selectTask: (id: string) => void
  deselectTask: (id: string) => void
  toggleSelectTask: (id: string) => void
  clearSelection: () => void
  setDetailTask: (id: string | null) => void
  reuseTaskConfig: (id: string) => void

  loadTasks: () => Promise<void>
  recoverTasks: () => void
}

const videoPollingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const taskGenerations = new Map<string, number>()
const deletedTaskIds = new Set<string>()
const taskWrites = new Map<string, Promise<unknown>>()
const submissionControllers = new Map<string, AbortController>()

function invalidateTask(taskId: string): number {
  submissionControllers.get(taskId)?.abort()
  submissionControllers.delete(taskId)
  const generation = (taskGenerations.get(taskId) ?? 0) + 1
  taskGenerations.set(taskId, generation)
  return generation
}

// Always re-read after an await; stale submit/poll snapshots must not revive a task.
function getActiveTask(taskId: string, generation: number): VideoTaskRecord | undefined {
  if (deletedTaskIds.has(taskId) || (taskGenerations.get(taskId) ?? 0) !== generation) return undefined
  const task = useVideoStore.getState().tasks.find((item) => item.id === taskId)
  return task?.status === 'canceled' ? undefined : task
}

function queueTaskWrite(taskId: string, write: () => Promise<unknown>): Promise<void> {
  const previous = taskWrites.get(taskId) ?? Promise.resolve()
  let queued: Promise<void>
  queued = previous.catch(() => {}).then(write).then(() => {}).finally(() => {
    if (taskWrites.get(taskId) === queued) taskWrites.delete(taskId)
  })
  taskWrites.set(taskId, queued)
  return queued
}

function persistLatestTask(taskId: string): Promise<void> {
  return queueTaskWrite(taskId, async () => {
    if (deletedTaskIds.has(taskId)) return
    const task = useVideoStore.getState().tasks.find((item) => item.id === taskId)
    if (task) await putVideoTask(task)
  })
}

async function updateActiveTask(taskId: string, generation: number, patch: Partial<VideoTaskRecord>): Promise<boolean> {
  if (!getActiveTask(taskId, generation)) return false
  useVideoStore.setState((s) => ({
    tasks: s.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task),
  }))
  await persistLatestTask(taskId)
  return !!getActiveTask(taskId, generation)
}

export function resolveVideoMode(inputMode: 'create' | 'reference', firstFrameId: string | null, lastFrameId: string | null): VideoMode {
  if (inputMode === 'reference') return 'ref2v'
  if (firstFrameId && lastFrameId) return 'flf2v'
  if (firstFrameId) return 'i2v'
  return 't2v'
}

function referenceLimit(model: string, type: VideoReferenceItem['type']): number {
  const spec = getVideoModelDefinition(model)?.modes.ref2v
  return (type === 'image' ? spec?.maxImages : type === 'video' ? spec?.maxVideos : spec?.maxAudios) ?? 0
}

function supportedReferences(model: string, items: VideoReferenceItem[]): VideoReferenceItem[] {
  const counts = { image: 0, video: 0, audio: 0 }
  return items.filter((item) => ++counts[item.type] <= referenceLimit(model, item.type))
}

export const useVideoStore = create<VideoStoreState>()(persist((set, get) => ({
  // 初始状态
  mode: 't2v',
  inputMode: 'create',
  model: DEFAULT_VIDEO_MODEL,
  params: normalizeVideoParams({}, DEFAULT_VIDEO_MODEL, 't2v'),
  prompt: '',

  firstFrameId: null,
  lastFrameId: null,
  refImageIds: [],
  refVideoIds: [],
  refAudioIds: [],
  refItems: [],
  sourceVideoId: null,

  tasks: [],
  selectedTaskIds: new Set(),
  detailTaskId: null,

  isGenerating: false,
  uploadingFiles: new Set(),

  // Actions
  setInputMode: (inputMode) => {
    const { model, firstFrameId, lastFrameId, params, refItems } = get()
    const def = getVideoModelDefinition(model)
    if (inputMode === 'reference' && !def?.modes.ref2v) {
      set({ inputMode: 'create', mode: resolveVideoMode('create', firstFrameId, def?.modes.flf2v ? lastFrameId : null) })
      return
    }
    const nextMode = resolveVideoMode(inputMode, firstFrameId, def?.modes.flf2v ? lastFrameId : null)
    set({ inputMode, mode: nextMode, params: normalizeVideoParams(params, model, nextMode, nextMode === 'ref2v' && refItems.some(item => item.type === 'video')) })
  },

  setMode: (mode) => {
    const { model, params } = get()
    const def = getVideoModelDefinition(model)
    if (def && !def.modes[mode]) {
      const fallbackM = fallbackVideoMode(model, mode)
      set({ mode: fallbackM, inputMode: fallbackM === 'ref2v' ? 'reference' : 'create', params: normalizeVideoParams(params, model, fallbackM) })
      useStore.getState().showToast(`当前模型不支持${mode}模式，已切换到${fallbackM}`, 'info')
      return
    }
    set({ mode, inputMode: mode === 'ref2v' ? 'reference' : 'create', params: normalizeVideoParams(params, model, mode, mode === 'ref2v' && get().refItems.some(item => item.type === 'video')) })
  },

  setModel: (model) => {
    const { mode, params, model: previousModel, refItems } = get()
    const def = getVideoModelDefinition(model)
    const requestedMode = fallbackVideoMode(model, mode)
    const inputMode = requestedMode === 'ref2v' ? 'reference' : 'create'
    const safeInputMode = inputMode === 'reference' && !def?.modes.ref2v ? 'create' : inputMode
    const safeLastFrameId = def?.modes.flf2v ? get().lastFrameId : null
    const newMode = resolveVideoMode(safeInputMode, get().firstFrameId, safeLastFrameId)
    const references = supportedReferences(model, refItems)
    const hasVideo = newMode === 'ref2v' && references.some(item => item.type === 'video')
    const nextParams = def?.fixedQuantity && previousModel !== model
      ? normalizeVideoParams({ duration: def?.duration.default, resolution: def?.resolutions[0], aspectRatio: def?.defaultAspectRatio, n: 1 }, model, newMode, hasVideo)
      : normalizeVideoParams(params, model, newMode, hasVideo)
    set({ model, mode: newMode, inputMode: safeInputMode, lastFrameId: safeLastFrameId, params: nextParams, sourceVideoId: null, ...groupVideoReferences(references) })
  },
  setParams: (partialParams) => {
    const { model, mode, params } = get()
    const merged = { ...params, ...partialParams }
    set({ params: normalizeVideoParams(merged, model, mode, mode === 'ref2v' && get().refItems.some(item => item.type === 'video')) })
  },

  setPrompt: (prompt) => set({ prompt }),

  setFirstFrame: (id) => set((state) => ({
    firstFrameId: id,
    mode: resolveVideoMode(state.inputMode, id, state.lastFrameId),
  })),
  setLastFrame: (id) => set((state) => {
    const lastFrameId = getVideoModelDefinition(state.model)?.modes.flf2v ? id : null
    return { lastFrameId, mode: resolveVideoMode(state.inputMode, state.firstFrameId, lastFrameId) }
  }),

  setReferenceItems: (items) => {
    const model = get().model
    for (const type of ['image', 'video', 'audio'] as const) {
      const limit = referenceLimit(model, type)
      if (items.filter((item) => item.type === type).length > limit) throw new Error(limit ? `该类型素材最多 ${limit} 个` : '当前模型不支持该类型参考素材')
    }
    const state = get()
    set({ ...groupVideoReferences(items), params: normalizeVideoParams(state.params, model, state.mode, state.mode === 'ref2v' && items.some(item => item.type === 'video')) })
  },
  addReference: (item) => {
    const state = get()
    if (state.refItems.some((ref) => ref.id === item.id)) return
    const limit = referenceLimit(state.model, item.type)
    if (!limit) throw new Error('当前模型不支持该类型参考素材')
    if (state.refItems.filter((ref) => ref.type === item.type).length >= limit) throw new Error(`该类型素材最多 ${limit} 个`)
    get().setReferenceItems([...state.refItems, item])
  },
  removeReference: (id) => get().setReferenceItems(get().refItems.filter((item) => item.id !== id)),
  setRefImages: (ids) => get().setReferenceItems([...get().refItems.filter((item) => item.type !== 'image'), ...ids.map((id) => ({ id, type: 'image' as const }))]),
  addRefImage: (id) => get().addReference({ id, type: 'image' }),
  removeRefImage: (id) => get().removeReference(id),

  setRefVideos: (ids) => get().setReferenceItems([...get().refItems.filter((item) => item.type !== 'video'), ...ids.map((id) => ({ id, type: 'video' as const }))]),
  addRefVideo: (id) => get().addReference({ id, type: 'video' }),
  removeRefVideo: (id) => get().removeReference(id),

  setRefAudios: (ids) => get().setReferenceItems([...get().refItems.filter((item) => item.type !== 'audio'), ...ids.map((id) => ({ id, type: 'audio' as const }))]),
  addRefAudio: (id) => get().addReference({ id, type: 'audio' }),
  removeRefAudio: (id) => get().removeReference(id),

  setSourceVideo: (id) => set({ sourceVideoId: id }),

  swapFirstLastFrame: () => {
    if (!getVideoModelDefinition(get().model)?.modes.flf2v) return
    const { firstFrameId, lastFrameId } = get()
    set({ firstFrameId: lastFrameId, lastFrameId: firstFrameId })
  },

  uploadFile: async (file) => {
    const definition = getVideoModelDefinition(get().model)
    const mime = file.type.toLowerCase()
    const isVideo = mime.startsWith('video/')
    const isAudio = mime.startsWith('audio/')
    if (definition?.videoMimeTypes && isVideo && !definition.videoMimeTypes.includes(mime)) throw new Error('参考视频仅支持 MP4 / MOV')
    if (definition?.audioMimeTypes && isAudio && !definition.audioMimeTypes.includes(mime)) throw new Error('参考音频仅支持 MP3 / WAV')
    if (definition?.imageMimeTypes && !definition.imageMimeTypes.includes(mime)) {
      throw new Error('请选择 JPEG、JPG、PNG 或 WEBP 图片')
    }
    const maxBytes = isVideo ? definition?.maxVideoBytes : isAudio ? definition?.maxAudioBytes : definition?.maxImageBytes
    if (maxBytes && file.size > maxBytes) {
      throw new Error(`单个参考${isVideo ? '视频' : isAudio ? '音频' : '图片'}不能超过 ${maxBytes / (1024 * 1024)} MB`)
    }
    const uploadId = createLocalId()
    set((s) => ({ uploadingFiles: new Set(s.uploadingFiles).add(uploadId) }))
    try {
      const id = await uploadMediaFile(file, 'upload')
      return id
    } finally {
      set((s) => {
        const next = new Set(s.uploadingFiles)
        next.delete(uploadId)
        return { uploadingFiles: next }
      })
    }
  },

  generateVideo: async () => {
    const state = get()
    if (state.isGenerating || state.uploadingFiles.size > 0) {
      useStore.getState().showToast('请等待素材上传完成后再创建', 'info')
      return
    }
    const { inputMode, model, params, prompt, firstFrameId, lastFrameId, refImageIds, refVideoIds, refAudioIds, refItems, sourceVideoId } = state
    const modelDef = getVideoModelDefinition(model)
    const requestCount = modelDef?.fixedQuantity ?? state.params.n
    const effectiveInputMode = modelDef?.modes.ref2v ? inputMode : 'create'
    const effectiveLastFrameId = modelDef?.modes.flf2v ? lastFrameId : null
    const resolvedMode: VideoMode = resolveVideoMode(effectiveInputMode, firstFrameId, effectiveLastFrameId)
    set({ mode: resolvedMode })
    if (!prompt.trim() && !(modelDef?.allowsImageOnly && firstFrameId)) { useStore.getState().showToast(modelDef?.allowsImageOnly ? '请输入提示词或上传图片' : '请输入提示词', 'error'); return }
    if (modelDef?.modes.flf2v && inputMode === 'create' && lastFrameId && !firstFrameId) {
      useStore.getState().showToast('已选择结束帧，请同时上传起始帧', 'error')
      return
    }
    if ((resolvedMode === 'i2v' && !firstFrameId) || (resolvedMode === 'flf2v' && (!firstFrameId || !lastFrameId))) { useStore.getState().showToast('当前模式缺少必要的首帧或尾帧', 'error'); return }
    try {
      const serializedPrompt = serializeVideoPrompt(prompt, effectiveInputMode === 'reference' ? refItems : getFrameReferences(firstFrameId, effectiveLastFrameId))
      const maxPromptChars = getVideoModelDefinition(model)?.maxPromptChars
      if (maxPromptChars && serializedPrompt.length > maxPromptChars) {
        useStore.getState().showToast(`提示词不能超过 ${maxPromptChars} 字`, 'error')
        return
      }
    } catch (error) {
      useStore.getState().showToast(error instanceof Error ? error.message : '引用素材不可用', 'error')
      return
    }
    const profile = getActiveApiProfile(useStore.getState().settings)
    if (!profile.apiKey.trim()) {
      useStore.getState().showToast('请先在设置 → API 配置中填写 API Key', 'error')
      return
    }
    set({ isGenerating: true })
    const profileSnapshot = {
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey.trim(),
      apiProxy: modelDef?.requiresProxy ? true : profile.apiProxy,
    }
    const activeReferences = groupVideoReferences(supportedReferences(model, refItems))
    const normalizedParams = normalizeVideoParams({ ...params, n: 1 }, model, resolvedMode, resolvedMode === 'ref2v' && activeReferences.refVideoIds.length > 0)
    // Drafts may keep both modes' assets, but each request includes ONLY its active mode's inputs.
    const sharedInputs: VideoTaskRecord['inputs'] = effectiveInputMode === 'reference'
      ? {
          ...activeReferences,
        }
      : {
          firstFrameId: firstFrameId || undefined, lastFrameId: effectiveLastFrameId || undefined,
          refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [],
        }
    const activeImageCount = effectiveInputMode === 'reference'
      ? sharedInputs.refImageIds.length
      : getFrameReferences(firstFrameId, effectiveLastFrameId).length
    let referenceVideoSeconds = 0
    let referenceDurationUnknown = false
    if (modelDef?.referencePricing && sharedInputs.refVideoIds.length) {
      try {
        const videos = await Promise.all(sharedInputs.refVideoIds.map(id => getMedia(id)))
        referenceDurationUnknown = videos.some(video => !(Number.isFinite(video?.duration) && video!.duration! > 0))
        if (!referenceDurationUnknown) referenceVideoSeconds = videos.reduce((sum, video) => sum + video!.duration!, 0)
      } catch {
        referenceDurationUnknown = true
      }
    }
    const estimatedCredits = referenceDurationUnknown ? undefined
      : estimateVideoCredits(model, normalizedParams.duration, normalizedParams.resolution, activeImageCount, referenceVideoSeconds, 1)
    const tasks = Array.from({ length: requestCount }, (_, index): VideoTaskRecord => ({
      id: createLocalId(), prompt, mode: resolvedMode, model, params: normalizedParams, inputs: sharedInputs, status: 'queued', adapter: modelDef?.adapter ?? 'h3', error: null, createdAt: Date.now() + index, finishedAt: null, elapsed: null, estimatedCredits, apiProfileId: profile.id, apiProfile: profileSnapshot,
    }))
    try {
      const submissionFailures: string[] = []
      await Promise.all(tasks.map((task) => queueTaskWrite(task.id, async () => {
        if (!deletedTaskIds.has(task.id)) await putVideoTask(task)
      })))
      set((s) => ({ tasks: [...tasks.filter((task) => !deletedTaskIds.has(task.id)), ...s.tasks] }))
      await Promise.all(tasks.map(async (task) => {
        const generation = taskGenerations.get(task.id) ?? 0
        if (!getActiveTask(task.id, generation)) return
        const controller = new AbortController()
        submissionControllers.set(task.id, controller)
        try {
          const result = await submitVideoTask(task, controller.signal)
          submissionControllers.delete(task.id)
          if (!getActiveTask(task.id, generation)) return
          if (await updateActiveTask(task.id, generation, { ...result, status: result.status || 'queued' })) {
            startPolling(task.id)
          }
        } catch (error) {
          if (!getActiveTask(task.id, generation)) return
          const message = formatVideoTaskError(error instanceof Error ? error.message : String(error), undefined, task.model)
          submissionFailures.push(message)
          await updateActiveTask(task.id, generation, { status: 'error', error: message, recoverable: false, finishedAt: Date.now(), elapsed: Date.now() - task.createdAt })
        } finally {
          if (submissionControllers.get(task.id) === controller) submissionControllers.delete(task.id)
        }
      }))
      if (submissionFailures.length) {
        useStore.getState().showToast(`视频任务提交失败：${submissionFailures[0]}`, 'error')
      } else {
        useStore.getState().showToast(`已提交 ${tasks.length} 个视频任务`, 'success')
      }
    } catch (error) {
      useStore.getState().showToast(`任务创建失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      set({ isGenerating: false })
    }
  },

  cancelTask: (id) => {
    stopPolling(id)
    const task = get().tasks.find((t) => t.id === id)
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return
    invalidateTask(id)
    set((s) => ({
      tasks: s.tasks.map((t) => t.id === id ? { ...t, status: 'canceled' as const, finishedAt: Date.now() } : t),
    }))
    void persistLatestTask(id).catch(console.error)
  },

  deleteTask: async (id) => {
    stopPolling(id)
    deletedTaskIds.add(id)
    invalidateTask(id)
    set((s) => {
      const selectedTaskIds = new Set(s.selectedTaskIds)
      selectedTaskIds.delete(id)
      return {
        tasks: s.tasks.filter((t) => t.id !== id),
        selectedTaskIds,
        detailTaskId: s.detailTaskId === id ? null : s.detailTaskId,
      }
    })
    // Delete after any already-started put; shared input/output media stays intact.
    await queueTaskWrite(id, () => deleteVideoTask(id))
  },

  toggleFavorite: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (task) void get().setTasksFavorite([id], !task.isFavorite).catch(console.error)
  },

  setTasksFavorite: async (ids, favorite) => {
    const taskIds = new Set(ids)
    set((s) => ({
      tasks: s.tasks.map((t) => taskIds.has(t.id) ? { ...t, isFavorite: favorite } : t),
    }))
    await Promise.all([...taskIds].filter((id) => get().tasks.some((t) => t.id === id)).map(persistLatestTask))
  },

  setSelection: (ids) => set({ selectedTaskIds: new Set(ids) }),

  selectTask: (id) => set((s) => ({ selectedTaskIds: new Set(s.selectedTaskIds).add(id) })),
  deselectTask: (id) => {
    set((s) => {
      const next = new Set(s.selectedTaskIds)
      next.delete(id)
      return { selectedTaskIds: next }
    })
  },
  toggleSelectTask: (id) => {
    const { selectedTaskIds } = get()
    if (selectedTaskIds.has(id)) {
      get().deselectTask(id)
    } else {
      get().selectTask(id)
    }
  },
  clearSelection: () => set({ selectedTaskIds: new Set() }),

  setDetailTask: (id) => set({ detailTaskId: id }),

  reuseTaskConfig: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return

    set({
      inputMode: task.mode === 'ref2v' ? 'reference' : 'create',
      mode: task.mode,
      model: task.model,
      params: task.params,
      prompt: task.prompt,
      firstFrameId: task.inputs.firstFrameId || null,
      lastFrameId: task.inputs.lastFrameId || null,
      refImageIds: task.inputs.refImageIds,
      refVideoIds: task.inputs.refVideoIds,
      refAudioIds: task.inputs.refAudioIds,
      refItems: task.inputs.refItems ?? [
        ...task.inputs.refImageIds.map((id) => ({ id, type: 'image' as const })),
        ...task.inputs.refVideoIds.map((id) => ({ id, type: 'video' as const })),
        ...task.inputs.refAudioIds.map((id) => ({ id, type: 'audio' as const })),
      ],
      sourceVideoId: task.inputs.sourceVideoId || null,
    })
    get().setModel(task.model)
  },

  loadTasks: async () => {
    const tasks = await getAllVideoTasks()
    set({ tasks: tasks.filter((task) => !deletedTaskIds.has(task.id)).map((task) =>
      get().tasks.find((current) => current.id === task.id) ?? task,
    ).sort((a, b) => b.createdAt - a.createdAt) })
  },

  recoverTasks: () => {
    const { tasks } = get()
    const recoverableTasks = tasks.filter(
      (t) => (t.status === 'queued' || t.status === 'running') && t.remoteTaskId && t.recoverable !== false && t.apiProfile,
    )
    for (const task of recoverableTasks) {
      startPolling(task.id)
    }
    if (recoverableTasks.length > 0) {
      useStore.getState().showToast(`正在恢复 ${recoverableTasks.length} 个任务`, 'info')
    }
  },
}), {
  name: 'video-workbench-draft',
  partialize: (state) => ({
    inputMode: state.inputMode, mode: state.mode, model: state.model, params: state.params, prompt: state.prompt,
    firstFrameId: state.firstFrameId, lastFrameId: state.lastFrameId,
    refItems: state.refItems, refImageIds: state.refImageIds, refVideoIds: state.refVideoIds, refAudioIds: state.refAudioIds,
  }),
}))

function startPolling(taskId: string) {
  stopPolling(taskId)
  const generation = invalidateTask(taskId)

  const poll = async () => {
    const task = getActiveTask(taskId, generation)
    if (!task) return
    if (!task.remoteTaskId || task.status === 'done' || task.status === 'error') {
      stopPolling(taskId)
      return
    }

    try {
      const result = await pollVideoTask(task.remoteTaskId, task)
      if (!getActiveTask(taskId, generation)) return

      if (result.status === 'succeeded') {
        // completed 响应不带 video_url，通过带鉴权的 /content 下载。
        const blob = await downloadVideoContent(task.remoteTaskId, task)
        if (!getActiveTask(taskId, generation)) return
        const videoMime = blob.type.startsWith('video/') ? blob.type : 'video/mp4'
        const videoId = await uploadMediaFile(new File([blob], 'video.mp4', { type: videoMime }), 'generated')
        if (!getActiveTask(taskId, generation)) {
          // Only this fresh output is unreferenced; never remove existing/shared media.
          await deleteMedia(videoId)
          return
        }

        if (!await updateActiveTask(taskId, generation, {
          status: 'done',
          progress: 100,
          outputVideoId: videoId,
          posterImageId: videoId,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })) return
        stopPolling(taskId)
        useStore.getState().showToast('视频生成完成', 'success')
      } else if (result.status === 'failed') {
        const error = formatVideoTaskError(result.error || '生成失败')
        if (!await updateActiveTask(taskId, generation, {
          status: 'error',
          error,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })) return
        stopPolling(taskId)
        useStore.getState().showToast(`视频生成失败: ${error}`, 'error')
      } else {
        // 更新进度
        if (!await updateActiveTask(taskId, generation, {
          status: result.status === 'queued' ? 'queued' : 'running',
          progress: result.progress,
        })) return

        // 继续轮询
        const modelInterval = getVideoModelDefinition(task.model)?.pollIntervalSeconds
        const delay = modelInterval ? modelInterval * 1000 : result.status === 'queued' ? 5000 : 10000
        videoPollingTimers.set(taskId, setTimeout(poll, delay))
      }
    } catch (error) {
      const task = getActiveTask(taskId, generation)
      if (!task) return
      const message = formatVideoTaskError(error instanceof Error ? error.message : String(error))
      const permanent = /401|403|404|缺少|未知状态|配置/.test(message)
      if (permanent) {
        if (!await updateActiveTask(taskId, generation, { status: 'error', error: message, finishedAt: Date.now(), elapsed: Date.now() - task.createdAt, recoverable: false })) return
        stopPolling(taskId)
        useStore.getState().showToast(`视频任务失败: ${message}`, 'error')
      } else {
        videoPollingTimers.set(taskId, setTimeout(poll, 15000))
      }
    }
  }

  void poll().catch(console.error)
}

function stopPolling(taskId: string) {
  const timer = videoPollingTimers.get(taskId)
  if (timer) {
    clearTimeout(timer)
    videoPollingTimers.delete(taskId)
  }
}

// 初始化
requestPersistentStorage().then((granted) => {
  if (granted) {
    console.log('Persistent storage granted')
  }
})
