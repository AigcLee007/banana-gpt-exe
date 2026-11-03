import { describe, expect, it } from 'vitest'
import {
  computeColorHistogram,
  createDefaultColorAdjustments,
  getNeutralWhiteBalance,
  parseCubeLut,
  processColorPixels,
} from './colorGrading'

describe('color grading pixel pipeline', () => {
  it('keeps the input pixels and alpha unchanged with default adjustments', () => {
    const source = new Uint8ClampedArray([0, 64, 128, 17, 255, 240, 32, 99])
    const original = [...source]

    const result = processColorPixels(source, 2, 1, createDefaultColorAdjustments())

    expect([...result]).toEqual(original)
    expect([...source]).toEqual(original)
  })

  it('maps level input black and white points into output range', () => {
    const source = new Uint8ClampedArray([64, 0, 0, 255, 128, 0, 0, 255, 192, 0, 0, 255])
    const adjustments = createDefaultColorAdjustments()
    adjustments.levels.red = { inputBlack: 64, inputWhite: 192, gamma: 1, outputBlack: 0, outputWhite: 255 }

    const result = processColorPixels(source, 3, 1, adjustments)

    expect([result[0], result[4], result[8]]).toEqual([0, 128, 255])
  })

  it('applies exposure in linear light and white balance only after explicit values change', () => {
    const source = new Uint8ClampedArray([128, 128, 128, 255])
    const exposed = createDefaultColorAdjustments()
    exposed.basic.exposure = 1
    const warm = createDefaultColorAdjustments()
    warm.whiteBalance.temperature = 3000

    const brighter = processColorPixels(source, 1, 1, exposed)
    const warmer = processColorPixels(source, 1, 1, warm)

    expect(brighter[0]).toBeGreaterThan(170)
    expect(brighter[0]).toBeLessThan(190)
    expect(warmer[0]).toBeGreaterThan(warmer[2])
  })

  it('preserves hidden RGB values of transparent pixels in the fast adjustment path', () => {
    const source = new Uint8ClampedArray([120, 80, 40, 0])
    const adjustments = createDefaultColorAdjustments()
    adjustments.basic.exposure = 1

    expect([...processColorPixels(source, 1, 1, adjustments)]).toEqual([120, 80, 40, 0])
  })

  it('reduces global saturation without shifting hue or lightness', () => {
    const adjustments = createDefaultColorAdjustments()
    adjustments.basic.saturation = -50
    const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 40, 40, 40, 255])

    const result = processColorPixels(source, 3, 1, adjustments)

    expect([...result]).toEqual([191, 64, 64, 255, 64, 64, 191, 255, 40, 40, 40, 255])
  })

  it('calculates white balance only from an explicitly supplied neutral sample', () => {
    const sample: [number, number, number] = [190, 135, 125]
    const whiteBalance = getNeutralWhiteBalance(sample)
    const adjustments = createDefaultColorAdjustments()
    adjustments.whiteBalance = whiteBalance
    const result = processColorPixels(new Uint8ClampedArray([...sample, 255]), 1, 1, adjustments)

    expect(whiteBalance.temperature).toBeGreaterThan(6500)
    expect(whiteBalance.neutralGains).toHaveLength(3)
    expect(Math.max(result[0], result[1], result[2]) - Math.min(result[0], result[1], result[2])).toBeLessThanOrEqual(2)
  })

  it('rejects a black pixel as a manually selected white-balance sample', () => {
    expect(() => getNeutralWhiteBalance([0, 0, 0])).toThrow('非纯黑')
  })

  it('applies a red-channel curve without changing green, blue, or alpha', () => {
    const source = new Uint8ClampedArray([128, 60, 20, 180])
    const adjustments = createDefaultColorAdjustments()
    adjustments.curves.red = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }]

    const result = processColorPixels(source, 1, 1, adjustments)

    expect([...result]).toEqual([255, 60, 20, 180])
  })

  it('applies channel mixing independently per output channel', () => {
    const source = new Uint8ClampedArray([50, 150, 200, 255])
    const adjustments = createDefaultColorAdjustments()
    adjustments.channelMixer.red = [0, 100, 0]

    expect([...processColorPixels(source, 1, 1, adjustments)]).toEqual([150, 150, 200, 255])
  })

  it('changes hue in the selected HSL range while preserving alpha', () => {
    const source = new Uint8ClampedArray([255, 0, 0, 73])
    const adjustments = createDefaultColorAdjustments()
    adjustments.hsl.red = { hue: 60, saturation: 0, luminance: 0 }

    const result = processColorPixels(source, 1, 1, adjustments)

    expect(result[0]).toBeGreaterThan(245)
    expect(result[1]).toBeGreaterThan(245)
    expect(result[2]).toBeLessThan(10)
    expect(result[3]).toBe(73)
  })

  it('parses a .cube LUT and applies trilinear identity sampling', () => {
    const lut = parseCubeLut([
      'TITLE "identity"',
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 1 1 1',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n'))
    const adjustments = createDefaultColorAdjustments()
    adjustments.lut = lut

    const result = processColorPixels(new Uint8ClampedArray([50, 127, 220, 128]), 1, 1, adjustments)

    expect([...result]).toEqual([50, 127, 220, 128])
    expect(lut.size).toBe(2)
  })

  it('applies non-identity 3D LUT output values', () => {
    const lut = parseCubeLut([
      'LUT_3D_SIZE 2',
      '1 0 0', '0 0 0',
      '1 1 0', '0 1 0',
      '1 0 1', '0 0 1',
      '1 1 1', '0 1 1',
    ].join('\n'))
    const adjustments = createDefaultColorAdjustments()
    adjustments.lut = lut

    expect([...processColorPixels(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1, adjustments)]).toEqual([255, 0, 0, 255])
  })

  it('rejects invalid and oversized .cube files', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 1\n0 0 0')).toThrow('LUT')
    expect(() => parseCubeLut(`LUT_3D_SIZE 65\n${'0 0 0\n'.repeat(8)}`)).toThrow('LUT')
    expect(() => parseCubeLut('LUT_3D_SIZE 2\nDOMAIN_MIN 0 NaN 0\nDOMAIN_MAX 1 1 1\n' + '0 0 0\n'.repeat(8))).toThrow('LUT')
  })

  it('rejects pixel buffers whose dimensions do not match', () => {
    expect(() => processColorPixels(new Uint8ClampedArray(4), 2, 1, createDefaultColorAdjustments())).toThrow('图片像素')
  })
})

describe('color histogram', () => {
  it('counts visible pixels by channel and ignores transparent pixels', () => {
    const histogram = computeColorHistogram(new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 200, 30, 0,
      255, 20, 30, 128,
    ]), 3, 1)

    expect(histogram.red[10]).toBe(1)
    expect(histogram.red[255]).toBe(1)
    expect(histogram.green[20]).toBe(2)
    expect(histogram.blue[30]).toBe(2)
    expect(histogram.maxCount).toBe(2)
  })
})
