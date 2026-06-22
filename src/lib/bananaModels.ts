export type BananaModelRoute = 'gemini-native' | 'openai-images' | 'openai-responses'

export interface BananaGalleryModel {
  displayName: string
  model: string
  providerRoute: BananaModelRoute
  supportsReferenceImages: boolean
}

export const AGENT_FIXED_MODEL = 'gpt-5.5'

export const BANANA_MODEL_REGISTRY = [
  {
    displayName: 'Nano Banana Pro',
    model: 'gemini-3-pro-image-preview',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
  },
  {
    displayName: 'Nano Banana 2',
    model: 'gemini-3.1-flash-image-preview',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2',
    model: 'gpt-image-2',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2(High)',
    model: 'gpt-image-2-svip',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2(VIP)',
    model: 'gpt-5.5',
    providerRoute: 'openai-responses',
    supportsReferenceImages: true,
  },
] as const satisfies readonly BananaGalleryModel[]

export const BANANA_GALLERY_MODELS = BANANA_MODEL_REGISTRY.filter((item) => item.model !== 'gpt-5.5')

export const DEFAULT_GALLERY_MODEL = 'gemini-3-pro-image-preview'

function normalizeModelLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '')
}

export function normalizeBananaModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return trimmed

  const byId = BANANA_MODEL_REGISTRY.find((item) => item.model === trimmed)
  if (byId) return byId.model

  const lookup = normalizeModelLookupKey(trimmed)
  const byDisplayName = BANANA_MODEL_REGISTRY.find((item) => normalizeModelLookupKey(item.displayName) === lookup)
  if (byDisplayName) return byDisplayName.model

  if (lookup === 'nanobananapro') return 'gemini-3-pro-image-preview'
  if (lookup === 'nanobanana2') return 'gemini-3.1-flash-image-preview'
  if (lookup === 'gptimage2') return 'gpt-image-2'
  if (lookup === 'gptimage2high' || lookup === 'gptimage2svip') return 'gpt-image-2-svip'
  if (lookup === 'gptimage2vip' || lookup === 'gpt55') return 'gpt-5.5'

  return trimmed
}

export function getBananaModelById(model: string): BananaGalleryModel | undefined {
  const normalized = normalizeBananaModelId(model)
  return BANANA_MODEL_REGISTRY.find((item) => item.model === normalized)
}

export function getBananaModelByDisplayName(displayName: string): BananaGalleryModel | undefined {
  const normalized = normalizeModelLookupKey(displayName)
  return BANANA_GALLERY_MODELS.find((item) => normalizeModelLookupKey(item.displayName) === normalized)
}

export function getBananaModelRoute(model: string): BananaModelRoute | undefined {
  return getBananaModelById(model)?.providerRoute
}

export function getActiveBananaModelForMode(
  appMode: 'gallery' | 'agent',
  galleryModel: string,
  agentImageModel: string,
): string {
  return appMode === 'agent' ? agentImageModel : galleryModel
}

export function getActiveBananaModelRouteForMode(
  appMode: 'gallery' | 'agent',
  galleryModel: string,
  agentImageModel: string,
): BananaModelRoute | undefined {
  return getBananaModelRoute(getActiveBananaModelForMode(appMode, galleryModel, agentImageModel))
}

export function getBananaDesktopParamGridColumnsForMode(
  appMode: 'gallery' | 'agent',
  galleryModel: string,
  agentImageModel: string,
): 'grid-cols-4' | 'grid-cols-6' | 'grid-cols-7' {
  const activeRoute = getActiveBananaModelRouteForMode(appMode, galleryModel, agentImageModel)
  if (activeRoute === 'gemini-native') return 'grid-cols-4'
  return appMode === 'gallery' ? 'grid-cols-7' : 'grid-cols-6'
}

export function isGeminiNativeModel(model: string): boolean {
  return getBananaModelRoute(model) === 'gemini-native'
}

export function isOpenAIImagesModel(model: string): boolean {
  return getBananaModelRoute(model) === 'openai-images'
}

export function isOpenAIResponsesModel(model: string): boolean {
  return getBananaModelRoute(model) === 'openai-responses'
}
