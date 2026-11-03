import { describe, expect, it } from 'vitest'
import { createDefaultColorAdjustments } from './colorGrading'
import { createColorAssistantHistoryRecord, decideColorAssistantHistoryRecord } from './colorAssistantHistory'

describe('color assistant history records', () => {
  it('captures only the exact scalar and curve differences for a pending round', () => {
    const before = createDefaultColorAdjustments()
    before.curves.red = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]
    const record = createColorAssistantHistoryRecord({
      id: 'round-1',
      sourceImageId: 'source-1',
      activeImageId: 'edited-2',
      instruction: '  去掉红色偏色  ',
      baseAdjustments: before,
      proposal: {
        explanation: '降低色温并调整红色曲线。',
        changes: [{ path: 'whiteBalance.temperature', value: 6100 }],
        curves: [{ channel: 'red', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.46 }, { x: 1, y: 1 }] }],
        clarification: '保持肤色自然。',
      },
      createdAt: 1_800_000_000_000,
    })

    expect(record).toEqual({
      id: 'round-1',
      sourceImageId: 'source-1',
      activeImageId: 'edited-2',
      instruction: '去掉红色偏色',
      explanation: '降低色温并调整红色曲线。',
      clarification: '保持肤色自然。',
      createdAt: 1_800_000_000_000,
      outcome: 'pending',
      changes: [{ path: 'whiteBalance.temperature', before: 6500, after: 6100 }],
      curves: [{
        channel: 'red',
        before: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
        after: [{ x: 0, y: 0 }, { x: 0.5, y: 0.46 }, { x: 1, y: 1 }],
      }],
    })

    before.curves.red[1].y = 0.9
    expect(record.curves[0].before[1].y).toBe(0.5)
  })

  it.each(['applied', 'discarded', 'expired'] as const)('records a %s decision once', (outcome) => {
    const pending = createColorAssistantHistoryRecord({
      id: `round-${outcome}`,
      sourceImageId: 'source-1',
      activeImageId: 'source-1',
      instruction: '调整明暗',
      baseAdjustments: createDefaultColorAdjustments(),
      proposal: { explanation: '调整明暗。', changes: [], curves: [], clarification: null },
      createdAt: 100,
    })

    const decided = decideColorAssistantHistoryRecord(pending, outcome, 200)
    expect(decided).toMatchObject({ outcome, createdAt: 100, decidedAt: 200 })
    expect(() => decideColorAssistantHistoryRecord(decided, 'discarded', 300)).toThrow('已经处理')
  })

  it('represents an empty base curve as its neutral identity curve', () => {
    const before = createDefaultColorAdjustments()
    before.curves.green = []
    const record = createColorAssistantHistoryRecord({
      id: 'empty-curve',
      sourceImageId: 'source-1',
      activeImageId: 'source-1',
      instruction: '微调绿色曲线',
      baseAdjustments: before,
      proposal: {
        explanation: '微调绿色曲线。',
        changes: [],
        curves: [{ channel: 'green', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
        clarification: null,
      },
      createdAt: 100,
    })

    expect(record.curves[0].before).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
  })
})
