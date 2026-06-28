export type BananaModelRoute = 'gemini-native' | 'banana-t3-images' | 'openai-images' | 'openai-responses'

export interface BananaGalleryModel {
  displayName: string
  model: string
  providerRoute: BananaModelRoute
  supportsReferenceImages: boolean
}

export const AGENT_FIXED_MODEL = 'gpt-5.5-pro'

export const BANANA_MODEL_REGISTRY = [
  {
    displayName: 'Nano Banana Pro（官方T3）',
    model: 'nano-banana-pro-official-t3',
    providerRoute: 'banana-t3-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'Nano Banana Pro（优惠线路）',
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
    displayName: 'GPT-Image-2(4K线路）',
    model: 'gpt-image-2',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2（备用）',
    model: 'gpt-image-2-svip',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2（Agent线路）',
    model: 'gpt-5.5',
    providerRoute: 'openai-responses',
    supportsReferenceImages: true,
  },
] as const satisfies readonly BananaGalleryModel[]

export const BANANA_GALLERY_MODELS = BANANA_MODEL_REGISTRY.filter((item) =>
  item.model !== 'gemini-3.1-flash-image-preview' &&
  item.model !== 'gpt-5.5'
)

export const DEFAULT_GALLERY_MODEL = 'gemini-3-pro-image-preview'

function normalizeModelLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '').replace(/[()（）]+/g, '')
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
  if (lookup === 'nanobananapro官方t3' || lookup === 'nanobananaproofficialt3' || lookup === 'nanobananaprot3') return 'nano-banana-pro-official-t3'
  if (lookup === 'nanobanana2') return 'gemini-3.1-flash-image-preview'
  if (lookup === 'gptimage2' || lookup === 'gptimage24k线路') return 'gpt-image-2'
  if (lookup === 'gptimage2备用' || lookup === 'gptimage2high' || lookup === 'gptimage2svip') return 'gpt-image-2-svip'
  if (lookup === 'gptimage2agent线路' || lookup === 'gptimage2vip' || lookup === 'gpt55') return 'gpt-5.5'

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
  if (model === AGENT_FIXED_MODEL) return 'openai-responses'
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
  if (activeRoute === 'gemini-native' || activeRoute === 'banana-t3-images') return 'grid-cols-4'
  return appMode === 'gallery' ? 'grid-cols-7' : 'grid-cols-6'
}

export function isGeminiNativeModel(model: string): boolean {
  return getBananaModelRoute(model) === 'gemini-native'
}

export function isBananaT3ImagesModel(model: string): boolean {
  return getBananaModelRoute(model) === 'banana-t3-images'
}

export function usesGeminiImageParams(model: string): boolean {
  const route = getBananaModelRoute(model)
  return route === 'gemini-native' || route === 'banana-t3-images'
}

export function isOpenAIImagesModel(model: string): boolean {
  return getBananaModelRoute(model) === 'openai-images'
}

export function isOpenAIResponsesModel(model: string): boolean {
  return getBananaModelRoute(model) === 'openai-responses'
}
