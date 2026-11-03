export type ColorChannel = 'master' | 'red' | 'green' | 'blue'
export type HueRange = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'magenta'

export interface LevelAdjustment {
  inputBlack: number
  inputWhite: number
  gamma: number
  outputBlack: number
  outputWhite: number
}

export interface CurvePoint {
  x: number
  y: number
}

export interface HslAdjustment {
  hue: number
  saturation: number
  luminance: number
}

export interface ColorWheelAdjustment {
  hue: number
  saturation: number
  luminance: number
}

export interface ColorLut {
  title?: string
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** RGB triplets in .cube order (red changes fastest). */
  data: number[]
}

export interface ColorAdjustments {
  whiteBalance: { temperature: number; tint: number; neutralGains: [number, number, number] }
  basic: {
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    saturation: number
    vibrance: number
  }
  levels: Record<ColorChannel, LevelAdjustment>
  curves: Record<ColorChannel, CurvePoint[]>
  hsl: Record<HueRange, HslAdjustment>
  colorGrading: {
    shadows: ColorWheelAdjustment
    midtones: ColorWheelAdjustment
    highlights: ColorWheelAdjustment
    balance: number
    blending: number
  }
  channelMixer: {
    red: [number, number, number]
    green: [number, number, number]
    blue: [number, number, number]
  }
  lut: ColorLut | null
}

export interface ColorHistogram {
  red: number[]
  green: number[]
  blue: number[]
  maxCount: number
}

const CHANNELS: ColorChannel[] = ['master', 'red', 'green', 'blue']
const HUE_RANGES: HueRange[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']
const HUE_CENTERS: Record<HueRange, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  cyan: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
}
const LEVEL_MAX = 255
const MAX_LUT_SIZE = 64

function defaultLevel(): LevelAdjustment {
  return { inputBlack: 0, inputWhite: LEVEL_MAX, gamma: 1, outputBlack: 0, outputWhite: LEVEL_MAX }
}

function defaultHsl(): HslAdjustment {
  return { hue: 0, saturation: 0, luminance: 0 }
}

function defaultWheel(): ColorWheelAdjustment {
  return { hue: 0, saturation: 0, luminance: 0 }
}

export function createDefaultColorAdjustments(): ColorAdjustments {
  return {
    whiteBalance: { temperature: 6500, tint: 0, neutralGains: [1, 1, 1] },
    basic: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      saturation: 0,
      vibrance: 0,
    },
    levels: Object.fromEntries(CHANNELS.map((channel) => [channel, defaultLevel()])) as Record<ColorChannel, LevelAdjustment>,
    curves: { master: [], red: [], green: [], blue: [] },
    hsl: Object.fromEntries(HUE_RANGES.map((range) => [range, defaultHsl()])) as Record<HueRange, HslAdjustment>,
    colorGrading: {
      shadows: defaultWheel(),
      midtones: defaultWheel(),
      highlights: defaultWheel(),
      balance: 0,
      blending: 50,
    },
    channelMixer: { red: [100, 0, 0], green: [0, 100, 0], blue: [0, 0, 100] },
    lut: null,
  }
}

