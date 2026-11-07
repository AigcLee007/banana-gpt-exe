export const MIDJOURNEY_LOW = 'Midjourney v8.2-Low'
export const MIDJOURNEY_HIGH = 'Midjourney v8.2-High'
export const MIDJOURNEY_QUALITIES = ['0.25', '0.5', '1', '2'] as const
const RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'] as const

export function isMidjourneyModel(model: string) {
  return model === MIDJOURNEY_LOW || model === MIDJOURNEY_HIGH
}

export function getMidjourneyRatios(model: string): readonly string[] {
  return model === MIDJOURNEY_HIGH ? [...RATIOS, 'auto', '9:21'] : RATIOS
}

export function getImageReferenceLimit(model: string): number {
  return model === MIDJOURNEY_LOW ? 1 : model === MIDJOURNEY_HIGH ? 5 : 16
}
