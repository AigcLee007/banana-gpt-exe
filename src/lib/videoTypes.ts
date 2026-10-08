// 视频任务和媒体类型定义

import type { VideoMode, VideoParams, VideoAdapterId } from './videoModels'

export type VideoReferenceType = 'image' | 'video' | 'audio'

export interface VideoReferenceItem {
  id: string
  type: VideoReferenceType
}

export interface VideoTaskRecord {
  id: string
  prompt: string
  mode: VideoMode
  model: string
  params: VideoParams
  inputs: {
    firstFrameId?: string
    lastFrameId?: string
    refImageIds: string[]
    refVideoIds: string[]
    refAudioIds: string[]
    refItems?: VideoReferenceItem[]
    sourceVideoId?: string
    /** Optional remote image URL used by adapters that support JSON image input. */
    imageUrl?: string
    /** Remote reference images for JSON image-array adapters. */
    imageUrls?: string[]
  }
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  progress?: number
  adapter: VideoAdapterId
  remoteTaskId?: string
  recoverable?: boolean
  outputVideoId?: string
  posterImageId?: string
  lastFrameImageId?: string
  remoteVideoUrl?: string
  remoteUrlExpiresAt?: number
  actual?: {
    duration?: number
    width?: number
    height?: number
    hasAudio?: boolean
  }
  parentTaskId?: string
  estimatedCredits?: number
  apiProfileId?: string
  apiProfile?: VideoApiProfileSnapshot
  error: string | null
  createdAt: number
  finishedAt: number | null
  elapsed: number | null
  isFavorite?: boolean
}

export interface MediaRecord {
  id: string
  blob: Blob
  mime: string
  size: number
  /** Original local file name when media was imported from a File. */
  filename?: string
  duration?: number
  width?: number
  height?: number
  source: 'upload' | 'generated' | 'extracted'
  uploadedAt: number
  hash?: string
}

export interface MediaPosterRecord {
  id: string
  blob: Blob
  width: number
  height: number
}

export interface VideoApiProfileSnapshot {
  profileId: string
  baseUrl: string
  apiKey: string
  apiProxy: boolean
}
