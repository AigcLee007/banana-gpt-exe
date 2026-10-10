// 视频模型能力定义

export type VideoMode = 't2v' | 'i2v' | 'flf2v' | 'ref2v'
export type VideoResolution = '480p' | '720p' | '768p' | '1080p' | '2k'
export type VideoQuantity = 1 | 2 | 4
export type VideoAdapterId = 'h3' | 'grok' | 'omni' | 'sd' | 'wan'
export type RefMentionStyle = 'ordinal' | 'none'
export type VideoModelLogoId = 'minimax' | 'grok' | 'gemini' | 'seedance' | 'wan'

export interface VideoModeSpec {
  maxImages?: number
  maxVideos?: number
  maxAudios?: number
  maxRefMediaSeconds?: number
  ignoredParams?: (keyof VideoParams)[]
}

export interface VideoParams {
  duration: number
  resolution: VideoResolution
  aspectRatio: string
  audio: boolean
  seed?: number
  negativePrompt?: string
  cameraFixed?: boolean
  watermark?: boolean
  promptEnhance?: boolean
  n: number
}

export interface VideoModelDefinition {
  displayName: string
  model: string
  adapter: VideoAdapterId
  modes: Partial<Record<VideoMode, VideoModeSpec>>
  exclusiveModeGroups?: VideoMode[][]
  duration: { min: number; max: number; step: number; default: number }
  resolutions: readonly VideoResolution[]
  aspectRatios: readonly string[]
  audio: 'always' | 'optional' | 'none'
  supportsSeed: boolean
  supportsNegativePrompt: boolean
  supportsCameraFixed?: boolean
  supportsWatermarkToggle?: boolean
  supportsPromptEnhance?: boolean
  maxPromptChars?: number
  refMention: RefMentionStyle
  maxConcurrency?: number
  pricePerSecondCredits?: Partial<Record<VideoResolution, number>>
  referencePricing?: {
    freeImages: number
    imageCredits: number
    videoPerSecondCredits: Partial<Record<VideoResolution, number>>
  }
  pricePerRequestCredits?: number
  fixedQuantity?: 1
  defaultAspectRatio?: string
  logo: VideoModelLogoId
  badges?: readonly {
    label: string
    tone: 'recommended' | 'quality' | 'warning'
  }[]
  requiresProxy?: boolean
  allowsImageOnly?: boolean
  imageMimeTypes?: readonly string[]
  maxImageBytes?: number
  videoMimeTypes?: readonly string[]
  audioMimeTypes?: readonly string[]
  maxVideoBytes?: number
  maxAudioBytes?: number
  maxOutputSecondsWithVideo?: number
  referenceUpload?: 'uguu'
  pollIntervalSeconds?: number
}