export function getNeutralWhiteBalance(sample: [number, number, number]): ColorAdjustments['whiteBalance'] {
  if (sample.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    throw new Error('中性点采样值无效')
  }
  const linear = sample.map((channel) => decodeSrgb(channel / 255))
  if (linear.some((channel) => channel <= 0)) throw new Error('请从非纯黑区域采样中性点')

  const reference = kelvinRgb(6500)
  let best = { temperature: 6500, tint: 0, error: Number.POSITIVE_INFINITY }
  for (let temperature = 2000; temperature <= 12000; temperature += 0.5) {
    const target = kelvinRgb(temperature)
    const redGain = (target[0] / target[1]) / (reference[0] / reference[1])
    const blueGain = (target[2] / target[1]) / (reference[2] / reference[1])
    const redBlueError = Math.log((linear[0] * redGain) / (linear[2] * blueGain))
    const requiredRedGain = 1 / ((linear[0] / linear[1]) * redGain)
    const tintRatio = (requiredRedGain - 1) / (0.16 + 0.22 * requiredRedGain)
    const tint = clamp(tintRatio, -1, 1)
    const magenta = tint
    const corrected = [
      linear[0] * redGain * (1 + magenta * 0.16),
      linear[1] * (1 - magenta * 0.22),
      linear[2] * blueGain * (1 + magenta * 0.16),
    ]
    const error = corrected.reduce((sum, value) => sum + Math.log(value / corrected[1]) ** 2, 0)
    if (error < best.error) best = { temperature, tint: tint * 100, error }
    if (Math.abs(redBlueError) < 1e-9 && Math.abs(tintRatio) <= 1) break
  }

  const baseGains = getWhiteBalanceGains(best.temperature, best.tint)
  const targetGains: [number, number, number] = [linear[1] / linear[0], 1, linear[1] / linear[2]]
  const neutralGains = targetGains.map((gain, index) => gain / baseGains[index]) as [number, number, number]
  return {
    temperature: Math.round(best.temperature),
    tint: Math.round(best.tint * 10) / 10,
    neutralGains,
  }
}

export function normalizeColorAdjustments(value: unknown): ColorAdjustments {
  const input = asRecord(value, '调色参数')
  const defaults = createDefaultColorAdjustments()
  const whiteBalance = asRecord(input.whiteBalance ?? {}, '白平衡参数')
  const basic = asRecord(input.basic ?? {}, '基础调色参数')
  const levelsInput = asRecord(input.levels ?? {}, '色阶参数')
  const curvesInput = asRecord(input.curves ?? {}, '曲线参数')
  const hslInput = asRecord(input.hsl ?? {}, 'HSL 参数')
  const gradingInput = asRecord(input.colorGrading ?? {}, '色轮参数')
  const mixerInput = asRecord(input.channelMixer ?? {}, '通道混合参数')

  const levels = Object.fromEntries(CHANNELS.map((channel) => {
    const source = asRecord(levelsInput[channel] ?? defaults.levels[channel], '色阶参数')
    const level = {
      inputBlack: readNumber(source.inputBlack, defaults.levels[channel].inputBlack, 0, 254, '色阶黑场'),
      inputWhite: readNumber(source.inputWhite, defaults.levels[channel].inputWhite, 1, 255, '色阶白场'),
      gamma: readNumber(source.gamma, defaults.levels[channel].gamma, 0.01, 9.99, '色阶伽马'),
      outputBlack: readNumber(source.outputBlack, defaults.levels[channel].outputBlack, 0, 255, '输出黑场'),
      outputWhite: readNumber(source.outputWhite, defaults.levels[channel].outputWhite, 0, 255, '输出白场'),
    }
    if (level.inputBlack >= level.inputWhite || level.outputBlack > level.outputWhite) throw new Error('色阶参数范围无效')
    return [channel, level]
  })) as Record<ColorChannel, LevelAdjustment>

  const curves = Object.fromEntries(CHANNELS.map((channel) => {
    const points = curvesInput[channel] ?? []
    if (!Array.isArray(points) || points.length > 64) throw new Error('曲线参数无效')
    const normalized = points.map((point) => {
      const item = asRecord(point, '曲线点')
      return {
        x: readNumber(item.x, 0, 0, 1, '曲线横坐标'),
        y: readNumber(item.y, 0, 0, 1, '曲线纵坐标'),
      }
    }).sort((a, b) => a.x - b.x)
    for (let index = 1; index < normalized.length; index++) {
      if (normalized[index - 1].x === normalized[index].x) throw new Error('曲线不能包含重复横坐标')
    }
    return [channel, normalized]
  })) as Record<ColorChannel, CurvePoint[]>

  const hsl = Object.fromEntries(HUE_RANGES.map((range) => {
    const source = asRecord(hslInput[range] ?? defaults.hsl[range], 'HSL 参数')
    return [range, {
      hue: readNumber(source.hue, 0, -180, 180, 'HSL 色相'),
      saturation: readNumber(source.saturation, 0, -100, 100, 'HSL 饱和度'),
      luminance: readNumber(source.luminance, 0, -100, 100, 'HSL 明度'),
    }]
  })) as Record<HueRange, HslAdjustment>

  const wheel = (name: 'shadows' | 'midtones' | 'highlights'): ColorWheelAdjustment => {
    const source = asRecord(gradingInput[name] ?? defaults.colorGrading[name], '色轮参数')
    return {
      hue: readNumber(source.hue, 0, -180, 180, '色轮色相'),
      saturation: readNumber(source.saturation, 0, 0, 100, '色轮饱和度'),
      luminance: readNumber(source.luminance, 0, -100, 100, '色轮明度'),
    }
  }

  const row = (name: 'red' | 'green' | 'blue', fallback: [number, number, number]): [number, number, number] => {
    const source = mixerInput[name] ?? fallback
    if (!Array.isArray(source) || source.length !== 3) throw new Error('通道混合参数无效')
    return source.map((entry) => readNumber(entry, 0, -200, 200, '通道混合系数')) as [number, number, number]
  }

  return {
    whiteBalance: {
      temperature: readNumber(whiteBalance.temperature, 6500, 2000, 12000, '色温'),
      tint: readNumber(whiteBalance.tint, 0, -100, 100, '色调'),
      neutralGains: readTriplet(whiteBalance.neutralGains, [1, 1, 1], 0.0001, 10000, '白平衡取样补偿'),
    },
    basic: {
      exposure: readNumber(basic.exposure, 0, -5, 5, '曝光'),
      contrast: readNumber(basic.contrast, 0, -100, 100, '对比度'),
      highlights: readNumber(basic.highlights, 0, -100, 100, '高光'),
      shadows: readNumber(basic.shadows, 0, -100, 100, '阴影'),
      whites: readNumber(basic.whites, 0, -100, 100, '白场'),
      blacks: readNumber(basic.blacks, 0, -100, 100, '黑场'),
      saturation: readNumber(basic.saturation, 0, -100, 100, '饱和度'),
      vibrance: readNumber(basic.vibrance, 0, -100, 100, '自然饱和度'),
    },
    levels,
    curves,
    hsl,
    colorGrading: {
      shadows: wheel('shadows'),
      midtones: wheel('midtones'),
      highlights: wheel('highlights'),
      balance: readNumber(gradingInput.balance, 0, -100, 100, '色轮平衡'),
      blending: readNumber(gradingInput.blending, 50, 0, 100, '色轮混合'),
    },
    channelMixer: {
      red: row('red', defaults.channelMixer.red),
      green: row('green', defaults.channelMixer.green),
      blue: row('blue', defaults.channelMixer.blue),
    },
    lut: normalizeLut(input.lut),
  }
}

