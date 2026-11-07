import type { ApiProfile } from '../types'
import { getBananaModelById } from './bananaModels'

export const DEFAULT_SVG_MODEL = 'gpt-6.1-sol'

export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

function isGptImageAtLeast(model: string, minor: number) {
  const match = model.trim().match(/gpt-image-(\d+)(?:\.(\d+))?/i)
  return Boolean(match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2] ?? 0) >= minor)))
}

export function isGptImage25PlusModel(model: string) { return isGptImageAtLeast(model, 5) }
export function isGptImage26PlusModel(model: string) { return isGptImageAtLeast(model, 6) }
export function supportsGptImage26Params(profile: ApiProfile) {
  return getBananaModelById(getImageGenerationModel(profile))?.supportsOutputOptions === true
}
export function isVectorOrAnimatedFormat(format: string | undefined) { return format === 'svg' || format === 'gif' }