export const VIDEO_MODELS: Record<string, VideoModelDefinition> = {
  'MiniMax-H3': {
    displayName: 'MiniMax H3',
    model: 'MiniMax-H3',
    adapter: 'h3',
    logo: 'minimax',
    badges: [
      { label: '推荐', tone: 'recommended' },
      { label: '稳定快速', tone: 'recommended' },
      { label: '15S', tone: 'recommended' },
    ],
    modes: {
      t2v: {},
      i2v: { maxImages: 1 },
      flf2v: { maxImages: 2 },
      ref2v: { maxImages: 9, maxVideos: 3, maxAudios: 3 },
    },
    duration: { min: 4, max: 15, step: 1, default: 4 },
    resolutions: ['768p', '2k'],
    aspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    audio: 'always',
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsPromptEnhance: false,
    maxPromptChars: 7000,
    refMention: 'none',
    maxConcurrency: 2,
    pricePerSecondCredits: {
      '768p': 2.5,
      '2k': 5,
    },
    referencePricing: {
      freeImages: 5,
      imageCredits: 0.625,
      videoPerSecondCredits: { '768p': 1.25, '2k': 2.5 },
    },
  },
  'wan3.0-video-720p': {
    displayName: 'Wan 3.0 Video', model: 'wan3.0-video-720p', adapter: 'wan', logo: 'wan',
    badges: [
      { label: '优质', tone: 'quality' },
      { label: '30S长视频', tone: 'quality' },
    ],
    modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 10, maxVideos: 5, maxAudios: 5, maxRefMediaSeconds: 15 } },
    duration: { min: 4, max: 30, step: 1, default: 8 }, maxOutputSecondsWithVideo: 15,
    resolutions: ['720p'], aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'], defaultAspectRatio: '16:9',
    pricePerSecondCredits: { '720p': 5 },
    audio: 'none', supportsSeed: false, supportsNegativePrompt: false, refMention: 'ordinal', fixedQuantity: 1,
    requiresProxy: true, pollIntervalSeconds: 15, referenceUpload: 'uguu',
    maxImageBytes: 30 * 1024 * 1024, maxVideoBytes: 50 * 1024 * 1024, maxAudioBytes: 15 * 1024 * 1024,
    videoMimeTypes: ['video/mp4', 'video/quicktime'], audioMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'],
  },
  'grok-imagine-video-1.5': {
    displayName: 'Grok Imagine Video 1.5',
    model: 'grok-imagine-video-1.5',
    adapter: 'grok',
    logo: 'grok',
    modes: {
      t2v: {},
      i2v: { maxImages: 1 },
    },
    duration: { min: 1, max: 15, step: 1, default: 8 },
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    audio: 'none',
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsPromptEnhance: false,
    maxPromptChars: 7000,
    refMention: 'none',
    fixedQuantity: 1,
    pricePerRequestCredits: 15,
    defaultAspectRatio: '16:9',
    requiresProxy: true,
    allowsImageOnly: true,
  },
  'gemini-omni-flash-10s': {
    displayName: 'gemini-omni-flash-10s',
    model: 'gemini-omni-flash-10s',
    adapter: 'omni',
    logo: 'gemini',
    pricePerRequestCredits: 25,
    modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 7 } },
    duration: { min: 10, max: 10, step: 1, default: 10 },
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
    audio: 'none',
    supportsSeed: false,
    supportsNegativePrompt: false,
    refMention: 'none',
    fixedQuantity: 1,
    requiresProxy: true,
  },
  'sd2.0-15s': sdModel('sd2.0-15s', 15, 20),
  'sd2.5-30s': sdModel('sd2.5-30s', 30, 38),
}

function sdModel(model: string, duration: number, pricePerRequestCredits: number): VideoModelDefinition {
  return {
    displayName: model,
    model,
    adapter: 'sd',
    logo: 'seedance',
    badges: [{ label: '耗时较长', tone: 'warning' }],
    pricePerRequestCredits,
    modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 30 } },
    duration: { min: duration, max: duration, step: 1, default: duration },
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    defaultAspectRatio: '16:9',
    audio: 'none',
    supportsSeed: false,
    supportsNegativePrompt: false,
    refMention: 'none',
    fixedQuantity: 1,
    requiresProxy: true,
    imageMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxImageBytes: 15 * 1024 * 1024,
    pollIntervalSeconds: 15,
  }
}

export const DEFAULT_VIDEO_MODEL = 'MiniMax-H3'

export function getVideoModelDefinition(model: string): VideoModelDefinition | undefined {
  return VIDEO_MODELS[model]
}

export function getAllVideoModels(): VideoModelDefinition[] {
  return Object.values(VIDEO_MODELS)
}

export function getVideoModelPriceLabel(model: string, resolution?: VideoResolution): string {
  const definition = getVideoModelDefinition(model)
  if (!definition) return '价格待配置'
  if (definition.pricePerRequestCredits !== undefined) {
    return `${definition.pricePerRequestCredits} 积分/次`
  }
  const modelResolution = resolution && definition.resolutions.includes(resolution)
    ? resolution
    : definition.resolutions[0]
  const price = definition.pricePerSecondCredits?.[modelResolution]
  return price === undefined ? '价格待配置' : `${price} 积分/秒${definition.referencePricing ? '起' : ''}`
}

export function getModelsForMode(mode: VideoMode): VideoModelDefinition[] {
  return getAllVideoModels().filter((def) => def.modes[mode])
}

export function fallbackVideoMode(model: string, mode: VideoMode): VideoMode {
  const def = getVideoModelDefinition(model)
  if (!def) return 't2v'
  if (def.modes[mode]) return mode

  const fallbackChain: VideoMode[] = ['t2v', 'i2v', 'flf2v', 'ref2v']
  for (const m of fallbackChain) {
    if (def.modes[m]) return m
  }
  return 't2v'
}

