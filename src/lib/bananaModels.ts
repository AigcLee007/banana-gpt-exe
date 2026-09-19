import { SIZE_TIERS, type SizeTier } from './size'

export type BananaModelRoute = 'gemini-native' | 'banana-t3-images' | 'openai-images' | 'openai-responses'
export type BananaQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const CREDITS_PER_YUAN = 12.5
export const OFFICIAL_T3_MODEL = 'nano-banana-pro-official-t3'

const BANANA_T3_BY_SIZE: Record<SizeTier, { requestModel: string; yuan: number }> = {
  '1K': { requestModel: 'Nano-banana-pro-1K', yuan: 0.5 },
  '2K': { requestModel: 'Nano-banana-pro-2K', yuan: 0.6 },
  '4K': { requestModel: 'Nano-banana-pro-4K', yuan: 0.7 },
}

export interface BananaGalleryModel {
  displayName: string
  model: string
  providerRoute: BananaModelRoute
  supportsReferenceImages: boolean
  supportedSizeTiers?: readonly SizeTier[]
  qualityOptions?: readonly BananaQuality[]
  pricePerImageYuan?: number
}

export const AGENT_TEXT_MODELS = [
  { model: 'gpt-5.6-sol', label: 'GPT-5.6-sol' },
  { model: 'gpt-6-astra', label: 'GPT-6-astra' },
] as const

export type AgentTextModel = typeof AGENT_TEXT_MODELS[number]['model']
export const AGENT_FIXED_MODEL: AgentTextModel = AGENT_TEXT_MODELS[0].model

export const BANANA_MODEL_REGISTRY = [
  {
    displayName: 'Nano Banana Pro（优惠线路）',
    model: 'gemini-3-pro-image-preview',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.4,
  },
  {
    displayName: 'GPT-Image-2.5 Sunburst',
    model: 'gpt-image-2.5-sunburst',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    supportedSizeTiers: SIZE_TIERS,
    pricePerImageYuan: 0.3,
  },
  {
    displayName: 'GPT-Image-2.5 Sunburst(官渠，支持max）',
    model: 'gpt-image-2.5-sunburst-官渠（支持max）',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    supportedSizeTiers: SIZE_TIERS,
    qualityOptions: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    pricePerImageYuan: 0.7,
  },
  {
    displayName: 'GPT-Image-2.5 Flare',
    model: 'gpt-image-2.5-flare',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    supportedSizeTiers: SIZE_TIERS,
    pricePerImageYuan: 0.3,
  },
  {
    displayName: 'GPT-Image-2(4K线路）',
    model: 'gpt-image-2',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.3,
  },
  {
    displayName: 'Seedream 5 Pro (1K/2K)',
    model: 'seedream-5-pro',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    supportedSizeTiers: ['1K', '2K'],
    pricePerImageYuan: 0.25,
  },
  {
    displayName: 'Nano Banana 2',
    model: 'gemini-3.1-flash-image-preview',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.2,
  },
  {
    displayName: 'Nano Banana 2 Lite',
    model: 'gemini-3.1-flash-lite-image',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.1,
  },
  {
    displayName: 'Nano Banana Pro（官方T3）',
    model: OFFICIAL_T3_MODEL,
    providerRoute: 'banana-t3-images',
    supportsReferenceImages: true,
  },
  {
    displayName: 'GPT-Image-2(官转线路，支持高质量4K）',
    model: 'gpt-image-2-official',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.8,
  },
  {
    displayName: 'Nano Banana Pro（备选）',
    model: 'nano-banana-pro',
    providerRoute: 'gemini-native',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.4,
  },
  {
    displayName: 'GPT-Image-2（备用）',
    model: 'gpt-image-2-svip',
    providerRoute: 'openai-images',
    supportsReferenceImages: true,
    pricePerImageYuan: 0.3,
  },
  {
    displayName: 'GPT-Image-2（Agent线路）',
    model: 'gpt-5.5',
    providerRoute: 'openai-responses',
    supportsReferenceImages: true,
  },
] as const satisfies readonly BananaGalleryModel[]

export const BANANA_GALLERY_MODELS = BANANA_MODEL_REGISTRY.filter((item) =>
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
  if (lookup === 'nanobananapro备选') return 'nano-banana-pro'
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

export function getBananaT3RequestModelForSize(imageSize: SizeTier): string {
  return BANANA_T3_BY_SIZE[imageSize].requestModel
}

export function getBananaModelCreditsPerImage(model: string, imageSize: SizeTier = '2K'): number | undefined {
  const normalizedModel = normalizeBananaModelId(model)
  const yuan = normalizedModel === OFFICIAL_T3_MODEL
    ? BANANA_T3_BY_SIZE[imageSize].yuan
    : BANANA_MODEL_REGISTRY.find((item) => item.model === normalizedModel)?.pricePerImageYuan
  return yuan === undefined ? undefined : Number((yuan * CREDITS_PER_YUAN).toFixed(3))
}

export function getBananaModelCreditLabel(model: string, imageSize: SizeTier = '2K'): string {
  const credits = getBananaModelCreditsPerImage(model, imageSize)
  return credits === undefined ? '价格待配置' : `${credits} 💎`
}

export function getBananaSupportedSizeTiers(model: string): readonly SizeTier[] {
  return getBananaModelById(model)?.supportedSizeTiers ?? SIZE_TIERS
}

export function getBananaQualityOptions(model: string): readonly BananaQuality[] {
  return getBananaModelById(model)?.qualityOptions ?? ['auto', 'low', 'medium', 'high']
}

export function getBananaMaxSizeTier(model: string): SizeTier {
  const tiers = getBananaSupportedSizeTiers(model)
  if (tiers.includes('4K')) return '4K'
  if (tiers.includes('2K')) return '2K'
  return '1K'
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
