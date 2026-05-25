import { describe, expect, it } from 'vitest'
import { getGeminiOutputPixels, normalizeGeminiAspectRatio } from './geminiImageSizing'

describe('geminiImageSizing', () => {
  it('returns official output pixels', () => {
    expect(getGeminiOutputPixels('16:9', '4K')).toBe('5504x3072')
    expect(getGeminiOutputPixels('1:1', '1K')).toBe('1024x1024')
  })

  it('normalizes pixel sizes to the closest supported Gemini aspect ratio', () => {
    expect(normalizeGeminiAspectRatio('2480x3312')).toBe('3:4')
    expect(normalizeGeminiAspectRatio('2352x3520')).toBe('2:3')
    expect(normalizeGeminiAspectRatio('3000x1700')).toBe('16:9')
    expect(normalizeGeminiAspectRatio('1024x1024')).toBe('1:1')
    expect(normalizeGeminiAspectRatio('bad-value')).toBe('1:1')
  })
})