export function normalizeVideoQuantity(value: unknown): VideoQuantity {
  return value === 2 || value === 4 ? value : 1
}

export function normalizeVideoParams(
  params: Partial<VideoParams>,
  model: string,
  mode: VideoMode,
  hasReferenceVideo = false,
): VideoParams {
  const def = getVideoModelDefinition(model)
  if (!def) {
    return {
      duration: 4,
      resolution: '768p',
      aspectRatio: 'auto',
      audio: true,
      n: 1,
      ...params,
    }
  }

  const modeSpec = def.modes[mode]
  const ignoredParams = modeSpec?.ignoredParams || []
  const durationSpec = getVideoDurationSpec(model, hasReferenceVideo)

  const normalized: VideoParams = {
    duration: clamp(params.duration ?? def.duration.default, durationSpec.min, durationSpec.max),
    resolution:
      params.resolution && def.resolutions.includes(params.resolution)
        ? params.resolution
        : def.resolutions[0],
    aspectRatio:
      params.aspectRatio && def.aspectRatios.includes(params.aspectRatio)
        ? params.aspectRatio
        : def.defaultAspectRatio && def.aspectRatios.includes(def.defaultAspectRatio)
          ? def.defaultAspectRatio
          : def.aspectRatios[0],
    audio: def.audio === 'always' ? true : def.audio === 'none' ? false : params.audio ?? true,
    n: def.fixedQuantity ?? normalizeVideoQuantity(params.n),
  }

  if (def.supportsSeed && !ignoredParams.includes('seed')) {
    normalized.seed = params.seed
  }

  if (def.supportsNegativePrompt && !ignoredParams.includes('negativePrompt')) {
    normalized.negativePrompt = params.negativePrompt
  }

  if (def.supportsCameraFixed && !ignoredParams.includes('cameraFixed')) {
    normalized.cameraFixed = params.cameraFixed
  }

  if (def.supportsWatermarkToggle && !ignoredParams.includes('watermark')) {
    normalized.watermark = params.watermark
  }

  if (def.supportsPromptEnhance && !ignoredParams.includes('promptEnhance')) {
    normalized.promptEnhance = params.promptEnhance
  }

  return normalized
}

export function getVideoDurationSpec(model: string, hasReferenceVideo = false) {
  const def = getVideoModelDefinition(model)
  const duration = def?.duration ?? { min: 4, max: 15, step: 1, default: 4 }
  return hasReferenceVideo && def?.maxOutputSecondsWithVideo
    ? { ...duration, max: Math.min(duration.max, def.maxOutputSecondsWithVideo) }
    : duration
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function estimateVideoCredits(
  model: string,
  duration: number,
  resolution: VideoResolution,
  refImageCount: number,
  refVideoSeconds: number,
  n: number,
): number {
  const def = getVideoModelDefinition(model)
  if (def?.pricePerRequestCredits !== undefined) {
    return def.pricePerRequestCredits * (def.fixedQuantity ?? n)
  }
  const pricePerSecond = def?.pricePerSecondCredits?.[resolution]
  if (pricePerSecond === undefined) return 0

  if (def?.referencePricing) {
    const { freeImages, imageCredits, videoPerSecondCredits } = def.referencePricing
    const referenceCost = Math.max(refImageCount - freeImages, 0) * imageCredits
      + refVideoSeconds * (videoPerSecondCredits[resolution] ?? 0)
    return Number(((duration * pricePerSecond + referenceCost) * (def.fixedQuantity ?? n)).toFixed(3))
  }

  return Math.ceil(duration * pricePerSecond * (def?.fixedQuantity ?? n) * 10) / 10
}

export function formatVideoMode(mode: VideoMode): string {
  const map: Record<VideoMode, string> = {
    t2v: '文生视频',
    i2v: '图生视频',
    flf2v: '首尾帧',
    ref2v: '参考生视频',
  }
  return map[mode] || mode
}

export function formatVideoResolution(resolution: VideoResolution): string {
  const map: Record<VideoResolution, string> = {
    '480p': '480P',
    '720p': '720P',
    '768p': '768P',
    '1080p': '1080P',
    '2k': '2K',
  }
  return map[resolution] || resolution
}
