import {
  normalizeColorAdjustments,
  type ColorAdjustments,
  type ColorChannel,
  type CurvePoint,
  type HueRange,
} from './colorGrading'

export interface ColorAssistantChange {
  path: string
  value: number
}

export interface ColorAssistantCurve {
  channel: ColorChannel
  points: CurvePoint[]
}

export interface ColorAssistantProposal {
  explanation: string
  changes: ColorAssistantChange[]
  curves: ColorAssistantCurve[]
  clarification: string | null
}

interface ScalarDefinition {
  min: number
  max: number
  label: string
}

const COLOR_CHANNELS: ColorChannel[] = ['master', 'red', 'green', 'blue']
const HUE_RANGES: HueRange[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']
const ADJUSTMENT_CHANNEL_LABELS: Record<ColorChannel, string> = {
  master: '主通道',
  red: '红通道',
  green: '绿通道',
  blue: '蓝通道',
}
const HUE_RANGE_LABELS: Record<HueRange, string> = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  cyan: '青色',
  blue: '蓝色',
  purple: '紫色',
  magenta: '洋红色',
}
const WHEEL_LABELS = { shadows: '阴影', midtones: '中间调', highlights: '高光' } as const
const MIXER_CHANNEL_LABELS = { red: '红色通道', green: '绿色通道', blue: '蓝色通道' } as const
const MIXER_SOURCE_LABELS = ['红色系数', '绿色系数', '蓝色系数'] as const
const LEVEL_PROPERTY_LABELS = {
  inputBlack: '输入黑场',
  inputWhite: '输入白场',
  gamma: '伽马',
  outputBlack: '输出黑场',
  outputWhite: '输出白场',
} as const
const HSL_PROPERTY_LABELS = { hue: '色相', saturation: '饱和度', luminance: '明度' } as const

const scalarDefinitions: Record<string, ScalarDefinition> = {
  'basic.exposure': { min: -5, max: 5, label: '曝光' },
  'basic.contrast': { min: -100, max: 100, label: '对比度' },
  'basic.highlights': { min: -100, max: 100, label: '基础高光' },
  'basic.shadows': { min: -100, max: 100, label: '基础阴影' },
  'basic.whites': { min: -100, max: 100, label: '白场' },
  'basic.blacks': { min: -100, max: 100, label: '黑场' },
  'basic.saturation': { min: -100, max: 100, label: '基础饱和度' },
  'basic.vibrance': { min: -100, max: 100, label: '自然饱和度' },
  'whiteBalance.temperature': { min: 2000, max: 12000, label: '色温' },
  'whiteBalance.tint': { min: -100, max: 100, label: '白平衡色调' },
  'colorGrading.balance': { min: -100, max: 100, label: '色轮平衡' },
  'colorGrading.blending': { min: 0, max: 100, label: '色轮混合' },
}

for (const channel of COLOR_CHANNELS) {
  const channelLabel = ADJUSTMENT_CHANNEL_LABELS[channel]
  for (const [property, label] of Object.entries(LEVEL_PROPERTY_LABELS)) {
    const ranges: Record<string, [number, number]> = {
      inputBlack: [0, 254],
      inputWhite: [1, 255],
      gamma: [0.01, 9.99],
      outputBlack: [0, 255],
      outputWhite: [0, 255],
    }
    const [min, max] = ranges[property]
    scalarDefinitions[`levels.${channel}.${property}`] = { min, max, label: `${channelLabel}${label}` }
  }
}

for (const range of HUE_RANGES) {
  for (const property of Object.keys(HSL_PROPERTY_LABELS) as Array<keyof typeof HSL_PROPERTY_LABELS>) {
    const bounds = property === 'hue' ? [-180, 180] : [-100, 100]
    scalarDefinitions[`hsl.${range}.${property}`] = {
      min: bounds[0],
      max: bounds[1],
      label: `HSL${HUE_RANGE_LABELS[range]}${HSL_PROPERTY_LABELS[property]}`,
    }
  }
}

for (const [wheel, wheelLabel] of Object.entries(WHEEL_LABELS) as Array<[keyof typeof WHEEL_LABELS, string]>) {
  for (const property of Object.keys(HSL_PROPERTY_LABELS) as Array<keyof typeof HSL_PROPERTY_LABELS>) {
    const bounds = property === 'hue' ? [-180, 180] : property === 'saturation' ? [0, 100] : [-100, 100]
    scalarDefinitions[`colorGrading.${wheel}.${property}`] = {
      min: bounds[0],
      max: bounds[1],
      label: `${wheelLabel}色轮${HSL_PROPERTY_LABELS[property]}`,
    }
  }
}

for (const channel of Object.keys(MIXER_CHANNEL_LABELS) as Array<keyof typeof MIXER_CHANNEL_LABELS>) {
  MIXER_SOURCE_LABELS.forEach((propertyLabel, index) => {
    scalarDefinitions[`channelMixer.${channel}.${index}`] = {
      min: -200,
      max: 200,
      label: `${MIXER_CHANNEL_LABELS[channel]}${propertyLabel}`,
    }
  })
}

export const COLOR_ASSISTANT_ALLOWED_PATHS: readonly string[] = Object.freeze(Object.keys(scalarDefinitions))

