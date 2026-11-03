import type {
  ColorAssistantHistoryOutcome,
  ColorAssistantHistoryRecord,
} from '../types'
import type { ColorAdjustments, ColorChannel, CurvePoint } from './colorGrading'
import type { ColorAssistantProposal } from './colorAssistant'
import { COLOR_ASSISTANT_ALLOWED_PATHS } from './colorAssistant'

const COLOR_CHANNELS: readonly ColorChannel[] = ['master', 'red', 'green', 'blue']
const OUTCOMES: readonly ColorAssistantHistoryOutcome[] = ['pending', 'applied', 'discarded', 'expired']

export function createColorAssistantHistoryRecord(input: {
  id: string
  sourceImageId: string
  activeImageId: string
  instruction: string
  baseAdjustments: ColorAdjustments
  proposal: ColorAssistantProposal
  createdAt?: number
}): ColorAssistantHistoryRecord {
  const record: ColorAssistantHistoryRecord = {
    id: input.id,
    sourceImageId: input.sourceImageId,
    activeImageId: input.activeImageId,
    instruction: input.instruction.trim(),
    explanation: input.proposal.explanation,
    clarification: input.proposal.clarification,
    createdAt: input.createdAt ?? Date.now(),
    outcome: 'pending',
    changes: input.proposal.changes.map(({ path, value }) => {
      const before = readPath(input.baseAdjustments, path)
      if (!COLOR_ASSISTANT_ALLOWED_PATHS.includes(path) || typeof before !== 'number') {
        throw new Error('调色历史包含无效参数路径')
      }
      return { path, before, after: value }
    }),
    curves: input.proposal.curves.map(({ channel, points }) => ({
      channel,
      before: clonePoints(input.baseAdjustments.curves[channel]),
      after: clonePoints(points),
    })),
  }
  return normalizeColorAssistantHistoryRecord(record)
}

export function decideColorAssistantHistoryRecord(
  record: ColorAssistantHistoryRecord,
  outcome: Exclude<ColorAssistantHistoryOutcome, 'pending'>,
  decidedAt = Date.now(),
): ColorAssistantHistoryRecord {
  if (record.outcome !== 'pending') throw new Error('这条调色建议已经处理')
  return normalizeColorAssistantHistoryRecord({ ...record, outcome, decidedAt })
}

export function normalizeColorAssistantHistoryRecord(input: unknown): ColorAssistantHistoryRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('调色历史记录格式无效')
  const value = input as Record<string, unknown>
  const stringField = (key: string) => {
    const field = value[key]
    if (typeof field !== 'string') throw new Error('调色历史记录格式无效')
    return field
  }
  const createdAt = finiteTimestamp(value.createdAt)
  const decidedAt = value.decidedAt === undefined ? undefined : finiteTimestamp(value.decidedAt)
  if (createdAt <= 0 || (decidedAt !== undefined && decidedAt <= 0)) throw new Error('调色历史时间无效')
  const outcome = value.outcome
  if (!OUTCOMES.includes(outcome as ColorAssistantHistoryOutcome)) throw new Error('调色历史状态无效')
  if ((outcome === 'pending') !== (decidedAt === undefined)) throw new Error('调色历史决策时间无效')
  if (!Array.isArray(value.changes) || value.changes.length > 48 || !Array.isArray(value.curves) || value.curves.length > 4) {
    throw new Error('调色历史调整格式无效')
  }

  const seenPaths = new Set<string>()
  const changes = value.changes.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('调色历史参数格式无效')
    const change = item as Record<string, unknown>
    const path = change.path
    if (typeof path !== 'string' || !COLOR_ASSISTANT_ALLOWED_PATHS.includes(path) || seenPaths.has(path)) {
      throw new Error('调色历史参数路径无效')
    }
    seenPaths.add(path)
    return { path, before: finiteNumber(change.before), after: finiteNumber(change.after) }
  })

  const seenChannels = new Set<ColorChannel>()
  const curves = value.curves.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('调色历史曲线格式无效')
    const curve = item as Record<string, unknown>
    const channel = curve.channel
    if (!COLOR_CHANNELS.includes(channel as ColorChannel) || seenChannels.has(channel as ColorChannel)) {
      throw new Error('调色历史曲线通道无效')
    }
    seenChannels.add(channel as ColorChannel)
    return {
      channel: channel as ColorChannel,
      before: normalizePoints(curve.before),
      after: normalizePoints(curve.after),
    }
  })

  const clarification = value.clarification
  if (clarification !== undefined && clarification !== null && typeof clarification !== 'string') {
    throw new Error('调色历史澄清内容无效')
  }
  const instruction = stringField('instruction').trim()
  const explanation = stringField('explanation')
  const id = stringField('id')
  const sourceImageId = stringField('sourceImageId')
  const activeImageId = stringField('activeImageId')
  if (!id || !sourceImageId || !activeImageId || !instruction || !explanation || explanation.length > 500
    || (typeof clarification === 'string' && clarification.length > 500)) {
    throw new Error('调色历史记录缺少必要内容')
  }

  return {
    id,
    sourceImageId,
    activeImageId,
    instruction,
    explanation,
    ...(clarification === undefined ? {} : { clarification }),
    createdAt,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    outcome: outcome as ColorAssistantHistoryOutcome,
    changes,
    curves,
  }
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function finiteTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('调色历史时间无效')
  return value
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('调色历史参数值无效')
  return value
}

function clonePoints(points: CurvePoint[]): CurvePoint[] {
  const source = points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  return source.map(({ x, y }) => ({ x, y }))
}

function normalizePoints(value: unknown): CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) throw new Error('调色历史曲线点数无效')
  const points = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('调色历史曲线点格式无效')
    const point = item as Record<string, unknown>
    const x = finiteNumber(point.x)
    const y = finiteNumber(point.y)
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error('调色历史曲线点超出范围')
    return { x, y }
  })
  for (let index = 1; index < points.length; index++) {
    if (points[index - 1].x >= points[index].x) throw new Error('调色历史曲线横坐标必须严格递增')
  }
  return points
}
