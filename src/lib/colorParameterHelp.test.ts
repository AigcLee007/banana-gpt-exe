import { describe, expect, it } from 'vitest'
import { COLOR_PARAMETER_HELP, getColorParameterHelp } from './colorParameterHelp'

const DIRECTIONAL_KEYS = [
  'basic.exposure', 'basic.contrast', 'basic.highlights', 'basic.shadows', 'basic.whites', 'basic.blacks', 'basic.saturation', 'basic.vibrance',
  'whiteBalance.temperature', 'whiteBalance.tint',
  'levels.inputBlack', 'levels.inputWhite', 'levels.gamma', 'levels.outputBlack', 'levels.outputWhite',
  'hsl.hue', 'hsl.saturation', 'hsl.luminance',
  'colorGrading.hue', 'colorGrading.saturation', 'colorGrading.luminance', 'colorGrading.balance', 'colorGrading.blending',
  'channelMixer.contribution', 'export.quality',
] as const

describe('color parameter help catalog', () => {
  it.each(DIRECTIONAL_KEYS)('explains what %s affects and how raising or lowering it changes the image', (key) => {
    const description = getColorParameterHelp(key)
    expect(description.length).toBeGreaterThan(15)
    expect(description).toContain('调高')
    expect(description).toContain('调低')
  })

  it('includes custom surface explanations and selected-range context', () => {
    expect(Object.keys(COLOR_PARAMETER_HELP)).toEqual(expect.arrayContaining([
      'whiteBalance.neutralSampler', 'curves.points', 'colorGrading.wheelPicker', 'colorGrading.balance', 'lut',
    ]))
    expect(getColorParameterHelp('hsl.hue', '红色')).toContain('红色')
    expect(getColorParameterHelp('levels.gamma', '蓝色通道')).toContain('蓝色通道')
    expect(COLOR_PARAMETER_HELP['whiteBalance.neutralSampler']).toContain('点击')
    expect(COLOR_PARAMETER_HELP['curves.points']).toContain('向上')
    expect(COLOR_PARAMETER_HELP['colorGrading.wheelPicker']).toContain('中心')
    expect(COLOR_PARAMETER_HELP.lut).toContain('.cube')
  })
})