export function processColorPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: ColorAdjustments,
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || source.length !== width * height * 4) {
    throw new Error('图片像素数据无效')
  }

  const output = new Uint8ClampedArray(source.length)
  const whiteGains = getWhiteBalanceGains(adjustments.whiteBalance.temperature, adjustments.whiteBalance.tint)
    .map((gain, index) => gain * adjustments.whiteBalance.neutralGains[index]) as [number, number, number]
  const contrastFactor = 2 ** (adjustments.basic.contrast / 100)
  const curveTables = Object.fromEntries(CHANNELS.map((channel) => [channel, compileCurve(adjustments.curves[channel])])) as Record<ColorChannel, CurvePoint[] | null>
  if (canUseChannelLookup(adjustments)) {
    const lookup = [0, 1, 2].map((index) => compileChannelLookup(
      adjustments,
      whiteGains[index],
      index as 0 | 1 | 2,
      contrastFactor,
      curveTables,
    )) as [Float64Array, Float64Array, Float64Array]
    const hasGlobalHsl = adjustments.basic.saturation !== 0 || adjustments.basic.vibrance !== 0
    const output = new Uint8ClampedArray(source.length)
    for (let offset = 0; offset < source.length; offset += 4) {
      if (source[offset + 3] === 0) {
        output[offset] = source[offset]
        output[offset + 1] = source[offset + 1]
        output[offset + 2] = source[offset + 2]
        output[offset + 3] = 0
        continue
      }
      const red = lookup[0][source[offset]]
      const green = lookup[1][source[offset + 1]]
      const blue = lookup[2][source[offset + 2]]
      if (hasGlobalHsl) {
        applyGlobalHslToPixel(red, green, blue, adjustments.basic.saturation, adjustments.basic.vibrance, output, offset)
      } else {
        output[offset] = Math.round(red * 255)
        output[offset + 1] = Math.round(green * 255)
        output[offset + 2] = Math.round(blue * 255)
      }
      output[offset + 3] = source[offset + 3]
    }
    return output
  }

  const hasHslAdjustments = adjustments.basic.saturation !== 0
    || adjustments.basic.vibrance !== 0
    || HUE_RANGES.some((range) => {
      const value = adjustments.hsl[range]
      return value.hue !== 0 || value.saturation !== 0 || value.luminance !== 0
    })
  const grading = adjustments.colorGrading
  const hasColorGrading = grading.shadows.hue !== 0 || grading.shadows.saturation !== 0 || grading.shadows.luminance !== 0
    || grading.midtones.hue !== 0 || grading.midtones.saturation !== 0 || grading.midtones.luminance !== 0
    || grading.highlights.hue !== 0 || grading.highlights.saturation !== 0 || grading.highlights.luminance !== 0

  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3]
    output[offset + 3] = alpha
    if (alpha === 0) {
      output[offset] = source[offset]
      output[offset + 1] = source[offset + 1]
      output[offset + 2] = source[offset + 2]
      continue
    }

    let r = decodeSrgb(source[offset] / 255) * whiteGains[0]
    let g = decodeSrgb(source[offset + 1] / 255) * whiteGains[1]
    let b = decodeSrgb(source[offset + 2] / 255) * whiteGains[2]
    const exposure = 2 ** adjustments.basic.exposure
    r = applyBasicTone(r * exposure, contrastFactor, adjustments.basic)
    g = applyBasicTone(g * exposure, contrastFactor, adjustments.basic)
    b = applyBasicTone(b * exposure, contrastFactor, adjustments.basic)

    const mixed = applyChannelMixer(r, g, b, adjustments.channelMixer)
    let channels: [number, number, number] = mixed.map((value) => encodeSrgb(clamp01(value))) as [number, number, number]
    channels = applyLevels(channels, adjustments.levels)
    if (curveTables.master || curveTables.red || curveTables.green || curveTables.blue) channels = applyCurves(channels, curveTables)
    if (hasHslAdjustments) channels = applyHsl(channels, adjustments.basic.saturation, adjustments.basic.vibrance, adjustments.hsl)
    if (hasColorGrading) channels = applyColorGrading(channels, adjustments.colorGrading)
    if (adjustments.lut) channels = sampleLut(channels, adjustments.lut)

    output[offset] = Math.round(clamp01(channels[0]) * 255)
    output[offset + 1] = Math.round(clamp01(channels[1]) * 255)
    output[offset + 2] = Math.round(clamp01(channels[2]) * 255)
  }

  return output
}

