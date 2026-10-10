import { describe, expect, it } from 'vitest'
import {
  normalizeVideoParams,
  fallbackVideoMode,
  estimateVideoCredits,
  getVideoModelDefinition,
  getAllVideoModels,
  getVideoModelPriceLabel,
  type VideoMode,
} from './videoModels'

describe('normalizeVideoParams', () => {
  it('registers Wan with URL references, no tail frames, and explicit defaults', () => {
    expect(getVideoModelDefinition('wan3.0-video-720p')).toMatchObject({
      displayName: 'Wan 3.0 Video', model: 'wan3.0-video-720p',
      adapter: 'wan', resolutions: ['720p'], fixedQuantity: 1, pollIntervalSeconds: 15,
      modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 10, maxVideos: 5, maxAudios: 5, maxRefMediaSeconds: 15 } },
      duration: { min: 4, max: 30, step: 1, default: 8 }, maxOutputSecondsWithVideo: 15,
    })
    expect(getVideoModelDefinition('wan3.0-video-720p')?.modes.flf2v).toBeUndefined()
    expect(normalizeVideoParams({}, 'wan3.0-video-720p', 't2v')).toMatchObject({ duration: 8, resolution: '720p', aspectRatio: '16:9', n: 1 })
    expect(getVideoModelPriceLabel('wan3.0-video-720p')).toBe('5 积分/秒')
  })
  it.each([['sd2.0-15s', 15], ['sd2.5-30s', 30]] as const)('registers %s with its fixed duration and image reference limits', (model, seconds) => {
    const definition = getVideoModelDefinition(model)
    expect(definition).toMatchObject({
      model, displayName: model, adapter: 'sd',
      duration: { min: seconds, max: seconds, default: seconds },
      modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 30 } },
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      fixedQuantity: 1, requiresProxy: true, supportsSeed: false, supportsNegativePrompt: false,
      imageMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
      maxImageBytes: 15 * 1024 * 1024, pollIntervalSeconds: 15,
    })
    expect(definition?.modes.flf2v).toBeUndefined()
    expect(getAllVideoModels().filter((item) => item.model === model)).toHaveLength(1)
    expect(normalizeVideoParams({}, model, 't2v')).toEqual({ duration: seconds, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 })
    expect(normalizeVideoParams({ duration: 5, resolution: '1080p', aspectRatio: '21:9', n: 4, seed: 3, negativePrompt: 'bad' }, model, 'ref2v')).toEqual({ duration: seconds, resolution: '1080p', aspectRatio: '21:9', audio: false, n: 1 })
    expect(normalizeVideoParams({ duration: 99, resolution: '2k', aspectRatio: 'auto', n: 2 }, model, 't2v')).toEqual({ duration: seconds, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1 })
  })
  it('registers Omni image capabilities and fixed defaults without tail frames', () => {
    expect(getVideoModelDefinition('gemini-omni-flash-10s')).toMatchObject({
      model: 'gemini-omni-flash-10s', displayName: 'gemini-omni-flash-10s', adapter: 'omni', logo: 'gemini',
      modes: { t2v: {}, i2v: { maxImages: 1 }, ref2v: { maxImages: 7 } },
      duration: { min: 10, max: 10, default: 10 }, resolutions: ['720p'], aspectRatios: ['16:9', '9:16'],
      fixedQuantity: 1, supportsSeed: false, supportsNegativePrompt: false,
    })
    expect(getVideoModelDefinition('gemini-omni-flash-10s')?.modes.flf2v).toBeUndefined()
    expect(normalizeVideoParams({ duration: 4, resolution: '2k', aspectRatio: 'auto', n: 4, seed: 42, negativePrompt: 'bad' }, 'gemini-omni-flash-10s', 't2v')).toEqual({
      duration: 10, resolution: '720p', aspectRatio: '16:9', audio: false, n: 1,
    })
  })
  it('registers Grok Imagine Video 1.5 with its supported capabilities', () => {
    const grok = getVideoModelDefinition('grok-imagine-video-1.5')
    expect(grok).toMatchObject({
      displayName: 'Grok Imagine Video 1.5',
      adapter: 'grok',
      duration: { min: 1, max: 15, default: 8 },
      resolutions: ['480p', '720p', '1080p'],
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      pricePerRequestCredits: 15,
    })
    expect(grok?.modes).toEqual({ t2v: {}, i2v: { maxImages: 1 } })
    expect(grok?.audio).toBe('none')
    expect(getAllVideoModels().some((model) => model.model === 'grok-imagine-video-1.5')).toBe(true)
  })

  it('normalizes Grok defaults and keeps quantity fixed at one', () => {
    expect(normalizeVideoParams({}, 'grok-imagine-video-1.5', 't2v')).toMatchObject({
      duration: 8,
      resolution: '480p',
      aspectRatio: '16:9',
      n: 1,
      audio: false,
    })
    expect(normalizeVideoParams({ duration: 99, n: 4 }, 'grok-imagine-video-1.5', 't2v')).toMatchObject({
      duration: 15,
      n: 1,
    })
  })

  it('uses the H3 7000 character prompt limit', () => {
    expect(getVideoModelDefinition('MiniMax-H3')?.maxPromptChars).toBe(7000)
  })
  it('clamps duration to model limits', () => {
    const result = normalizeVideoParams({ duration: 100 }, 'MiniMax-H3', 't2v')
    expect(result.duration).toBe(15)
  })

  it('uses default duration when not provided', () => {
    const result = normalizeVideoParams({}, 'MiniMax-H3', 't2v')
    expect(result.duration).toBe(4)
  })

  it('selects first resolution when provided resolution not supported', () => {
    const result = normalizeVideoParams({ resolution: '2k' }, 'MiniMax-H3', 't2v')
    expect(result.resolution).toBe('2k')
  })

  it('selects first aspect ratio when provided ratio not supported', () => {
    const result = normalizeVideoParams({ aspectRatio: '32:9' }, 'MiniMax-H3', 't2v')
    expect(result.aspectRatio).toBe('auto')
  })

  it('strips unsupported params', () => {
    const result = normalizeVideoParams(
      { seed: 42, negativePrompt: 'bad quality', cameraFixed: true },
      'MiniMax-H3',
      't2v',
    )
    expect(result.seed).toBeUndefined()
    expect(result.negativePrompt).toBeUndefined()
    expect(result.cameraFixed).toBeUndefined()
  })

  it('forces audio on for always-audio models', () => {
    const result = normalizeVideoParams({ audio: false }, 'MiniMax-H3', 't2v')
    expect(result.audio).toBe(true)
  })
})

