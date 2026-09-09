import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('limits OpenAI output count to 10', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('limits fal.ai output count to 4', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(4)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, settings).n).toBe(4)
  })

  it('keeps OpenAI streaming output count so the request can disable streaming', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size).toBe('auto')
  })

  it('disables transparent output when format is not png', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'jpeg', transparent_output: true },
        settings,
      ).transparent_output,
    ).toBe(false)
  })

  it('normalizes Nano Banana Pro official T3 with Gemini-style aspect ratio and image size params', () => {
    const openAIProfile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      model: 'nano-banana-pro-official-t3',
    })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({
      ...DEFAULT_PARAMS,
      size: '3072x5504',
      geminiImageSize: '4K',
      transparent_output: true,
    }, settings)).toMatchObject({
      size: '3072x5504',
      geminiAspectRatio: '9:16',
      geminiImageSize: '4K',
      geminiOutputPixels: '3072x5504',
      transparent_output: false,
    })
  })

  it('limits Seedream explicit sizes to 2K while preserving other OpenAI model behavior', () => {
    const seedreamProfile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      model: 'seedream-5-pro',
      streamImages: false,
    })
    const seedreamSettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [seedreamProfile],
      activeProfileId: seedreamProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '4096x4096' }, seedreamSettings).size).toBe('2048x2048')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, seedreamSettings).size).toBe('2048x2048')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, seedreamSettings).size).toBe('auto')

    const seedreamRatioSize = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '4096x2048' }, seedreamSettings).size
    const [width, height] = seedreamRatioSize.split('x').map(Number)
    expect(width * height).toBeLessThanOrEqual(4_194_304)
    expect(Math.abs(width / height - 2) / 2).toBeLessThanOrEqual(0.01)

    const sunburstProfile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      model: 'gpt-image-2.5-sunburst',
      streamImages: false,
    })
    const sunburstSettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [sunburstProfile],
      activeProfileId: sunburstProfile.id,
    })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '4096x4096' }, sunburstSettings).size).toBe('2880x2880')

    const customProfile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      model: 'custom-image-model',
      streamImages: false,
    })
    const customSettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [customProfile],
      activeProfileId: customProfile.id,
    })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '4096x4096' }, customSettings).size).toBe('2880x2880')
  })
})
