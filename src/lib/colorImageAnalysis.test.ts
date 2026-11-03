import { describe, expect, it } from 'vitest'
import { analyzeImageColors } from './colorImageAnalysis'

function pixels(colors: Array<[number, number, number, number]>) {
  return new Uint8ClampedArray(colors.flat())
}

describe('analyzeImageColors', () => {
  it('reports channel percentiles and low-chroma Lab evidence for a red cast', () => {
    const data = pixels(Array.from({ length: 16 }, () => [192, 160, 160, 255]))

    const result = analyzeImageColors(data, 4, 4)

    expect(result.sampledPixels).toBe(16)
    expect(result.samplingStep).toBe(1)
    expect(result.channels.red.median).toBeGreaterThan(result.channels.green.median)
    expect(result.channels.red.p10).toBe(192)
    expect(result.channels.red.p90).toBe(192)
    expect(result.channels.red.clippedHighPercent).toBe(0)
    expect(result.lowChromaCandidates.sampleCount).toBe(16)
    expect(result.lowChromaCandidates.medianLab?.a).toBeGreaterThan(0)
  })

  it('reports neutral Lab values and balanced tonal distribution', () => {
    const data = pixels([
      ...Array.from({ length: 8 }, () => [0, 0, 0, 255] as [number, number, number, number]),
      ...Array.from({ length: 8 }, () => [128, 128, 128, 255] as [number, number, number, number]),
      ...Array.from({ length: 8 }, () => [255, 255, 255, 255] as [number, number, number, number]),
    ])

    const result = analyzeImageColors(data, 6, 4)

    expect(result.luminance.shadowPercent).toBeCloseTo(33.3, 1)
    expect(result.luminance.midtonePercent).toBeCloseTo(33.3, 1)
    expect(result.luminance.highlightPercent).toBeCloseTo(33.3, 1)
    expect(result.luminance.clippedBlackPercent).toBeCloseTo(33.3, 1)
    expect(result.luminance.clippedWhitePercent).toBeCloseTo(33.3, 1)
    expect(result.lowChromaCandidates.medianLab?.a).toBeCloseTo(0, 0)
    expect(result.lowChromaCandidates.medianLab?.b).toBeCloseTo(0, 0)
  })

  it('excludes transparent pixels and marks neutral evidence insufficient when sparse', () => {
    const data = pixels([
      [255, 0, 0, 0],
      [32, 48, 160, 255],
    ])

    const result = analyzeImageColors(data, 2, 1)

    expect(result.sampledPixels).toBe(1)
    expect(result.ignoredTransparentSamples).toBe(1)
    expect(result.channels.red.mean).toBe(32)
    expect(result.lowChromaCandidates.sampleCount).toBe(0)
    expect(result.lowChromaCandidates.medianLab).toBeNull()
  })

  it('caps analysis work with a deterministic grid sample', () => {
    const width = 768
    const height = 768
    const data = new Uint8ClampedArray(width * height * 4)
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 128
      data[offset + 1] = 128
      data[offset + 2] = 128
      data[offset + 3] = 255
    }

    const result = analyzeImageColors(data, width, height)

    expect(result.samplingStep).toBeGreaterThan(1)
    expect(result.sampledPixels).toBeLessThanOrEqual(50_000)
  })

  it('rejects buffers that do not match the requested image dimensions', () => {
    expect(() => analyzeImageColors(new Uint8ClampedArray(4), 2, 2)).toThrow('像素数据尺寸无效')
  })
})