describe('fallbackVideoMode', () => {
  it('returns same mode when supported', () => {
    expect(fallbackVideoMode('MiniMax-H3', 't2v')).toBe('t2v')
    expect(fallbackVideoMode('MiniMax-H3', 'i2v')).toBe('i2v')
  })

  it('falls back to t2v for unsupported modes', () => {
    expect(fallbackVideoMode('MiniMax-H3', 'ref2v')).toBe('ref2v')
  })

  it('returns t2v for unknown model', () => {
    expect(fallbackVideoMode('unknown-model', 'i2v')).toBe('t2v')
  })
})

describe('estimateVideoCredits', () => {
  it.each([
    ['gemini-omni-flash-10s', 10, 25],
    ['sd2.0-15s', 15, 20],
    ['sd2.5-30s', 30, 38],
  ] as const)('charges the confirmed flat price for %s across resolutions and reference counts', (model, seconds, credits) => {
    for (const resolution of getVideoModelDefinition(model)!.resolutions) {
      expect(estimateVideoCredits(model, seconds, resolution, 0, 0, 1)).toBe(credits)
      expect(estimateVideoCredits(model, seconds, resolution, 7, 0, 4)).toBe(credits)
      expect(getVideoModelPriceLabel(model, resolution)).toBe(`${credits} 积分/次`)
    }
  })
  it.each(['480p', '720p', '1080p'] as const)('charges 15 credits per Grok request at %s for every supported duration', (resolution) => {
    for (let duration = 1; duration <= 15; duration++) {
      expect(estimateVideoCredits('grok-imagine-video-1.5', duration, resolution, 0, 0, 1)).toBe(15)
      expect(estimateVideoCredits('grok-imagine-video-1.5', duration, resolution, 1, 0, 1)).toBe(15)
    }
  })

  it('uses the fixed Grok quantity even if a draft retains another model quantity', () => {
    expect(estimateVideoCredits('grok-imagine-video-1.5', 15, '1080p', 9, 30, 4)).toBe(15)
  })

  it.each([['768p', 2.5], ['2k', 5]] as const)('uses the confirmed H3 credit rate at %s for duration and quantity', (resolution, rate) => {
    for (const seconds of [4, 8, 15]) {
      for (const quantity of [1, 2, 4]) {
        expect(estimateVideoCredits('MiniMax-H3', seconds, resolution, 0, 0, quantity)).toBe(seconds * rate * quantity)
      }
    }
  })

  it.each([
    ['768p', 0, 0, 1, 10],
    ['768p', 5, 0, 1, 10],
    ['768p', 6, 0, 1, 10.625],
    ['768p', 7, 10, 1, 23.75],
    ['2k', 7, 10, 1, 46.25],
    ['768p', 7, 10, 2, 47.5],
    ['2k', 9, 4.5, 4, 135],
  ] as const)('includes H3 %s reference materials (%s images, %ss video, quantity %s)', (resolution, images, seconds, quantity, credits) => {
    expect(estimateVideoCredits('MiniMax-H3', 4, resolution, images, seconds, quantity)).toBe(credits)
  })

  it('multiplies by n', () => {
    const single = estimateVideoCredits('MiniMax-H3', 4, '768p', 0, 0, 1)
    const triple = estimateVideoCredits('MiniMax-H3', 4, '768p', 0, 0, 3)
    expect(triple).toBeCloseTo(single * 3, 0)
  })
})

describe('video model price labels', () => {
  it('shows the per-second credit rate for the selected H3 resolution', () => {
    expect(getVideoModelPriceLabel('MiniMax-H3', '768p')).toBe('2.5 积分/秒起')
    expect(getVideoModelPriceLabel('MiniMax-H3', '2k')).toBe('5 积分/秒起')
  })

  it('uses an option model default when the active model resolution is unsupported', () => {
    expect(getVideoModelPriceLabel('MiniMax-H3', '720p')).toBe('2.5 积分/秒起')
    expect(getVideoModelPriceLabel('grok-imagine-video-1.5', '2k')).toBe('15 积分/次')
    expect(getVideoModelPriceLabel('gemini-omni-flash-10s', '2k')).toBe('25 积分/次')
    expect(getVideoModelPriceLabel('sd2.0-15s', '768p')).toBe('20 积分/次')
    expect(getVideoModelPriceLabel('sd2.5-30s', '768p')).toBe('38 积分/次')
  })

  it('does not invent prices for unknown models', () => {
    expect(getVideoModelPriceLabel('unknown-model', '720p')).toBe('价格待配置')
  })
})