export function computeColorHistogram(data: Uint8ClampedArray, width: number, height: number): ColorHistogram {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error('图片像素数据无效')
  }
  const red = Array<number>(256).fill(0)
  const green = Array<number>(256).fill(0)
  const blue = Array<number>(256).fill(0)
  let maxCount = 0

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue
    maxCount = Math.max(
      maxCount,
      ++red[data[offset]],
      ++green[data[offset + 1]],
      ++blue[data[offset + 2]],
    )
  }

  return { red, green, blue, maxCount }
}

export function parseCubeLut(text: string): ColorLut {
  let title: string | undefined
  let size = 0
  const domainMin: [number, number, number] = [0, 0, 0]
  const domainMax: [number, number, number] = [1, 1, 1]
  const rows: number[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue
    const titleMatch = line.match(/^TITLE\s+"(.*)"$/i)
    if (titleMatch) {
      title = titleMatch[1]
      continue
    }
    if (/^LUT_1D_SIZE\b/i.test(line)) throw new Error('LUT 仅支持 3D .cube 文件')
    const sizeMatch = line.match(/^LUT_3D_SIZE\s+(\d+)$/i)
    if (sizeMatch) {
      size = Number(sizeMatch[1])
      if (size < 2 || size > MAX_LUT_SIZE) throw new Error(`LUT 尺寸必须为 2 至 ${MAX_LUT_SIZE}`)
      continue
    }
    const minMatch = line.match(/^DOMAIN_MIN\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)$/i)
    if (minMatch) {
      domainMin.splice(0, 3, ...minMatch.slice(1).map(Number) as [number, number, number])
      continue
    }
    const maxMatch = line.match(/^DOMAIN_MAX\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)$/i)
    if (maxMatch) {
      domainMax.splice(0, 3, ...maxMatch.slice(1).map(Number) as [number, number, number])
      continue
    }
    if (/^(LUT_3D_SIZE|DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) throw new Error('LUT 格式无效')

    const triplet = line.split(/\s+/).map(Number)
    if (triplet.length !== 3 || triplet.some((value) => !Number.isFinite(value))) throw new Error('LUT 数据行无效')
    rows.push(...triplet)
  }

  const domainValues = [...domainMin, ...domainMax]
  if (!size || rows.length !== size ** 3 * 3 || domainValues.some((value) => !Number.isFinite(value)) || domainMin.some((value, index) => domainMax[index] <= value)) {
    throw new Error('LUT 数据不完整或范围无效')
  }
  return { title, size, domainMin, domainMax, data: rows }
}

