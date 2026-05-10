const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/
const SIZE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_ASPECT_RATIO = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400

export type SizeTier = '1K' | '2K' | '4K'

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple)
}

function normalizeDimensions(width: number, height: number, isGemini?: boolean) {
  const maxEdge = isGemini ? 8192 : 3840
  const maxPixels = isGemini ? 20000000 : 8294400 // Gemini allows up to ~17.5M in the table
  let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE)
  let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE)

  const scaleToFit = (scale: number) => {
    normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  const scaleToFill = (scale: number) => {
    normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  for (let i = 0; i < 4; i++) {
    const currentMaxEdge = Math.max(normalizedWidth, normalizedHeight)
    if (currentMaxEdge > maxEdge) {
      scaleToFit(maxEdge / currentMaxEdge)
    }

    if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
      normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    } else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
      normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    }

    const pixels = normalizedWidth * normalizedHeight
    if (pixels > maxPixels) {
      scaleToFit(Math.sqrt(maxPixels / pixels))
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels))
    }
  }

  return { width: normalizedWidth, height: normalizedHeight }
}

export function normalizeImageSize(size: string, isGemini?: boolean) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]), isGemini)
  return `${width}x${height}`
}

export function parseRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export function formatImageRatio(width: number, height: number) {
  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return ''
  }

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(roundedWidth, roundedHeight)
  const simplifiedWidth = roundedWidth / divisor
  const simplifiedHeight = roundedHeight / divisor
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`
  const commonRatios = [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [21, 9],
    [9, 21],
  ]

  for (const [commonWidth, commonHeight] of commonRatios) {
    if (simplifiedWidth === commonWidth && simplifiedHeight === commonHeight) {
      return simplified
    }
  }

  const actualRatio = roundedWidth / roundedHeight
  const squareDelta = Math.abs(actualRatio - 1)
  if (squareDelta <= 0.18) return '≈1:1'

  const nearest = commonRatios
    .map(([commonWidth, commonHeight]) => {
      const ratio = commonWidth / commonHeight
      return {
        label: `${commonWidth}:${commonHeight}`,
        delta: Math.abs(actualRatio - ratio) / ratio,
      }
    })
    .sort((a, b) => a.delta - b.delta)[0]

  if (nearest && nearest.delta <= 0.01) return `≈${nearest.label}`

  const friendlyNearest = Array.from({ length: 12 }, (_, widthIndex) => widthIndex + 1)
    .flatMap((friendlyWidth) =>
      Array.from({ length: 12 }, (_, heightIndex) => heightIndex + 1).map((friendlyHeight) => {
        const ratio = friendlyWidth / friendlyHeight
        const delta = Math.abs(actualRatio - ratio) / ratio
        return {
          label: `${friendlyWidth}:${friendlyHeight}`,
          delta,
          // 在误差接近时偏向更短、更好读的比例，例如 7:6 优于 8:7。
          score: delta + (friendlyWidth + friendlyHeight) * 0.002,
        }
      }),
    )
    .filter((item) => item.label !== simplified)
    .sort((a, b) => a.score - b.score)[0]

  return friendlyNearest && friendlyNearest.delta <= 0.04 ? `≈${friendlyNearest.label}` : simplified
}

const GEMINI_SIZE_TABLE: Record<string, Record<SizeTier, [number, number]>> = {
  '1:1': { '1K': [1024, 1024], '2K': [2048, 2048], '4K': [4096, 4096] },
  '9:16': { '1K': [768, 1376], '2K': [1536, 2752], '4K': [3072, 5504] },
  '2:3': { '1K': [848, 1264], '2K': [1696, 2528], '4K': [3392, 5056] },
  '3:2': { '1K': [1264, 848], '2K': [2528, 1696], '4K': [5056, 3392] },
  '4:5': { '1K': [928, 1152], '2K': [1856, 2304], '4K': [3712, 4608] },
  '5:4': { '1K': [1152, 928], '2K': [2304, 1856], '4K': [4608, 3712] },
  '16:9': { '1K': [1376, 768], '2K': [2752, 1536], '4K': [5504, 3072] },
  '21:9': { '1K': [1584, 672], '2K': [3168, 1344], '4K': [6336, 2688] },
}

export function getGeminiParamsFromSize(size: string): { aspect_ratio?: string, image_size?: string } | null {
  for (const [ratio, tiers] of Object.entries(GEMINI_SIZE_TABLE)) {
    for (const [tier, [w, h]] of Object.entries(tiers)) {
      if (`${w}x${h}` === size) {
        return { aspect_ratio: ratio, image_size: tier as SizeTier }
      }
    }
  }
  return null
}

export function calculateImageSize(tier: SizeTier, ratio: string, isGemini?: boolean) {
  if (isGemini) {
    const table = GEMINI_SIZE_TABLE[ratio]
    if (table) {
      const [w, h] = table[tier]
      return `${w}x${h}`
    }
  }

  const parsed = parseRatio(ratio)
  if (!parsed) return null

  const { width: ratioWidth, height: ratioHeight } = parsed

  if (isGemini) {
    const areaBenchmark = tier === '1K' ? 1048576 : tier === '2K' ? 4194304 : 16777216
    const r = ratioWidth / ratioHeight
    const width = roundToMultiple(Math.sqrt(areaBenchmark * r), SIZE_MULTIPLE)
    const height = roundToMultiple(width / r, SIZE_MULTIPLE)
    return normalizeImageSize(`${width}x${height}`, true)
  }

  const longBenchmark = tier === '1K' ? 1024 : tier === '2K' ? 2048 : 3840
  let width, height
  if (ratioWidth >= ratioHeight) {
    width = longBenchmark
    height = roundToMultiple(longBenchmark * ratioHeight / ratioWidth, SIZE_MULTIPLE)
  } else {
    height = longBenchmark
    width = roundToMultiple(longBenchmark * ratioWidth / ratioHeight, SIZE_MULTIPLE)
  }

  return normalizeImageSize(`${width}x${height}`, false)
}
