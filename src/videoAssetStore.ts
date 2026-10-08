import { create } from 'zustand'
import { createLocalId } from './lib/localId'
import type { VideoAssetCategoryRecord, VideoAssetRecord } from './lib/videoAssetTypes'
import { getAllMedia, uploadMediaFile } from './lib/videoDb'
import {
  deleteVideoAsset,
  deleteVideoAssetCategory,
  ensureMediaAssets,
  getAllVideoAssetCategories,
  getAllVideoAssets,
  putVideoAsset,
  putVideoAssetCategory,
} from './lib/videoAssetDb'
import { getGalleryImageAssets, resolveVideoAssetToMediaReference } from './lib/videoAssetBridge'

interface VideoAssetStore {
  assets: VideoAssetRecord[]
  categories: VideoAssetCategoryRecord[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  upload: (file: File, categoryId?: string | null) => Promise<string>
  rename: (id: string, displayName: string) => Promise<void>
  move: (ids: string[], categoryId: string | null) => Promise<void>
  remove: (ids: string[]) => Promise<void>
  addCategory: (name: string) => Promise<void>
  renameCategory: (id: string, name: string) => Promise<void>
  removeCategory: (id: string) => Promise<void>
}

export const useVideoAssetStore = create<VideoAssetStore>((set, get) => ({
  assets: [],
  categories: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const media = await getAllMedia()
      const [assets, categories, galleryAssets] = await Promise.all([
        ensureMediaAssets(media),
        getAllVideoAssetCategories(),
        getGalleryImageAssets(),
      ])
      const merged = [...assets, ...galleryAssets.filter((gallery) => !assets.some((asset) => asset.id === gallery.id))]
      set({ assets: merged, categories, loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '资产库加载失败' })
    }
  },
  upload: async (file, categoryId = null) => {
    const id = await uploadMediaFile(file, 'upload')
    const media = (await getAllMedia()).find((item) => item.id === id)
    if (!media) throw new Error('素材保存后无法读取')
    const now = Date.now()
    const type = media.mime.startsWith('image/') ? 'image' : media.mime.startsWith('video/') ? 'video' : media.mime.startsWith('audio/') ? 'audio' : null
    if (!type) throw new Error('不支持的素材类型')
    const asset: VideoAssetRecord = {
      id, type, displayName: media.filename || file.name || `${type}素材`, categoryId,
      createdAt: now, updatedAt: now, mime: media.mime, size: media.size,
      duration: media.duration, width: media.width, height: media.height,
      source: media.source,
      storage: 'media',
      storageId: id,
      derivedMediaId: null,
    }
    await putVideoAsset(asset)
    set((state) => ({ assets: [asset, ...state.assets.filter((item) => item.id !== id)] }))
    return id
  },
  rename: async (id, displayName) => {
    const asset = get().assets.find((item) => item.id === id)
    const name = displayName.trim()
    if (!asset || !name) return
    const next = { ...asset, displayName: name.slice(0, 120), updatedAt: Date.now() }
    await putVideoAsset(next)
    set((state) => ({ assets: state.assets.map((item) => item.id === id ? next : item) }))
  },
  move: async (ids, categoryId) => {
    const selected = new Set(ids)
    const next = get().assets.map((asset) => selected.has(asset.id) ? { ...asset, categoryId, updatedAt: Date.now() } : asset)
    await Promise.all(next.filter((asset, index) => asset !== get().assets[index]).map(putVideoAsset))
    set({ assets: next })
  },
  remove: async (ids) => {
    await Promise.all(ids.map(deleteVideoAsset))
    const selected = new Set(ids)
    set((state) => ({ assets: state.assets.filter((asset) => !selected.has(asset.id)) }))
  },
  addCategory: async (name) => {
    const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!normalized || normalized === '全部' || normalized === '未分类' || get().categories.some((item) => item.name === normalized)) throw new Error('分类名称无效或已存在')
    const now = Date.now()
    const category = { id: createLocalId(), name: normalized, createdAt: now, updatedAt: now }
    await putVideoAssetCategory(category)
    set((state) => ({ categories: [...state.categories, category] }))
  },
  renameCategory: async (id, name) => {
    const category = get().categories.find((item) => item.id === id)
    const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!category || !normalized || normalized === '全部' || normalized === '未分类' || get().categories.some((item) => item.id !== id && item.name === normalized)) throw new Error('分类名称无效或已存在')
    const next = { ...category, name: normalized, updatedAt: Date.now() }
    await putVideoAssetCategory(next)
    set((state) => ({ categories: state.categories.map((item) => item.id === id ? next : item) }))
  },
  removeCategory: async (id) => {
    await deleteVideoAssetCategory(id)
    const assets = get().assets.map((asset) => asset.categoryId === id ? { ...asset, categoryId: null, updatedAt: Date.now() } : asset)
    await Promise.all(assets.filter((asset) => asset.categoryId === null).map(putVideoAsset))
    set((state) => ({ categories: state.categories.filter((item) => item.id !== id), assets }))
  },
}))

export async function loadVideoAssetStore() {
  await useVideoAssetStore.getState().load()
}
