export type BananaModelRoute = 'gemini-native' | 'openai-images' | 'openai-responses'

export interface BananaGalleryModel {
  displayName: string
  model: string
  providerRoute: BananaModelRoute
  supportsReferenceImages: boolean
}

export const AGENT_FIXED_MODEL = 'gpt-5.5'

export const BANANA_GALLERY_MODELS = [
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
    displayName: 'GPT-Image-2(VIP)',
    model: 'gpt-5.5',
    providerRoute: 'openai-responses',
    supportsReferenceImages: true,
  },
] as const satisfies readonly BananaGalleryModel[]

export const DEFAULT_GALLERY_MODEL = 'gemini-3-pro-image-preview'

function normalizeModelLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '')
}

export function normalizeBananaModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return trimmed

  const byId = BANANA_GALLERY_MODELS.find((item) => item.model === trimmed)
  if (byId) return byId.model

  const lookup = normalizeModelLookupKey(trimmed)
  const byDisplayName = BANANA_GALLERY_MODELS.find((item) => normalizeModelLookupKey(item.displayName) === lookup)
  if (byDisplayName) return byDisplayName.model

  if (lookup === 'nanobananapro') return 'gemini-3-pro-image-preview'
  if (lookup === 'nanobanana2') return 'gemini-3.1-flash-image-preview'
  if (lookup === 'gptimage2') return 'gpt-image-2'
  if (lookup === 'gptimage2vip' || lookup === 'gpt55') return 'gpt-5.5'

  return trimmed
}

export function getBananaModelById(model: string): BananaGalleryModel | undefined {
  const normalized = normalizeBananaModelId(model)
  return BANANA_GALLERY_MODELS.find((item) => item.model === normalized)
}

export function getBananaModelByDisplayName(displayName: string): BananaGalleryModel | undefined {
  const normalized = normalizeModelLookupKey(displayName)
  return BANANA_GALLERY_MODELS.find((item) => normalizeModelLookupKey(item.displayName) === normalized)
}

export function getBananaModelRoute(model: string): BananaModelRoute | undefined {
  return getBananaModelById(model)?.providerRoute
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
