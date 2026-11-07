import { DEFAULT_PARAMS, type ApiProfile, type AppSettings, type TaskParams } from '../types'
import { getImageGenerationModel, isVectorOrAnimatedFormat, supportsGptImage26Params } from './imageModels'
import { getActiveApiProfile } from './apiProfiles'
import { getBananaMaxSizeTier, getBananaQualityOptions, usesGeminiImageParams } from './bananaModels'
import { getGeminiOutputPixels, normalizeGeminiAspectRatio, normalizeGeminiImageSize } from './geminiImageSizing'
import { normalizeImageSize } from './size'
import { getMidjourneyRatios, isMidjourneyModel, MIDJOURNEY_QUALITIES } from './midjourneyModels'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean; agent?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const imageModel = getImageGenerationModel(activeProfile)
  if (isMidjourneyModel(imageModel)) {
    return {
      ...DEFAULT_PARAMS,
      n: Math.min(MAX_OPENAI_OUTPUT_IMAGES, Math.max(1, Math.trunc(params.n || 1))),
      size: getMidjourneyRatios(imageModel).includes(params.size) ? params.size : '1:1',
      midjourneyQuality: MIDJOURNEY_QUALITIES.includes(params.midjourneyQuality!) ? params.midjourneyQuality : '1',
      midjourneyHd: params.midjourneyHd === true,
      geminiAspectRatio: undefined,
      geminiImageSize: undefined,
      geminiOutputPixels: undefined,
    }
  }
  const maxSizeTier = getBananaMaxSizeTier(imageModel)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nextParams: TaskParams = {
    ...params,
    midjourneyQuality: undefined,
    midjourneyHd: undefined,
    size: normalizeImageSize(params.midjourneyQuality !== undefined && params.size.includes(':') ? DEFAULT_PARAMS.size : params.size, {
      maxTier: maxSizeTier,
    }) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
    output_format: ['png', 'jpeg', 'webp', 'gif', 'svg'].includes(params.output_format) ? params.output_format : DEFAULT_PARAMS.output_format,
  }

  if (usesGeminiImageParams(activeProfile.model)) {
    const geminiAspectRatio = params.geminiAspectRatio
      ? normalizeGeminiAspectRatio(params.geminiAspectRatio)
      : normalizeGeminiAspectRatio(params.size)
    const geminiImageSize = params.geminiImageSize
      ? normalizeGeminiImageSize(params.geminiImageSize)
      : '2K'
    const geminiOutputPixels = getGeminiOutputPixels(geminiAspectRatio, geminiImageSize)
    nextParams.size = geminiOutputPixels
    nextParams.geminiAspectRatio = geminiAspectRatio
    nextParams.geminiImageSize = geminiImageSize
    nextParams.geminiOutputPixels = geminiOutputPixels
    nextParams.transparent_output = false
  } else {
    nextParams.geminiAspectRatio = undefined
    nextParams.geminiImageSize = undefined
    nextParams.geminiOutputPixels = undefined
    if (!supportsGptImage26Params(activeProfile)) {
      nextParams.output_format = DEFAULT_PARAMS.output_format
      nextParams.output_compression = DEFAULT_PARAMS.output_compression
      nextParams.moderation = DEFAULT_PARAMS.moderation
    }
  }

  if (maxSizeTier === '1K' && !/^\d+x\d+$/.test(nextParams.size)) {
    nextParams.size = '1024x1024'
  }

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (activeProfile.provider === 'fal') {
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto' || nextParams.quality === 'xhigh' || nextParams.quality === 'max') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  const disabled = getParamDisabledReasons(activeProfile, options)
  nextParams.complexity = !disabled.complexity && ['auto', 'low', 'medium', 'high'].includes(params.complexity)
    ? params.complexity : DEFAULT_PARAMS.complexity
  const bounded = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
  nextParams.frame_count = bounded(params.frame_count, DEFAULT_PARAMS.frame_count, 2, 16)
  nextParams.frame_duration_ms = bounded(params.frame_duration_ms, DEFAULT_PARAMS.frame_duration_ms, 20, 2000)
  if ((nextParams.output_format === 'gif' && disabled.gif) || (nextParams.output_format === 'svg' && disabled.svg)) {
    nextParams.output_format = 'png'
  }
  if (nextParams.output_format === 'png' || isVectorOrAnimatedFormat(nextParams.output_format)) {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (activeProfile.provider !== 'fal' && !getBananaQualityOptions(getImageGenerationModel(activeProfile)).includes(nextParams.quality)) {
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (nextParams.output_format === 'jpeg') {
    nextParams.transparent_output = false
  }

  return nextParams
}

export function getParamDisabledReasons(profile: ApiProfile, options: { hasInputImages?: boolean; agent?: boolean } = {}): { complexity?: string; gif?: string; svg?: string } {
  const supported = supportsGptImage26Params(profile)
  const modelReason = '仅 1K动图线路支持格式和复杂度选项'
  const galleryReason = options.agent ? 'Agent 模式只能输出位图格式' : undefined
  return {
    complexity: supported ? undefined : modelReason,
    gif: galleryReason ?? (supported ? undefined : modelReason),
    svg: galleryReason ?? (!supported ? modelReason : profile.provider === 'fal' ? 'fal.ai 暂不支持 SVG' : options.hasInputImages ? 'SVG 仅支持文生图，请移除参考图' : undefined),
  }
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