const curveLabels: Record<ColorChannel, string> = {
  master: '主曲线',
  red: '红色曲线',
  green: '绿色曲线',
  blue: '蓝色曲线',
}

export function applyColorAssistantProposal(base: ColorAdjustments, input: unknown): {
  proposal: ColorAssistantProposal
  adjustments: ColorAdjustments
} {
  const proposal = normalizeProposal(input)
  const candidate = structuredClone(base)
  for (const change of proposal.changes) setAdjustmentPath(candidate, change.path, change.value)
  for (const curve of proposal.curves) candidate.curves[curve.channel] = curve.points
  return { proposal, adjustments: normalizeColorAdjustments(candidate) }
}

export function getColorAssistantChangeLabel(path: string): string {
  if (Object.prototype.hasOwnProperty.call(scalarDefinitions, path)) return scalarDefinitions[path].label
  const curve = path.match(/^curve\.(master|red|green|blue)$/)
  if (curve) return curveLabels[curve[1] as ColorChannel]
  return path
}

function normalizeProposal(input: unknown): ColorAssistantProposal {
  const source = asRecord(input, '调色建议')
  requireExactKeys(source, ['explanation', 'changes', 'curves', 'clarification'], '调色建议')

  if (typeof source.explanation !== 'string') throw new Error('调色说明无效')
  const explanation = source.explanation.trim()
  if (explanation.length > 500) throw new Error('调色说明不能超过 500 个字符')
  if (!Array.isArray(source.changes) || source.changes.length > 48) throw new Error('调色变化数量无效')
  if (!Array.isArray(source.curves) || source.curves.length > 4) throw new Error('调色曲线数量无效')
  if (source.clarification !== null && typeof source.clarification !== 'string') throw new Error('澄清问题无效')
  const clarification = typeof source.clarification === 'string' ? source.clarification.trim() : null
  if (clarification !== null && clarification.length > 500) throw new Error('澄清问题不能超过 500 个字符')

  const paths = new Set<string>()
  const changes = source.changes.map((item) => {
    const change = asRecord(item, '调色变化')
    requireExactKeys(change, ['path', 'value'], '调色变化')
    if (typeof change.path !== 'string') throw new Error('调色路径无效')
    if (!COLOR_ASSISTANT_ALLOWED_PATHS.includes(change.path)) throw new Error(`不支持的调色路径: ${change.path}`)
    const definition = scalarDefinitions[change.path]
    if (paths.has(change.path)) throw new Error(`调色路径重复: ${change.path}`)
    paths.add(change.path)
    if (typeof change.value !== 'number' || !Number.isFinite(change.value)
      || change.value < definition.min || change.value > definition.max) {
      throw new Error(`${definition.label}超出范围`)
    }
    return { path: change.path, value: change.value }
  })

  const channels = new Set<ColorChannel>()
  const curves = source.curves.map((item) => {
    const curve = asRecord(item, '调色曲线')
    requireExactKeys(curve, ['channel', 'points'], '调色曲线')
    if (typeof curve.channel !== 'string' || !COLOR_CHANNELS.includes(curve.channel as ColorChannel)) {
      throw new Error('曲线通道无效')
    }
    const channel = curve.channel as ColorChannel
    if (channels.has(channel)) throw new Error(`曲线通道重复: ${channel}`)
    channels.add(channel)
    if (!Array.isArray(curve.points) || curve.points.length < 2 || curve.points.length > 64) {
      throw new Error('曲线点数量必须为 2 至 64')
    }
    const points = curve.points.map((item) => {
      const point = asRecord(item, '曲线点')
      requireExactKeys(point, ['x', 'y'], '曲线点')
      if (typeof point.x !== 'number' || !Number.isFinite(point.x) || point.x < 0 || point.x > 1
        || typeof point.y !== 'number' || !Number.isFinite(point.y) || point.y < 0 || point.y > 1) {
        throw new Error('曲线坐标必须是 0 至 1 之间的有限数值')
      }
      return { x: point.x, y: point.y }
    })
    for (let index = 1; index < points.length; index++) {
      if (points[index - 1].x >= points[index].x) throw new Error('曲线横坐标必须严格递增')
    }
    return { channel, points }
  })

  return {
    explanation,
    changes,
    curves,
    clarification,
  }
}

function setAdjustmentPath(adjustments: ColorAdjustments, path: string, value: number) {
  const segments = path.split('.')
  let parent: unknown = adjustments
  for (const segment of segments.slice(0, -1)) parent = readPathSegment(parent, segment)
  const last = segments[segments.length - 1]
  if (Array.isArray(parent)) parent[Number(last)] = value
  else if (parent && typeof parent === 'object') (parent as Record<string, unknown>)[last] = value
  else throw new Error(`无效的调色路径: ${path}`)
}

function readPathSegment(value: unknown, segment: string): unknown {
  if (!value || typeof value !== 'object') throw new Error('无效的调色路径')
  if (Array.isArray(value)) return value[Number(segment)]
  return (value as Record<string, unknown>)[segment]
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`)
  return value as Record<string, unknown>
}

function requireExactKeys(value: Record<string, unknown>, expected: string[], label: string) {
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${label}字段无效`)
  }
}
