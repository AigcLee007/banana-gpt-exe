import { describe, expect, it } from 'vitest'
import { BANANA_GALLERY_MODELS, getBananaModelCreditLabel } from './bananaModels'
import {
  IMAGE_MODEL_FAMILIES, getImageModelFamily, getImageModelSelectionLabel,
  getPreferredImageModel, parseImageModelLineMemory,
  rememberImageModelLine, positionImageModelPicker,
} from './imageModelSelection'

describe('image model families and lines', () => {
  it('includes every selectable request ID exactly once and excludes the hidden legacy route', () => {
    const ids = IMAGE_MODEL_FAMILIES.flatMap(family => family.lines.map(line => line.model))
    expect(ids.sort()).toEqual(BANANA_GALLERY_MODELS.map(line => line.model).sort())
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('gpt-5.5')
    expect(IMAGE_MODEL_FAMILIES).toHaveLength(7)
  })

  it('groups Nano Banana Pro routes and preserves distinct Nano Banana 2 and Lite models', () => {
    expect(getImageModelFamily('nano-banana-pro-official-t3')?.label).toBe('Nano Banana Pro')
    expect(getImageModelFamily('Nano Banana Pro')?.lines.map(line => line.model)).toEqual([
      'gemini-3-pro-image-preview', 'nano-banana-pro-official-t3', 'nano-banana-pro',
    ])
    expect(getImageModelFamily('gemini-3.1-flash-image-preview')?.id)
      .not.toBe(getImageModelFamily('gemini-3.1-flash-lite-image')?.id)
    expect(getImageModelFamily('gpt-image-2-official')?.lines.map(line => line.model)).toEqual([
      'gpt-image-2', 'gpt-image-2-official', 'gpt-image-2-svip',
    ])
  })

  it('keeps compact labels separate from prices and configured capability tags', () => {
    expect(getImageModelSelectionLabel('nano-banana-pro-official-t3')).toBe('Nano Banana Pro · 官方 T3')
    expect(getImageModelSelectionLabel('gemini-3-pro-image-preview')).toBe('Nano Banana Pro · 优惠')
    expect(getImageModelSelectionLabel('seedream-5-pro')).toBe('Seedream 5 Pro')
    expect(getImageModelSelectionLabel('unknown-model')).toBe('unknown-model')
    expect(getImageModelFamily('gpt-image-2.5-sunburst')?.lines[1].capabilities).toContain('支持 Max')
    expect(getImageModelFamily('seedream-5-pro')?.lines[0].capabilities).toContain('1K / 2K')
  })

  it.each([['1K', '6.2 💎'], ['2K', '7.5 💎'], ['4K', '8.7 💎']] as const)(
    'reuses configured T3 prices at %s without changing price formatting', (size, price) => {
      const t3 = getImageModelFamily('nano-banana-pro-official-t3')!.lines[1]
      expect(getBananaModelCreditLabel(t3.model, size)).toBe(price)
    },
  )
})

describe('per-family line memory', () => {
  it('restores a family line without allowing another family or stale IDs to override it', () => {
    const memory = rememberImageModelLine({}, 'nano-banana-pro-official-t3')
    const family = getImageModelFamily('gemini-3-pro-image-preview')!
    expect(getPreferredImageModel(family, memory)).toBe('nano-banana-pro-official-t3')
    expect(getPreferredImageModel(family, { [family.id]: 'gpt-image-2' })).toBe('gemini-3-pro-image-preview')
    expect(getPreferredImageModel(family, { [family.id]: 'removed-model' })).toBe('gemini-3-pro-image-preview')
    expect(rememberImageModelLine(memory, 'unknown')).toEqual(memory)
    expect(memory).toEqual({ [family.id]: 'nano-banana-pro-official-t3' })
  })

  it('validates persisted data and ignores malformed, stale and cross-family entries', () => {
    const family = getImageModelFamily('nano-banana-pro')!
    expect(parseImageModelLineMemory(JSON.stringify({ [family.id]: 'nano-banana-pro', unknown: 'fake' })))
      .toEqual({ [family.id]: 'nano-banana-pro' })
    for (const value of [null, '', '{', 'null', '[]', '42', '{"nano-banana-pro":"gpt-image-2"}']) {
      expect(parseImageModelLineMemory(value)).toEqual({})
    }
  })
})

describe('image picker viewport placement', () => {
  it('opens above a bottom composer within the desktop viewport', () => {
    const pos = positionImageModelPicker({ left: 100, top: 650, bottom: 684 }, 1200, 800)
    expect(pos.placement).toBe('top')
    expect(pos.top + pos.height).toBeLessThanOrEqual(642)
    expect(pos.width).toBe(560)
    expect(pos.left).toBeGreaterThanOrEqual(8)
  })

  it('keeps narrow and short viewport panels inside all screen edges', () => {
    for (const [width, height] of [[375, 812], [320, 300], [900, 240]]) {
      const pos = positionImageModelPicker({ left: width - 80, top: height - 80, bottom: height - 48 }, width, height)
      expect(pos.left).toBeGreaterThanOrEqual(8)
      expect(pos.top).toBeGreaterThanOrEqual(8)
      expect(pos.left + pos.width).toBeLessThanOrEqual(width - 8)
      expect(pos.top + pos.height).toBeLessThanOrEqual(height - 8)
    }
  })
})