function normalizeLut(value: unknown): ColorLut | null {
  if (value == null) return null
  const lut = asRecord(value, 'LUT')
  const size = readNumber(lut.size, 0, 2, MAX_LUT_SIZE, 'LUT 尺寸')
  if (!Number.isInteger(size) || !Array.isArray(lut.data) || lut.data.length !== size ** 3 * 3) throw new Error('LUT 数据无效')
  const triplet = (value: unknown, fallback: [number, number, number], label: string): [number, number, number] => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} 无效`)
    return value.map((entry, index) => readNumber(entry, fallback[index], -16, 16, label)) as [number, number, number]
  }
  const domainMin = triplet(lut.domainMin, [0, 0, 0], 'LUT 起始范围')
  const domainMax = triplet(lut.domainMax, [1, 1, 1], 'LUT 结束范围')
  if (domainMin.some((entry, index) => domainMax[index] <= entry)) throw new Error('LUT 范围无效')
  const data = lut.data.map((entry) => readNumber(entry, 0, -16, 16, 'LUT 数据'))
  if (lut.title !== undefined && typeof lut.title !== 'string') throw new Error('LUT 名称无效')
  return { title: typeof lut.title === 'string' ? lut.title.slice(0, 256) : undefined, size, domainMin, domainMax, data }
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}无效`)
  return value as Record<string, unknown>
}

function readNumber(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const normalized = value === undefined ? fallback : value
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new Error(`${name}超出范围`)
  }
  return normalized
}

