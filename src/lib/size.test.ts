import { describe, expect, it } from 'vitest'
import { normalizeImageSize } from './size'

describe('size', () => {
  it('normalizes explicit dimensions to the requested maximum tier', () => {
    expect(normalizeImageSize('4096x4096', { maxTier: '2K' })).toBe('2048x2048')
    expect(normalizeImageSize('4096x4096')).toBe('2880x2880')
  })

  it('preserves the aspect ratio while reducing an oversized request', () => {
    const normalized = normalizeImageSize('4096x2048', { maxTier: '2K' })
    const [width, height] = normalized.split('x').map(Number)

    expect(width * height).toBeLessThanOrEqual(4_194_304)
    expect(Math.abs(width / height - 2) / 2).toBeLessThanOrEqual(0.01)
  })

  it('leaves auto and non-pixel sizes unchanged', () => {
    expect(normalizeImageSize('auto', { maxTier: '2K' })).toBe('auto')
    expect(normalizeImageSize('foo', { maxTier: '2K' })).toBe('foo')
  })
})
