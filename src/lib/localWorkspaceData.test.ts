import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord, AgentConversation } from '../types'
import type { VideoTaskRecord } from './videoTypes'
import { buildWorkspaceArchive, parseWorkspaceArchive, planWorkspaceCleanup, emptyWorkspaceSnapshot, clearWorkspaceData, importWorkspaceData, getWorkspaceDataCounts, getWorkspaceResourceCounts } from './localWorkspaceData'

const fake = vi.hoisted(() => ({ data: {} as Record<string, { id: string }[]>, imageState: {} as any, videoState: {} as any, assetState: {} as any, failPut: false, failDelete: false, transactions: [] as string[] }))
vi.mock('./db', () => ({ openAppDatabase: async () => ({
  transaction: (names: string[], mode: string) => {
    fake.transactions.push(mode)
    const staged = structuredClone(fake.data)
    let aborted = false
    const tx: any = {
      objectStore: (name: string) => ({
        getAll: () => {
          const request: any = { result: staged[name] ?? [] }
          queueMicrotask(() => request.onsuccess?.())
          return request
        },
        put: (row: { id: string }) => {
          if (fake.failPut) throw new Error('quota failure')
          staged[name] = [...staged[name].filter((item) => item.id !== row.id), row]
        },
        delete: (id: string) => {
          if (fake.failDelete && name === 'images') throw new Error('quota failure')
          staged[name] = staged[name].filter((item) => item.id !== id)
        },
      }),
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()) },
    }
    queueMicrotask(() => queueMicrotask(() => {
      if (!aborted) { if (mode === 'readwrite') fake.data = staged; tx.oncomplete?.() }
    }))
    return tx
  },
}) }))
vi.mock('../store', () => ({ useStore: { getState: () => fake.imageState, setState: (patch: object) => Object.assign(fake.imageState, patch) } }))
vi.mock('../videoStore', () => ({ useVideoStore: { getState: () => fake.videoState, setState: (patch: object) => Object.assign(fake.videoState, patch) } }))
vi.mock('../videoAssetStore', () => ({ useVideoAssetStore: { getState: () => fake.assetState } }))

beforeEach(() => {
  fake.data = emptyWorkspaceSnapshot() as unknown as typeof fake.data
  fake.imageState = { tasks: [], agentConversations: [], inputImages: [], galleryInputDraft: null, agentInputDrafts: {}, agentGeneratingTitleIds: {}, appMode: 'gallery' }
  fake.videoState = { tasks: [], isGenerating: false, uploadingFiles: new Set(), firstFrameId: null, lastFrameId: null, refItems: [], refImageIds: [], refVideoIds: [], refAudioIds: [] }
  fake.assetState = { loading: false, load: async () => {} }
  fake.failPut = false
  fake.failDelete = false
  fake.transactions = []
})

const task = (id: string, image: string, sourceMode: 'gallery' | 'agent' = 'gallery'): TaskRecord => ({
  id, prompt: id, params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: [image],
  status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, sourceMode,
})
const conversation = (outputTaskIds: string[]): AgentConversation => ({
  id: 'conversation', title: 'test', createdAt: 1, updatedAt: 2, rounds: [],
  messages: [{ id: 'message', role: 'assistant', content: 'hello', roundId: 'round', outputTaskIds, createdAt: 1 }],
})
const image = (id: string) => ({ id, dataUrl: 'data:image/png;base64,YQ==', source: 'generated' as const })

