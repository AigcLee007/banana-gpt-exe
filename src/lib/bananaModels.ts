export type BananaModelRoute = 'gemini-native' | 'openai-images'

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
] as const satisfies readonly BananaGalleryModel[]

export const DEFAULT_GALLERY_MODEL = 'gemini-3-pro-image-preview'

export function getBananaModelById(model: string): BananaGalleryModel | undefined {
  const normalized = model.trim()
  return BANANA_GALLERY_MODELS.find((item) => item.model === normalized)
}

export function getBananaModelByDisplayName(displayName: string): BananaGalleryModel | undefined {
  const normalized = displayName.trim().toLowerCase()
  return BANANA_GALLERY_MODELS.find((item) => item.displayName.toLowerCase() === normalized)
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
