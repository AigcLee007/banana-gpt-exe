import { describe, expect, it } from 'vitest'
import { applyColorAssistantProposal, getColorAssistantChangeLabel } from './colorAssistant'
import { createDefaultColorAdjustments } from './colorGrading'

describe('applyColorAssistantProposal', () => {
  it('applies scalar and curve changes while preserving before and after recipes', () => {
    const base = createDefaultColorAdjustments()
    base.basic.exposure = -0.5
    base.curves.red = [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }]
    const before = structuredClone(base)
    const input = {
      explanation: '  Lift the exposure and soften the master curve.  ',
      changes: [{ path: 'basic.exposure', value: 1.25 }],
      curves: [{ channel: 'master', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] }],
      clarification: null,
    }

    const result = applyColorAssistantProposal(base, input)

    expect(base).toEqual(before)
    expect(base.basic.exposure).toBe(-0.5)
    expect(result.adjustments.basic.exposure).toBe(1.25)
    expect(result.adjustments.curves.master).toEqual(input.curves[0].points)
    expect(result.adjustments.curves.red).toEqual(before.curves.red)
    expect(result.proposal).toEqual({ ...input, explanation: input.explanation.trim() })
  })

  it('returns an unchanged normalized recipe for clarification-only output', () => {
    const base = createDefaultColorAdjustments()
    base.basic.contrast = 18
    const before = structuredClone(base)
    const input = {
      explanation: 'The image needs a more specific direction.',
      changes: [],
      curves: [],
      clarification: '  Should the shadows stay neutral?  ',
    }

    const result = applyColorAssistantProposal(base, input)

    expect(result.proposal).toEqual({ ...input, clarification: input.clarification.trim() })
    expect(result.adjustments).toEqual(before)
    expect(base).toEqual(before)
  })

  it.each([
    ['duplicate paths', { changes: [{ path: 'basic.exposure', value: 1 }, { path: 'basic.exposure', value: 2 }] }],
    ['unknown paths', { changes: [{ path: 'whiteBalance.neutralGains.0', value: 2 }] }],
    ['inherited object paths', { changes: [{ path: 'toString', value: 1 }] }],
    ['non-finite values', { changes: [{ path: 'basic.exposure', value: Number.NaN }] }],
    ['out-of-range values', { changes: [{ path: 'basic.exposure', value: 6 }] }],
    ['overlong clarification', { clarification: 'x'.repeat(501) }],
    ['level invariants', { changes: [{ path: 'levels.master.inputBlack', value: 200 }, { path: 'levels.master.inputWhite', value: 100 }] }],
    ['invalid curve channels', { curves: [{ channel: 'alpha', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }],
    ['duplicate curve channels', { curves: [
      { channel: 'red', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { channel: 'red', points: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }] },
    ] }],
    ['unsorted curve points', { curves: [{ channel: 'blue', points: [{ x: 0, y: 0 }, { x: 0.8, y: 0.8 }, { x: 0.5, y: 0.5 }] }] }],
    ['duplicate curve x values', { curves: [{ channel: 'green', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 }] }] }],
    ['more than 64 curve points', { curves: [{ channel: 'master', points: Array.from({ length: 65 }, (_, index) => ({ x: index / 64, y: index / 64 })) }] }],
  ])('rejects %s', (_name, overrides) => {
    const input = {
      explanation: 'Adjust the image.',
      changes: [],
      curves: [],
      clarification: null,
      ...overrides,
    }

    expect(() => applyColorAssistantProposal(createDefaultColorAdjustments(), input)).toThrow()
  })

  it('provides Chinese labels for supported scalar paths and curve channels', () => {
    for (const path of [
      'basic.exposure',
      'levels.master.gamma',
      'hsl.orange.hue',
      'colorGrading.shadows.saturation',
      'channelMixer.blue.2',
      'curve.master',
      'curve.red',
    ]) {
      expect(getColorAssistantChangeLabel(path)).toMatch(/[\u4e00-\u9fff]/)
    }
    expect(getColorAssistantChangeLabel('toString')).toBe('toString')
  })

  it('accepts every supported scalar path and labels each one in Chinese', () => {
    const channels = ['master', 'red', 'green', 'blue']
    const scalarPaths = [
      ...['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance']
        .map((property) => `basic.${property}`),
      'whiteBalance.temperature',
      'whiteBalance.tint',
      ...channels.flatMap((channel) => ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite']
        .map((property) => `levels.${channel}.${property}`)),
      ...['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']
        .flatMap((range) => ['hue', 'saturation', 'luminance'].map((property) => `hsl.${range}.${property}`)),
      'colorGrading.balance',
      'colorGrading.blending',
      ...['shadows', 'midtones', 'highlights']
        .flatMap((wheel) => ['hue', 'saturation', 'luminance'].map((property) => `colorGrading.${wheel}.${property}`)),
      ...['red', 'green', 'blue'].flatMap((channel) => [0, 1, 2].map((index) => `channelMixer.${channel}.${index}`)),
    ]

    for (const path of scalarPaths) {
      const value = path.endsWith('.inputBlack') || path.endsWith('.outputBlack') ? 10
        : path.endsWith('.inputWhite') || path.endsWith('.outputWhite') ? 240
          : path.endsWith('.gamma') ? 1.2
            : path === 'whiteBalance.temperature' ? 6501
              : 1
      expect(getColorAssistantChangeLabel(path)).toMatch(/[\u4e00-\u9fff]/)
      expect(() => applyColorAssistantProposal(createDefaultColorAdjustments(), {
        explanation: '',
        changes: [{ path, value }],
        curves: [],
        clarification: null,
      })).not.toThrow()
    }

    for (const channel of channels) {
      expect(getColorAssistantChangeLabel(`curve.${channel}`)).toMatch(/[\u4e00-\u9fff]/)
    }
  })

  it.each([
    ['missing top-level property', () => {
      const input = validProposal()
      delete input.clarification
      return input
    }],
    ['extra top-level property', () => ({ ...validProposal(), extra: true })],
    ['missing change property', () => ({ ...validProposal(), changes: [{ path: 'basic.exposure' }] })],
    ['extra change property', () => ({ ...validProposal(), changes: [{ path: 'basic.exposure', value: 1, extra: true }] })],
    ['missing curve property', () => ({ ...validProposal(), curves: [{ channel: 'master' }] })],
    ['extra curve property', () => ({ ...validProposal(), curves: [{ channel: 'master', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], extra: true }] })],
    ['missing point property', () => ({ ...validProposal(), curves: [{ channel: 'master', points: [{ x: 0 }, { x: 1, y: 1 }] }] })],
    ['extra point property', () => ({ ...validProposal(), curves: [{ channel: 'master', points: [{ x: 0, y: 0, extra: true }, { x: 1, y: 1 }] }] })],
  ])('rejects %s', (_name, createInput) => {
    expect(() => applyColorAssistantProposal(createDefaultColorAdjustments(), createInput())).toThrow()
  })
})

function validProposal(): Record<string, unknown> {
  return {
    explanation: 'Adjust the image.',
    changes: [],
    curves: [],
    clarification: null,
  }
}
