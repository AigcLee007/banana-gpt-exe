export const GEMINI_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type GeminiAspectRatio = typeof GEMINI_ASPECT_RATIOS[number]

export const GEMINI_IMAGE_SIZES = ['1K', '2K', '4K'] as const
export type GeminiImageSize = typeof GEMINI_IMAGE_SIZES[number]

type GeminiOutputPixels = `${number}x${number}`

export const GEMINI_OUTPUT_SIZE_TABLE: Record<GeminiAspectRatio, Record<GeminiImageSize, GeminiOutputPixels>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '2:3': { '1K': '848x1264', '2K': '1696x2528', '4K': '3392x5056' },
  '3:2': { '1K': '1264x848', '2K': '2528x1696', '4K': '5056x3392' },
  '3:4': { '1K': '896x1200', '2K': '1792x2400', '4K': '3584x4800' },
  '4:3': { '1K': '1200x896', '2K': '2400x1792', '4K': '4800x3584' },
  '4:5': { '1K': '928x1152', '2K': '1856x2304', '4K': '3712x4608' },
  '5:4': { '1K': '1152x928', '2K': '2304x1856', '4K': '4608x3712' },
  '9:16': { '1K': '768x1376', '2K': '1536x2752', '4K': '3072x5504' },
  '16:9': { '1K': '1376x768', '2K': '2752x1536', '4K': '5504x3072' },
  '21:9': { '1K': '1584x672', '2K': '3168x1344', '4K': '6336x2688' },
}

function isGeminiAspectRatio(value: string): value is GeminiAspectRatio {
  return GEMINI_ASPECT_RATIOS.includes(value as GeminiAspectRatio)
}

function isGeminiImageSize(value: string): value is GeminiImageSize {
  return GEMINI_IMAGE_SIZES.includes(value as GeminiImageSize)
}

function parsePixels(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+)\s*[xX脳]\s*(\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function parseAspectRatio(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

export function getGeminiOutputPixels(aspectRatio: GeminiAspectRatio, imageSize: GeminiImageSize): GeminiOutputPixels {
  return GEMINI_OUTPUT_SIZE_TABLE[aspectRatio][imageSize]
}

export function normalizeGeminiAspectRatio(value: string | undefined | null): GeminiAspectRatio {
  const trimmed = (value ?? '').trim()
  if (isGeminiAspectRatio(trimmed)) return trimmed

  const parsed = parsePixels(trimmed) ?? parseAspectRatio(trimmed)
  if (!parsed) return '1:1'

  const actualRatio = parsed.width / parsed.height
  let bestMatch: GeminiAspectRatio = '1:1'
  let bestDelta = Number.POSITIVE_INFINITY

  for (const candidate of GEMINI_ASPECT_RATIOS) {
    const ratio = parseAspectRatio(candidate)
    if (!ratio) continue
    const delta = Math.abs(actualRatio - ratio.width / ratio.height)
    if (delta < bestDelta) {
      bestDelta = delta
      bestMatch = candidate
    }
  }

  return bestMatch
}

export function normalizeGeminiImageSize(value: string | undefined | null): GeminiImageSize {
  const trimmed = (value ?? '').trim().toUpperCase()
  if (isGeminiImageSize(trimmed)) return trimmed

  const parsed = parsePixels(value ?? '')
  if (!parsed) return '2K'

  const longEdge = Math.max(parsed.width, parsed.height)
  if (longEdge <= 1600) return '1K'
  if (longEdge <= 3200) return '2K'
  return '4K'
}
