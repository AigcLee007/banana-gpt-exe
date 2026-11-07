import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiProfile, type TaskParams, type CustomProviderDefinition } from '../types'
import { callImageApi } from './api'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { BANANA_GALLERY_MODELS, getBananaModelRoute, getBananaSupportedSizeTiers } from './bananaModels'
import { getImageModelFamily } from './imageModelSelection'
import { normalizeImageSize } from './size'
import { MIME_MAP, pickActualParams } from './imageApiShared'
import { normalizeParamsForSettings } from './paramCompatibility'

function settings(patch: Partial<ApiProfile> = {}) {
  const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', model: 'gpt-image-2.6-sunburst-1k', streamImages: false, ...patch })
  return normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
}
function params(patch: Record<string, unknown> = {}): TaskParams {
  return { ...DEFAULT_PARAMS, complexity: 'auto', frame_count: 9, frame_duration_ms: 200, ...patch } as TaskParams
}
function responseMock(responses = false) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(responses
    ? { output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }] }
    : { data: [{ b64_json: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } }))
}
afterEach(() => vi.restoreAllMocks())

describe('GPT Image 2.6 integration', () => {
  it.each(['sunburst', 'flare'])('provides special offer and 1K animation lines for %s', variant => {
    const model = `gpt-image-2.6-${variant}`
    expect(getImageModelFamily(model)?.lines.map(line => [line.model, line.label])).toEqual([
      [model, '优质特价线路'], [model + '-1k', '1K动图线路'],
    ])
    expect(getBananaSupportedSizeTiers(model + '-1k')).toEqual(['1K'])
  })
  it.each(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2', 'seedream-5-pro'])('clears hidden format and complexity on %s', model => {
    expect(normalizeParamsForSettings(params({ output_format: 'webp', complexity: 'high' }), settings({ model })))
      .toMatchObject({ output_format: 'png', complexity: 'auto', output_compression: null })
  })
  it.each(['sunburst', 'flare'])('caps %s animation requests at 1K including Responses profiles', variant => {
    const model = `gpt-image-2.6-${variant}-1k`
    for (const profile of [{ model }, { apiMode: 'responses' as const, model: 'gpt-6.1-sol', imageGenerationModel: model }]) {
      expect(normalizeParamsForSettings(params({ size: '4096x2048', output_format: 'gif', complexity: 'high' }), settings(profile)))
        .toMatchObject({ size: normalizeImageSize('4096x2048', { maxTier: '1K' }), output_format: 'gif', complexity: 'high' })
      expect(normalizeParamsForSettings(params({ size: 'auto' }), settings(profile)).size).toBe('1024x1024')
    }
  })
  it.each(['sunburst', 'flare'])('registers %s on the Images API route', variant => {
    const id = `gpt-image-2.6-${variant}`
    expect(BANANA_GALLERY_MODELS.some(item => item.model === id)).toBe(true)
    expect(getBananaModelRoute(id)).toBe('openai-images')
  })
  it('preserves GIF and complexity for 2.6 and drops them for older models', () => {
    const value = params({ output_format: 'gif', complexity: 'high' })
    expect(normalizeParamsForSettings(value, settings())).toMatchObject({ output_format: 'gif', complexity: 'high' })
    expect(normalizeParamsForSettings(value, settings({ model: 'gpt-image-2.5-flare' }))).toMatchObject({ output_format: 'png', complexity: 'auto' })
  })
  it('clamps GIF parameters', () => {
    expect(normalizeParamsForSettings(params({ frame_count: 99, frame_duration_ms: -2 }), settings()))
      .toMatchObject({ frame_count: 16, frame_duration_ms: 20 })
  })
  it.each(['gif', 'svg'])('sends %s without streaming and preserves its MIME', async format => {
    const fetchMock = responseMock()
    const result = await callImageApi({ settings: settings({ streamImages: true }), prompt: 'test', params: params({ output_format: format, complexity: 'high', frame_count: 4, frame_duration_ms: 120 }), inputImageDataUrls: [] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ output_format: format, complexity: 'high' })
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('partial_images')
    if (format === 'gif') expect(body).toMatchObject({ frame_count: 4, frame_duration_ms: 120 })
    else expect(body.svg).toEqual({ model: 'gpt-6.1-sol' })
    expect(result.images[0]).toMatch(format === 'gif' ? /^data:image\/gif;/ : /^data:image\/svg\+xml;/)
  })
  it('sends GIF frame parameters in multipart edits', async () => {
    const fetchMock = responseMock()
    await callImageApi({ settings: settings(), prompt: 'test', params: params({ output_format: 'gif', complexity: 'medium', frame_count: 5 }), inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='] })
    const form = fetchMock.mock.calls.find(([, init]) => init?.body instanceof FormData)?.[1]?.body as FormData
    expect(form.get('output_format')).toBe('gif')
    expect(form.get('complexity')).toBe('medium')
    expect(form.get('frame_count')).toBe('5')
    expect(form.get('frame_duration_ms')).toBe('200')
  })
  it('sends GIF parameters on the Responses image tool', async () => {
    const fetchMock = responseMock(true)
    await callImageApi({ settings: settings({ apiMode: 'responses', model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.6-flare-1k', streamImages: true }), prompt: 'test', params: params({ output_format: 'gif', complexity: 'low' }), inputImageDataUrls: [] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.tools[0]).toMatchObject({ model: 'gpt-image-2.6-flare-1k', output_format: 'gif', complexity: 'low', frame_count: 9 })
    expect(body).not.toHaveProperty('stream')
  })
  it('retains returned format and animation parameters', () => {
    expect(MIME_MAP.svg).toBe('image/svg+xml')
    expect(pickActualParams({ output_format: 'gif', complexity: 'high', frame_count: 5, frame_duration_ms: 300 }))
      .toMatchObject({ output_format: 'gif', complexity: 'high', frame_count: 5, frame_duration_ms: 300 })
  })
  it('sends only native transparency and applicable GIF fields', async () => {
    const fetchMock = responseMock()
    await callImageApi({ settings: settings(), prompt: 'test', params: params({ output_format: 'gif' }), inputImageDataUrls: [], nativeTransparentBackground: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.background).toBe('transparent')
    expect(body).not.toHaveProperty('complexity')
    expect(body).not.toHaveProperty('svg')
    expect(body).not.toHaveProperty('output_compression')
  })
  it('respects Agent, reference and fal format restrictions', () => {
    expect(normalizeParamsForSettings(params({ output_format: 'svg' }), settings(), { hasInputImages: true }).output_format).toBe('png')
    expect(normalizeParamsForSettings(params({ output_format: 'gif' }), settings(), { agent: true }).output_format).toBe('png')
    expect(normalizeParamsForSettings(params({ output_format: 'svg', quality: 'max' }), settings({ provider: 'fal', model: 'openai/gpt-image-2.6/sunburst' })))
      .toMatchObject({ output_format: 'png', quality: 'high' })
  })
})

function customSettings(contentType: 'json' | 'multipart') {
  const provider: CustomProviderDefinition = {
    id: 'custom-26', name: 'Custom',
    submit: {
      path: 'images/generations', method: 'POST', contentType,
      body: { model: '$profile.model', prompt: '$prompt', n: '$params.n', output_format: '$params.output_format', complexity: '$params.complexity', frame_count: '$params.frame_count', frame_duration_ms: '$params.frame_duration_ms', svg: '$params.svg', background: '$params.background' },
      result: { b64JsonPaths: ['data.*.b64_json'] },
    },
  }
  const profile = createDefaultOpenAIProfile({ provider: provider.id, apiKey: 'key', model: 'gpt-image-2.6-flare-1k', svgModel: 'gpt-6-luna' })
  return normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, customProviders: [provider] })
}

describe('GPT Image 2.6 custom templates', () => {
  it('splits SVG into single synchronous requests and fills the authoring model', async () => {
    const fetchMock = responseMock()
    const result = await callImageApi({ settings: customSettings('json'), prompt: 'test', params: params({ output_format: 'svg', n: 2 }), inputImageDataUrls: [] })
    expect(result.images).toHaveLength(2)
    expect(fetchMock.mock.calls).toHaveLength(2)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ n: 1, output_format: 'svg', svg: { model: 'gpt-6-luna' } })
      expect(body).not.toHaveProperty('frame_count')
      expect(body).not.toHaveProperty('complexity')
    }
  })
  it('JSON encodes the SVG object in multipart templates', async () => {
    const fetchMock = responseMock()
    await callImageApi({ settings: customSettings('multipart'), prompt: 'test', params: params({ output_format: 'svg' }), inputImageDataUrls: [] })
    const form = fetchMock.mock.calls[0][1]?.body as FormData
    expect(form.get('svg')).toBe(JSON.stringify({ model: 'gpt-6-luna' }))
  })
})