function readTriplet(value: unknown, fallback: [number, number, number], min: number, max: number, name: string): [number, number, number] {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name}无效`)
  return value.map((entry) => readNumber(entry, 1, min, max, name)) as [number, number, number]
}

function applyBasicTone(value: number, contrast: number, basic: ColorAdjustments['basic']): number {
  let next = (value - 0.18) * contrast + 0.18
  next += (basic.highlights / 100) * smoothstep(0.42, 0.96, next) * 0.45
  next += (basic.shadows / 100) * (1 - smoothstep(0.02, 0.58, next)) * 0.28
  next += (basic.whites / 100) * smoothstep(0.66, 1, next) * 0.24
  next += (basic.blacks / 100) * (1 - smoothstep(0, 0.3, next)) * 0.16
  return clamp01(next)
}

function applyChannelMixer(r: number, g: number, b: number, mixer: ColorAdjustments['channelMixer']): [number, number, number] {
  return [
    (r * mixer.red[0] + g * mixer.red[1] + b * mixer.red[2]) / 100,
    (r * mixer.green[0] + g * mixer.green[1] + b * mixer.green[2]) / 100,
    (r * mixer.blue[0] + g * mixer.blue[1] + b * mixer.blue[2]) / 100,
  ]
}

function canUseChannelLookup(adjustments: ColorAdjustments): boolean {
  const mixer = adjustments.channelMixer
  return mixer.red[0] === 100 && mixer.red[1] === 0 && mixer.red[2] === 0
    && mixer.green[0] === 0 && mixer.green[1] === 100 && mixer.green[2] === 0
    && mixer.blue[0] === 0 && mixer.blue[1] === 0 && mixer.blue[2] === 100
    && HUE_RANGES.every((range) => {
      const value = adjustments.hsl[range]
      return value.hue === 0 && value.saturation === 0 && value.luminance === 0
    })
    && adjustments.colorGrading.shadows.hue === 0 && adjustments.colorGrading.shadows.saturation === 0 && adjustments.colorGrading.shadows.luminance === 0
    && adjustments.colorGrading.midtones.hue === 0 && adjustments.colorGrading.midtones.saturation === 0 && adjustments.colorGrading.midtones.luminance === 0
    && adjustments.colorGrading.highlights.hue === 0 && adjustments.colorGrading.highlights.saturation === 0 && adjustments.colorGrading.highlights.luminance === 0
    && adjustments.lut === null
}

function compileChannelLookup(
  adjustments: ColorAdjustments,
  whiteGain: number,
  channelIndex: 0 | 1 | 2,
  contrastFactor: number,
  curves: Record<ColorChannel, CurvePoint[] | null>,
): Float64Array {
  const channel: ColorChannel = (['red', 'green', 'blue'] as const)[channelIndex]
  const lookup = new Float64Array(256)
  for (let value = 0; value < lookup.length; value++) {
    let linear = decodeSrgb(value / 255) * whiteGain
    linear = applyBasicTone(linear * 2 ** adjustments.basic.exposure, contrastFactor, adjustments.basic)
    let result = encodeSrgb(clamp01(linear))
    const masterLevel = adjustments.levels.master
    if (!isIdentityLevel(masterLevel)) result = mapLevel(result * LEVEL_MAX, masterLevel)
    const channelLevel = adjustments.levels[channel]
    if (!isIdentityLevel(channelLevel)) result = mapLevel(result * LEVEL_MAX, channelLevel)
    const masterCurve = curves.master
    if (masterCurve) result = sampleCurve(result, masterCurve)
    const channelCurve = curves[channel]
    if (channelCurve) result = sampleCurve(result, channelCurve)
    lookup[value] = clamp01(result)
  }
  return lookup
}

function applyGlobalHslToPixel(
  red: number,
  green: number,
  blue: number,
  saturation: number,
  vibrance: number,
  output: Uint8ClampedArray,
  offset: number,
) {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  let hueSegment = 0
  let currentSaturation = 0
  if (delta !== 0) {
    currentSaturation = delta / (1 - Math.abs(2 * lightness - 1))
    if (max === red) hueSegment = ((green - blue) / delta) % 6
    else if (max === green) hueSegment = (blue - red) / delta + 2
    else hueSegment = (red - green) / delta + 4
    if (hueSegment < 0) hueSegment += 6
  }
  currentSaturation = clamp01(
    currentSaturation * Math.max(0, 1 + saturation / 100)
      + (vibrance / 100) * (1 - currentSaturation),
  )

  const chroma = (1 - Math.abs(2 * lightness - 1)) * currentSaturation
  const x = chroma * (1 - Math.abs(hueSegment % 2 - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hueSegment < 1) { r = chroma; g = x }
  else if (hueSegment < 2) { r = x; g = chroma }
  else if (hueSegment < 3) { g = chroma; b = x }
  else if (hueSegment < 4) { g = x; b = chroma }
  else if (hueSegment < 5) { r = x; b = chroma }
  else { r = chroma; b = x }
  const match = lightness - chroma / 2
  output[offset] = Math.round(clamp01(r + match) * 255)
  output[offset + 1] = Math.round(clamp01(g + match) * 255)
  output[offset + 2] = Math.round(clamp01(b + match) * 255)
}

function applyLevels(channels: [number, number, number], levels: ColorAdjustments['levels']): [number, number, number] {
  const master = levels.master
  const red = levels.red
  const green = levels.green
  const blue = levels.blue
  if (isIdentityLevel(master) && isIdentityLevel(red) && isIdentityLevel(green) && isIdentityLevel(blue)) return channels
  const r = isIdentityLevel(master) ? channels[0] : mapLevel(channels[0] * LEVEL_MAX, master)
  const g = isIdentityLevel(master) ? channels[1] : mapLevel(channels[1] * LEVEL_MAX, master)
  const b = isIdentityLevel(master) ? channels[2] : mapLevel(channels[2] * LEVEL_MAX, master)
  return [
    isIdentityLevel(red) ? r : mapLevel(r * LEVEL_MAX, red),
    isIdentityLevel(green) ? g : mapLevel(g * LEVEL_MAX, green),
    isIdentityLevel(blue) ? b : mapLevel(b * LEVEL_MAX, blue),
  ]
}

function isIdentityLevel(level: LevelAdjustment): boolean {
  return level.inputBlack === 0 && level.inputWhite === LEVEL_MAX && level.gamma === 1
    && level.outputBlack === 0 && level.outputWhite === LEVEL_MAX
}

function mapLevel(value: number, level: LevelAdjustment): number {
  const black = clamp(level.inputBlack, 0, 254)
  const white = clamp(level.inputWhite, black + 1, LEVEL_MAX)
  const gamma = clamp(level.gamma, 0.01, 9.99)
  const normalized = clamp01((value - black) / (white - black))
  const corrected = normalized ** (1 / gamma)
  return (level.outputBlack + corrected * (level.outputWhite - level.outputBlack)) / LEVEL_MAX
}

function applyCurves(channels: [number, number, number], curves: Record<ColorChannel, CurvePoint[] | null>): [number, number, number] {
  const master = curves.master
    ? channels.map((value) => sampleCurve(value, curves.master!)) as [number, number, number]
    : channels
  return [
    curves.red ? sampleCurve(master[0], curves.red) : master[0],
    curves.green ? sampleCurve(master[1], curves.green) : master[1],
    curves.blue ? sampleCurve(master[2], curves.blue) : master[2],
  ]
}

function compileCurve(points: CurvePoint[]): CurvePoint[] | null {
  if (points.length < 2) return null
  return [...points].sort((a, b) => a.x - b.x)
}

function sampleCurve(value: number, points: CurvePoint[]): number {
  return evaluateCurve(value, points)
}

function evaluateCurve(value: number, ordered: CurvePoint[]): number {
  if (value <= ordered[0].x) return clamp01(ordered[0].y)
  for (let index = 1; index < ordered.length; index++) {
    const right = ordered[index]
    if (value > right.x) continue
    const left = ordered[index - 1]
    const distance = right.x - left.x
    return clamp01(distance <= 0 ? right.y : left.y + ((value - left.x) / distance) * (right.y - left.y))
  }
  return clamp01(ordered[ordered.length - 1].y)
}

function applyHsl(
  channels: [number, number, number],
  saturation: number,
  vibrance: number,
  ranges: ColorAdjustments['hsl'],
): [number, number, number] {
  let hsl = rgbToHsl(channels[0], channels[1], channels[2])
  const saturationFactor = Math.max(0, 1 + saturation / 100)
  hsl.s = clamp01(hsl.s * saturationFactor + (vibrance / 100) * (1 - hsl.s))
  for (const range of HUE_RANGES) {
    const adjustment = ranges[range]
    const weight = hueWeight(hsl.h, HUE_CENTERS[range])
    hsl.h = wrapHue(hsl.h + adjustment.hue * weight)
    hsl.s = clamp01(hsl.s * (1 + (adjustment.saturation / 100) * weight))
    hsl.l = clamp01(hsl.l + (adjustment.luminance / 100) * 0.35 * weight)
  }
  return hslToRgb(hsl)
}

function applyColorGrading(channels: [number, number, number], grading: ColorAdjustments['colorGrading']): [number, number, number] {
  let hsl = rgbToHsl(channels[0], channels[1], channels[2])
  const balance = clamp(grading.balance, -100, 100) / 100
  const blending = clamp(grading.blending, 0, 100) / 100
  const shadowWeight = (1 - smoothstep(0.18 + balance * 0.12, 0.55 + balance * 0.12 + blending * 0.18, hsl.l))
  const highlightWeight = smoothstep(0.42 + balance * 0.12 - blending * 0.18, 0.86 + balance * 0.12, hsl.l)
  const midtoneWeight = Math.max(0, 1 - shadowWeight - highlightWeight)
  for (const [wheel, weight] of [
    [grading.shadows, shadowWeight],
    [grading.midtones, midtoneWeight],
    [grading.highlights, highlightWeight],
  ] as const) {
    hsl.h = wrapHue(hsl.h + wheel.hue * weight * clamp(wheel.saturation / 100, 0, 1))
    hsl.s = clamp01(hsl.s + wheel.saturation / 100 * weight)
    hsl.l = clamp01(hsl.l + wheel.luminance / 100 * 0.25 * weight)
  }
  return hslToRgb(hsl)
}

function sampleLut(channels: [number, number, number], lut: ColorLut): [number, number, number] {
  const coordinates = channels.map((value, index) => clamp(
    ((value - lut.domainMin[index]) / (lut.domainMax[index] - lut.domainMin[index])) * (lut.size - 1),
    0,
    lut.size - 1,
  ))
  const low = coordinates.map(Math.floor)
  const high = coordinates.map((value, index) => Math.min(lut.size - 1, low[index] + 1))
  const fraction = coordinates.map((value, index) => value - low[index])
  const result: [number, number, number] = [0, 0, 0]

  for (let ri = 0; ri <= 1; ri++) {
    for (let gi = 0; gi <= 1; gi++) {
      for (let bi = 0; bi <= 1; bi++) {
        const r = ri ? high[0] : low[0]
        const g = gi ? high[1] : low[1]
        const b = bi ? high[2] : low[2]
        const weight = (ri ? fraction[0] : 1 - fraction[0])
          * (gi ? fraction[1] : 1 - fraction[1])
          * (bi ? fraction[2] : 1 - fraction[2])
        const offset = (b * lut.size * lut.size + g * lut.size + r) * 3
        result[0] += lut.data[offset] * weight
        result[1] += lut.data[offset + 1] * weight
        result[2] += lut.data[offset + 2] * weight
      }
    }
  }
  return result
}

function getWhiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  const target = kelvinRgb(clamp(temperature, 2000, 12000))
  const reference = kelvinRgb(6500)
  const redGain = (target[0] / target[1]) / (reference[0] / reference[1])
  const blueGain = (target[2] / target[1]) / (reference[2] / reference[1])
  const magenta = clamp(tint, -100, 100) / 100
  return [redGain * (1 + magenta * 0.16), 1 - magenta * 0.22, blueGain * (1 + magenta * 0.16)]
}

function kelvinRgb(kelvin: number): [number, number, number] {
  const temperature = kelvin / 100
  let red: number
  let green: number
  let blue: number
  if (temperature <= 66) {
    red = 255
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307
  } else {
    red = 329.698727446 * (temperature - 60) ** -0.1332047592
    green = 288.1221695283 * (temperature - 60) ** -0.0755148492
    blue = 255
  }
  const max = Math.max(1, red, green, blue)
  return [red / max, green / max, blue / max]
}

function decodeSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function encodeSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
  }
  return { h: wrapHue(h), s, l }
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const segment = h / 60
  const x = chroma * (1 - Math.abs(segment % 2 - 1))
  let rgb: [number, number, number]
  if (segment < 1) rgb = [chroma, x, 0]
  else if (segment < 2) rgb = [x, chroma, 0]
  else if (segment < 3) rgb = [0, chroma, x]
  else if (segment < 4) rgb = [0, x, chroma]
  else if (segment < 5) rgb = [x, 0, chroma]
  else rgb = [chroma, 0, x]
  const match = l - chroma / 2
  return rgb.map((value) => clamp01(value + match)) as [number, number, number]
}

function hueWeight(hue: number, center: number): number {
  const distance = Math.abs(((hue - center + 540) % 360) - 180)
  return 1 - smoothstep(15, 48, distance)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