describe('scoped local workspace data', () => {
  it('preserves Agent output tasks and video image assets when Gallery is cleared', () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('gallery', 'shared'), task('output', 'agent-output')]
    data.agentConversations = [conversation(['output'])]
    data.images = [image('shared'), image('agent-output'), image('unrelated')]
    data.videoAssets = [{ id: 'asset', storage: 'images', storageId: 'shared' } as never]
    const result = planWorkspaceCleanup(data, ['gallery'])
    expect(result.tasks).toEqual([data.tasks[1]])
    expect(result.images.map((item) => item.id)).toEqual(['shared', 'agent-output', 'unrelated'])
    expect(result.agentConversations).toEqual(data.agentConversations)
    expect(result.videoAssets).toEqual(data.videoAssets)
  })

  it('clears Agent conversations while retaining Gallery tasks and draft images', () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('gallery', 'shared'), task('agent', 'shared', 'agent'), task('private', 'private', 'agent')]
    data.images = [image('shared'), image('private'), image('draft'), image('agent-input')]
    data.agentConversations = [conversation(['agent', 'private'])]
    data.agentConversations[0].messages[0].inputImageIds = ['agent-input']
    const result = planWorkspaceCleanup(data, ['agent'], ['draft'])
    expect(result.tasks).toEqual(data.tasks)
    expect(result.agentConversations).toEqual([])
    expect(result.images.map((item) => item.id)).toEqual(['shared', 'private', 'draft'])
  })

  it('round trips Agent dependencies without unrelated Gallery tasks or credentials', async () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [{ ...task('dependency', 'output'), apiKey: 'SECRET', rawResponsePayload: 'SECRET', apiProfileId: 'managed-profile' } as TaskRecord]
    data.agentConversations = [conversation(['dependency'])]
    data.images = [image('output'), image('gallery-only')]
    const bytes = await buildWorkspaceArchive(data, ['agent'])
    const manifest = strFromU8(unzipSync(bytes)['manifest.json'])
    expect(manifest).not.toContain('SECRET')
    expect(manifest).not.toContain('managed-profile')
    const imported = parseWorkspaceArchive(bytes, ['agent'])
    expect(imported.tasks).toMatchObject([{ id: 'dependency' }])
    expect(imported.images.map((item) => item.id)).toEqual(['output'])
    expect(imported.agentConversations).toEqual(data.agentConversations)
  })

  it('round trips Video media, posters, category relationships, and image assets without API snapshots', async () => {
    const data = emptyWorkspaceSnapshot()
    data.videoTasks = [{ id: 'video', prompt: 'test', mode: 't2v', model: 'model', params: { duration: 4, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 }, inputs: { refImageIds: [], refAudioIds: [], refVideoIds: [] }, status: 'done', adapter: 'h3', outputVideoId: 'media', apiProfile: { apiKey: 'SECRET', baseUrl: 'https://secret', profileId: 'key', apiProxy: false }, error: null, createdAt: 1, finishedAt: 2, elapsed: 1 } as VideoTaskRecord]
    data.media = [{ id: 'media', blob: new Blob(['video']), mime: 'video/mp4', size: 5, source: 'generated', uploadedAt: 1 }]
    data.mediaPosters = [{ id: 'media', blob: new Blob(['poster']), width: 2, height: 3 }]
    data.videoAssets = [{ id: 'asset', type: 'image', displayName: 'test', storage: 'images', storageId: 'picture', derivedMediaId: 'media', categoryId: 'category', source: 'gallery', mime: 'image/png', size: 1, createdAt: 1, updatedAt: 1 }]
    data.videoAssetCategories = [{ id: 'category', name: 'test', createdAt: 1, updatedAt: 1 }]
    data.images = [image('picture')]
    const bytes = await buildWorkspaceArchive(data, ['video'])
    expect(strFromU8(unzipSync(bytes)['manifest.json'])).not.toContain('SECRET')
    const restored = parseWorkspaceArchive(bytes, ['video'])
    expect(await restored.media[0].blob.text()).toBe('video')
    expect(await restored.mediaPosters[0].blob.text()).toBe('poster')
    expect(restored.videoAssets).toEqual(data.videoAssets)
    expect(restored.videoAssetCategories).toEqual(data.videoAssetCategories)
    expect(restored.videoTasks[0].apiProfile).toBeUndefined()
    expect(restored.tasks).toEqual([])
  })

  it('validates the complete archive before allowing a partial scope import', async () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('gallery', 'picture')]
    data.images = [image('picture')]
    const files = unzipSync(await buildWorkspaceArchive(data, ['gallery', 'video']))
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    manifest.namespaces.video.tasks = [{ id: 'broken' }]
    files['manifest.json'] = strToU8(JSON.stringify(manifest))
    expect(() => parseWorkspaceArchive(zipSync(files), ['gallery'])).toThrow()
  })

  it('rejects archives with missing image payloads and running task restoration', async () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('gallery', 'picture')]
    data.images = [image('picture')]
    const files = unzipSync(await buildWorkspaceArchive(data, ['gallery']))
    delete files['images/0.json']
    expect(() => parseWorkspaceArchive(zipSync(files), ['gallery'])).toThrow()
    data.tasks[0].status = 'running'
    await expect(buildWorkspaceArchive(data, ['gallery'])).rejects.toThrow(/运行/)
  })

  it('counts actual Gallery records and imports atomically without changing configuration', async () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('import', 'picture', 'agent')]
    data.images = [image('picture')]
    fake.imageState.settings = { apiKey: 'keep-setting' }
    const bytes = await buildWorkspaceArchive(data, ['gallery'])
    await importWorkspaceData(new File([bytes.slice().buffer], 'backup.zip'), ['gallery'])
    expect(await getWorkspaceDataCounts()).toEqual({ gallery: 1, agent: 0, video: 0 })
    expect(fake.imageState.settings).toEqual({ apiKey: 'keep-setting' })
    expect(fake.imageState.tasks).toMatchObject([{ id: 'import' }])
  })

  it('rejects ID conflicts without writing any namespace', async () => {
    const data = emptyWorkspaceSnapshot()
    data.tasks = [task('conflict', 'new-image')]
    data.images = [image('new-image')]
    fake.data.tasks = [task('conflict', 'old-image')]
    fake.data.images = [image('old-image')]
    const before = structuredClone(fake.data)
    const bytes = await buildWorkspaceArchive(data, ['gallery'])
    await expect(importWorkspaceData(new File([bytes.slice().buffer], 'backup.zip'), ['gallery'])).rejects.toThrow(/冲突/)
    expect(fake.data).toEqual(before)
  })

  it('aborts every cleanup change when a database write fails', async () => {
    fake.data.tasks = [task('gallery', 'picture')]
    fake.data.images = [image('picture')]
    fake.data.agentConversations = [conversation([])]
    fake.failDelete = true
    const before = structuredClone(fake.data)
    await expect(clearWorkspaceData(['gallery'])).rejects.toThrow('quota failure')
    expect(fake.data).toEqual(before)
  })

  it('blocks cleanup during runtime generation and durable running tasks', async () => {
    fake.videoState.isGenerating = true
    await expect(clearWorkspaceData(['gallery'])).rejects.toThrow(/生成/)
    expect(fake.transactions).toEqual([])
    fake.videoState.isGenerating = false
    fake.data.tasks = [{ ...task('running', 'picture'), status: 'running' } as TaskRecord]
    const before = structuredClone(fake.data)
    await expect(clearWorkspaceData(['gallery'])).rejects.toThrow(/运行/)
    expect(fake.data).toEqual(before)
  })

  it('retains media used by a live unselected Video draft', async () => {
    fake.data.tasks = [task('gallery', 'picture')]
    fake.data.images = [image('picture')]
    fake.data.media = [{ id: 'draft-video', blob: new Blob(['keep']) } as never]
    fake.videoState.firstFrameId = 'draft-video'
    await clearWorkspaceData(['gallery'])
    expect(fake.data.media).toHaveLength(1)
    expect(fake.videoState.firstFrameId).toBe('draft-video')
  })

  it('removes selected Gallery drafts while retaining Agent draft image and mask references', async () => {
    fake.imageState.galleryInputDraft = { inputImages: [{ id: 'gallery-draft' }], maskDraft: { targetImageId: 'gallery-draft' } }
    fake.imageState.inputImages = [{ id: 'gallery-draft' }]
    fake.imageState.agentInputDrafts = { conversation: { inputImages: [{ id: 'agent-draft' }], maskDraft: { targetImageId: 'agent-mask' } } }
    fake.data.images = [image('gallery-draft'), image('agent-draft'), image('agent-mask')]
    await clearWorkspaceData(['gallery'])
    expect(fake.data.images.map((item) => item.id)).toEqual(['agent-draft', 'agent-mask'])
    expect(fake.imageState.galleryInputDraft).toBeNull()
    expect(fake.imageState.agentInputDrafts).toHaveProperty('conversation')
  })

  it('reports resources even with no tasks and excludes removed library entries', async () => {
    fake.data.images = [image('picture')]
    fake.data.media = [{ id: 'media' }]
    fake.data.videoAssets = [{ id: 'visible' }, { id: 'hidden', removedAt: 1 } as never]
    expect(await getWorkspaceResourceCounts()).toEqual({ images: 1, media: 1, videoAssets: 1 })
    expect(await getWorkspaceDataCounts()).toEqual({ gallery: 0, agent: 0, video: 0 })
  })

  it('Video-only cleanup preserves Gallery image storage and its inactive input fields', async () => {
    fake.data.images = [image('gallery-asset')]
    fake.data.videoAssets = [{ id: 'asset', storage: 'images', storageId: 'gallery-asset' } as never]
    expect(planWorkspaceCleanup(fake.data as unknown as ReturnType<typeof emptyWorkspaceSnapshot>, ['video']).images).toHaveLength(1)
    fake.imageState.appMode = 'video'
    fake.imageState.prompt = 'Gallery draft prompt'
    fake.imageState.inputImages = [{ id: 'gallery-asset' }]
    fake.videoState.prompt = 'Video draft prompt'
    await clearWorkspaceData(['video'])
    expect(fake.data.images).toHaveLength(1)
    expect(fake.imageState.prompt).toBe('Gallery draft prompt')
    expect(fake.imageState.inputImages).toEqual([{ id: 'gallery-asset' }])
    expect(fake.videoState.prompt).toBe('')
  })

  it('imports old v3 Agent backups with dependencies while ignoring settings and unrelated works', async () => {
    const legacy = {
      version: 3,
      settings: { apiKey: 'OLD-SECRET', profiles: [{ apiKey: 'OLD-SECRET' }] },
      tasks: [task('agent-output', 'picture', 'agent'), task('gallery-only', 'other-picture')],
      agentConversations: [conversation(['agent-output'])],
      imageFiles: {
        picture: { path: 'images/picture.png', source: 'generated', createdAt: 1 },
        'other-picture': { path: 'images/other.png', source: 'generated', createdAt: 2 },
      },
      thumbnailFiles: { picture: { path: 'thumbnails/picture.webp', thumbnailVersion: 2 } },
    }
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(legacy)), 'images/picture.png': strToU8('image bytes'), 'images/other.png': strToU8('other image'), 'thumbnails/picture.webp': strToU8('thumbnail') })
    fake.imageState.settings = { apiKey: 'KEEP-CURRENT-KEY' }
    await importWorkspaceData(new File([bytes.slice().buffer], 'old-backup.zip'), ['agent'])
    expect(fake.imageState.settings).toEqual({ apiKey: 'KEEP-CURRENT-KEY' })
    expect(fake.data.tasks.map((item) => item.id)).toEqual(['agent-output'])
    expect(fake.data.images.map((item) => item.id)).toEqual(['picture'])
    expect(fake.data.thumbnails.map((item) => item.id)).toEqual(['picture'])
    expect(fake.data.agentConversations).toHaveLength(1)
    expect(JSON.stringify(fake.data)).not.toContain('OLD-SECRET')
  })

  it('rejects incomplete old backups before writes and rejects unsupported legacy Video import', async () => {
    const manifest = { version: 3, tasks: [task('missing', 'picture')], agentConversations: [], imageFiles: { picture: { path: 'images/missing.png' } } }
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })
    await expect(importWorkspaceData(new File([bytes.slice().buffer], 'old-backup.zip'), ['gallery'])).rejects.toThrow(/缺少/)
    expect(fake.transactions).toEqual([])
    expect(() => parseWorkspaceArchive(bytes, ['video'])).toThrow(/旧版.*视频/)
    const configOnly = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 3, settings: { apiKey: 'OLD-SECRET' } })) })
    expect(() => parseWorkspaceArchive(configOnly, ['gallery'])).toThrow(/作品数据/)
  })
})
