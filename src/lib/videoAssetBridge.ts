import type { StoredImage } from '../types'
import type { VideoReferenceType } from './videoTypes'
import type { VideoAssetRecord } from './videoAssetTypes'
import { getImage, getAllImages } from './db'
import { getMedia, getMediaBlobUrl as getStoredMediaBlobUrl, uploadMediaFile } from './videoDb'
import { getVideoAsset, putVideoAsset } from './videoAssetDb'

export function imageAssetId(imageId: string) {
  return `image:${imageId}`
}

export async function ensureGalleryImageAsset(imageId: string, metadata?: Partial<StoredImage>): Promise<VideoAssetRecord | undefined> {
  const image = await getImage(imageId)
  if (!image) return undefined
  const id = imageAssetId(imageId)
  const existing = await getVideoAsset(id)
  if (existing) return existing.removedAt ? undefined : existing
  const now = Date.now()
  const asset: VideoAssetRecord = {
    id,
    type: 'image',
    displayName: metadata?.source === 'generated' ? '画廊生成图片' : '画廊图片',
    categoryId: null,
    createdAt: image.createdAt ?? now,
    updatedAt: now,
    mime: image.dataUrl.match(/^data:([^;,]+)/)?.[1] ?? 'image/png',
    size: image.dataUrl.length,
    width: image.width,
    height: image.height,
    source: 'gallery',
    storage: 'images',
    storageId: imageId,
    derivedMediaId: null,
  }
  await putVideoAsset(asset)
  return asset
}

export async function ensureGalleryImageAssets(imageIds: readonly string[]) {
  const assets = await Promise.all(imageIds.map((id) => ensureGalleryImageAsset(id)))
  return assets.filter((asset): asset is VideoAssetRecord => Boolean(asset))
}

export async function getGalleryImageAssets() {
  const images = await getAllImages()
  return (await Promise.all(images.map((image) => image.source === 'generated' ? ensureGalleryImageAsset(image.id, image) : undefined)))
    .filter((asset): asset is VideoAssetRecord => Boolean(asset))
}

const galleryMediaConversions = new Map<string, Promise<string>>()

function dataUrlToFile(image: StoredImage) {
  const match = image.dataUrl.match(/^data:([^;,]+)(?:;base64)?,(.*)$/s)
  if (!match) throw new Error('画廊图片数据格式无效')
  const mime = match[1] || 'image/png'
  const payload = match[2]
  const bytes = payload.startsWith('%') ? new TextEncoder().encode(decodeURIComponent(payload)) : Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
  const extension = mime.split('/')[1] || 'png'
  return new File([bytes], `gallery-${image.id.slice(0, 12)}.${extension}`, { type: mime })
}

export async function resolveVideoAssetToMediaReference(asset: VideoAssetRecord): Promise<{ id: string; type: VideoReferenceType }> {
  if (asset.storage === 'media') {
    if (!await getMedia(asset.storageId)) throw new Error(`找不到参考素材: ${asset.storageId}`)
    return { id: asset.storageId, type: asset.type }
  }
  const existing = asset.derivedMediaId
  if (existing && await getMedia(existing)) return { id: existing, type: asset.type }
  const pending = galleryMediaConversions.get(asset.id)
  if (pending) return { id: await pending, type: asset.type }
  const conversion = (async () => {
    const image = await getImage(asset.storageId)
    if (!image) throw new Error(`找不到画廊图片: ${asset.storageId}`)
    const mediaId = await uploadMediaFile(dataUrlToFile(image), 'upload')
    const latest = await getVideoAsset(asset.id)
    if (latest) await putVideoAsset({ ...latest, derivedMediaId: mediaId, updatedAt: Date.now() })
    return mediaId
  })()
  galleryMediaConversions.set(asset.id, conversion)
  try { return { id: await conversion, type: asset.type } } finally { galleryMediaConversions.delete(asset.id) }
}

export async function getVideoAssetPreviewSource(asset: VideoAssetRecord) {
  if (asset.storage === 'media') return getStoredMediaBlobUrl(asset.storageId)
  const image = await getImage(asset.storageId)
  return image?.dataUrl
}
