import type { VideoReferenceType } from './videoTypes'

export interface VideoAssetRecord {
  id: string
  type: VideoReferenceType
  displayName: string
  categoryId: string | null
  createdAt: number
  updatedAt: number
  mime: string
  size: number
  duration?: number
  width?: number
  height?: number
  source: 'upload' | 'generated' | 'extracted' | 'gallery'
  storage: 'media' | 'images'
  storageId: string
  derivedMediaId?: string | null
}

export interface VideoAssetCategoryRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}
