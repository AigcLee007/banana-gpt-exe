export interface ColorChannelStatistics {
  mean: number
  p10: number
  median: number
  p90: number
  clippedLowPercent: number
  clippedHighPercent: number
}

export interface ColorImageAnalysis {
  width: number
  height: number
  samplingStep: number
  sampledPixels: number
  ignoredTransparentSamples: number
  channels: Record<'red' | 'green' | 'blue', ColorChannelStatistics>
  luminance: {
    shadowPercent: number
    midtonePercent: number
    highlightPercent: number
    clippedBlackPercent: number
    clippedWhitePercent: number
  }
  lowChromaCandidates: {
    sampleCount: number
    percent: number
    medianLab: { lightness: number; a: number; b: number } | null
  }
}

const MAX_ANALYSIS_SAMPLES = 50_000
const MIN_NEUTRAL_SAMPLES = 8
const LOW_CHROMA_THRESHOLD = 35

export function analyzeImageColors(data: Uint8ClampedArray, width: number, height: number): ColorImageAnalysis {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || data.length !== width * height * 4) {
    throw new Error('像素数据尺寸无效')
  }

  const samplingStep = Math.max(1, Math.ceil(Math.sqrt(width * height / MAX_ANALYSIS_SAMPLES)))
  const channelHistograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  const channelSums = [0, 0, 0]
  const channelLowCounts = [0, 0, 0]
  const channelHighCounts = [0, 0, 0]
  const labLightnessHistogram = new Uint32Array(101)
  const labAHistogram = new Uint32Array(256)
  const labBHistogram = new Uint32Array(256)
  let sampledPixels = 0
  let ignoredTransparentSamples = 0
  let shadowPixels = 0
  let midtonePixels = 0
  let highlightPixels = 0
  let clippedBlackPixels = 0
  let clippedWhitePixels = 0
  let lowChromaPixelCount = 0

  for (let y = 0; y < height; y += samplingStep) {
    for (let x = 0; x < width; x += samplingStep) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]
      if (alpha < 250) {
        ignoredTransparentSamples += 1
        continue
      }

      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const channels = [red, green, blue]
      sampledPixels += 1

      for (let channel = 0; channel < 3; channel += 1) {
        const value = channels[channel]
        channelHistograms[channel][value] += 1
        channelSums[channel] += value
        if (value <= 3) channelLowCounts[channel] += 1
        if (value >= 252) channelHighCounts[channel] += 1
      }

      const linearRed = toLinear(red / 255)
      const linearGreen = toLinear(green / 255)
      const linearBlue = toLinear(blue / 255)
      const luminance = 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue
      if (luminance < 0.2) shadowPixels += 1
      else if (luminance < 0.8) midtonePixels += 1
      else highlightPixels += 1
      if (luminance <= 0.003) clippedBlackPixels += 1
      if (luminance >= 0.997) clippedWhitePixels += 1

      const lab = toLab(linearRed, linearGreen, linearBlue)
      if (lab.lightness >= 18 && lab.lightness <= 92 && Math.hypot(lab.a, lab.b) <= LOW_CHROMA_THRESHOLD) {
        lowChromaPixelCount += 1
        labLightnessHistogram[clamp(Math.round(lab.lightness), 0, 100)] += 1
        labAHistogram[clamp(Math.round(lab.a + 128), 0, 255)] += 1
        labBHistogram[clamp(Math.round(lab.b + 128), 0, 255)] += 1
      }
    }
  }

  if (sampledPixels === 0) throw new Error('预览中没有可分析的不透明像素')

  const channelNames = ['red', 'green', 'blue'] as const
  const channels = Object.fromEntries(channelNames.map((name, index) => [name, {
    mean: round1(channelSums[index] / sampledPixels),
    p10: percentile(channelHistograms[index], sampledPixels, 0.1),
    median: percentile(channelHistograms[index], sampledPixels, 0.5),
    p90: percentile(channelHistograms[index], sampledPixels, 0.9),
    clippedLowPercent: percent(channelLowCounts[index], sampledPixels),
    clippedHighPercent: percent(channelHighCounts[index], sampledPixels),
  }])) as ColorImageAnalysis['channels']

  return {
    width,
    height,
    samplingStep,
    sampledPixels,
    ignoredTransparentSamples,
    channels,
    luminance: {
      shadowPercent: percent(shadowPixels, sampledPixels),
      midtonePercent: percent(midtonePixels, sampledPixels),
      highlightPercent: percent(highlightPixels, sampledPixels),
      clippedBlackPercent: percent(clippedBlackPixels, sampledPixels),
      clippedWhitePercent: percent(clippedWhitePixels, sampledPixels),
    },
    lowChromaCandidates: {
      sampleCount: lowChromaPixelCount,
      percent: percent(lowChromaPixelCount, sampledPixels),
      medianLab: lowChromaPixelCount < MIN_NEUTRAL_SAMPLES ? null : {
        lightness: percentile(labLightnessHistogram, lowChromaPixelCount, 0.5),
        a: percentile(labAHistogram, lowChromaPixelCount, 0.5) - 128,
        b: percentile(labBHistogram, lowChromaPixelCount, 0.5) - 128,
      },
    },
  }
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function toLab(red: number, green: number, blue: number) {
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883
  const fx = labPivot(x)
  const fy = labPivot(y)
  const fz = labPivot(z)
  return {
    lightness: Math.max(0, 116 * fy - 16),
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function labPivot(value: number): number {
  return value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116
}

function percentile(histogram: Uint32Array, count: number, fraction: number): number {
  const targetIndex = Math.floor((count - 1) * fraction)
  let accumulated = 0
  for (let index = 0; index < histogram.length; index += 1) {
    accumulated += histogram[index]
    if (accumulated > targetIndex) return index
  }
  return histogram.length - 1
}

function percent(count: number, total: number): number {
  return round1((count / total) * 100)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
