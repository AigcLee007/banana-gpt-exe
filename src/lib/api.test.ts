import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi, queryApiKeyBalance } from './api'
import { getBananaModelByDisplayName, getBananaModelRoute, normalizeBananaModelId } from './bananaModels'

function createOpenAIImagesSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    apiKey: 'test-key',
    model: 'gpt-image-2',
    profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
      ...profile,
      apiKey: 'test-key',
      model: 'gpt-image-2',
      ...(overrides as Record<string, unknown>),
    })),
  }
}

function createOpenAIImagesSettingsWithModel(model: string, overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    apiKey: 'test-key',
    model,
    profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
      ...profile,
      apiKey: 'test-key',
      model,
      ...(overrides as Record<string, unknown>),
    })),
  }
}

function createOpenAIResponsesSettingsWithModel(model: string, overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    apiKey: 'test-key',
    apiMode: 'responses' as const,
    model,
    profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
      ...profile,
      apiKey: 'test-key',
      apiMode: 'responses' as const,
      model,
      ...(overrides as Record<string, unknown>),
    })),
  }
}

function createGeminiSettings(model: 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview', overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    apiKey: 'test-key',
    model,
    profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
      ...profile,
      apiKey: 'test-key',
      model,
      ...(overrides as Record<string, unknown>),
    })),
  }
}

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
    },
  )

  it('sends Gemini gallery payload with responseModalities and imageConfig fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createGeminiSettings('gemini-3-pro-image-preview'),
      prompt: 'prompt',
      params: {
        ...DEFAULT_PARAMS,
        geminiAspectRatio: '16:9',
        geminiImageSize: '4K',
        geminiOutputPixels: '5504x3072',
      },
      inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1beta/models/gemini-3-pro-image-preview:generateContent')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.generationConfig?.responseModalities).toEqual(['IMAGE'])
    expect(body.generationConfig?.imageConfig).toEqual({
      aspectRatio: '16:9',
      imageSize: '4K',
    })
    expect(body.contents?.[0]?.parts).toEqual([
      { text: 'prompt' },
      { inlineData: { mimeType: 'image/png', data: 'aW5wdXQ=' } },
    ])
    expect(body.generationConfig?.responseFormat).toBeUndefined()
    expect(body.size).toBeUndefined()
    expect(body.quality).toBeUndefined()
    expect(body.output_format).toBeUndefined()
    expect(body.outputFormat).toBeUndefined()
    expect(body.format).toBeUndefined()
    expect(body.compression).toBeUndefined()
    expect(body.moderation).toBeUndefined()
  })

  it('sends the selected 1:1 1K Gemini request spec without pixel size params', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createGeminiSettings('gemini-3.1-flash-image-preview'),
      prompt: 'prompt',
      params: {
        ...DEFAULT_PARAMS,
        geminiAspectRatio: '1:1',
        geminiImageSize: '1K',
        geminiOutputPixels: '1024x1024',
      },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.generationConfig?.responseModalities).toEqual(['IMAGE'])
    expect(body.generationConfig?.imageConfig).toEqual({
      aspectRatio: '1:1',
      imageSize: '1K',
    })
    expect(body.generationConfig?.responseFormat).toBeUndefined()
    expect(body.size).toBeUndefined()
  })

  it('normalizes Nano_Banana_Pro to gemini-3-pro-image-preview before calling Gemini endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createGeminiSettings('gemini-3-pro-image-preview', {
        model: 'Nano_Banana_Pro',
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          model: 'Nano_Banana_Pro',
        })),
      }),
      prompt: 'prompt',
      params: {
        ...DEFAULT_PARAMS,
        geminiAspectRatio: '16:9',
        geminiImageSize: '1K',
      },
      inputImageDataUrls: [],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1beta/models/gemini-3-pro-image-preview:generateContent')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBeUndefined()
  })

  it('splits Gemini native multi-image generation into parallel single-image requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createGeminiSettings('gemini-3-pro-image-preview'),
      prompt: 'prompt',
      params: {
        ...DEFAULT_PARAMS,
        n: 2,
        geminiAspectRatio: '16:9',
        geminiImageSize: '1K',
        geminiOutputPixels: '1376x768',
      },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/v1beta/models/gemini-3-pro-image-preview:generateContent'))).toBe(true)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.generationConfig?.imageConfig).toEqual({
        aspectRatio: '16:9',
        imageSize: '1K',
      })
      expect(body.n).toBeUndefined()
    }
    expect(result.images).toHaveLength(2)
    expect(result.actualParams?.n).toBe(2)
  })

  it('keeps GPT-Image-2 text-to-image on images generations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings(),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/images/generations')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('gpt-image-2')
    expect(body.size).toBe('auto')
    expect(body.generationConfig).toBeUndefined()
    expect(body.responseModalities).toBeUndefined()
    expect(body.imageConfig).toBeUndefined()
  })

  it('normalizes GPT-Image-2 output format to lowercase for generations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings(),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, output_format: 'PNG' as any },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.output_format).toBe('png')
  })

  it('splits GPT-Image-2 multi-image text generation into parallel single-image requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createOpenAIImagesSettings({ streamImages: false, codexCli: false }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/v1/images/generations'))).toBe(true)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.n).toBeUndefined()
    }
    expect(result.images).toHaveLength(3)
    expect(result.actualParams?.n).toBe(3)
  })

  it('keeps GPT-Image-2 reference images on images edits', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings(),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
    })

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/images/edits'))).toBe(true)
    const editCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/images/edits'))
    const formData = editCall?.[1] && (editCall[1] as RequestInit).body as FormData
    expect(formData?.get('model')).toBe('gpt-image-2')
    expect(formData?.get('output_format')).toBe('png')
    expect(formData?.get('size')).toBe('auto')
    expect(formData?.get('responseModalities')).toBeNull()
    expect(formData?.get('generationConfig')).toBeNull()
  })

  it('splits GPT-Image-2 multi-image edits into parallel single-image requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createOpenAIImagesSettings({ streamImages: false, codexCli: false }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
    })

    const editCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/images/edits'))
    expect(editCalls).toHaveLength(2)
    for (const [, init] of editCalls) {
      const body = (init as RequestInit).body
      expect(body).toBeInstanceOf(FormData)
      expect((body as FormData).get('n')).toBeNull()
    }
    expect(result.images).toHaveLength(2)
    expect(result.actualParams?.n).toBe(2)
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createOpenAIImagesSettings({ codexCli: true }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createOpenAIImagesSettings({ codexCli: true }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('streams Images API partial images and resolves the final completed image', async () => {
    const streamBody = [
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
      '',
      'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: createOpenAIImagesSettingsWithModel('test-image-model', {
        streamImages: true,
        streamPartialImages: 3,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      stream: true,
      partial_images: 3,
    })
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      }],
    })
  })

  it('does not expect revised prompts on official Images API stream completed events', async () => {
    const streamBody = [
      'data: {"created_at":1779112721,"type":"image_generation.completed","b64_json":"ZmluYWw=","background":"opaque","output_format":"jpeg","quality":"medium","sequence_number":0,"size":"1448x1086","usage":{"total_tokens":1569}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: createOpenAIImagesSettingsWithModel('test-image-model', {
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'jpeg',
        quality: 'medium',
        size: '1448x1086',
      },
      revisedPrompts: [undefined],
    })
  })

  it('splits Images API streaming into concurrent single-image requests when n is greater than 1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const streamBody = [
        'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
        '',
        'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    const partials: Array<{ image: string; requestIndex?: number }> = []

    const result = await callImageApi({
      settings: createOpenAIImagesSettingsWithModel('test-image-model', {
        streamImages: true,
        streamPartialImages: 1,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string; requestIndex?: number }) => partials.push(partial),
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.n).toBeUndefined()
      expect(body.stream).toBe(true)
      expect(body.partial_images).toBe(1)
    }
    expect(result.images).toHaveLength(2)
    expect(result.images).toEqual([
      'data:image/png;base64,ZmluYWw=',
      'data:image/png;base64,ZmluYWw=',
    ])
    expect(partials.map((partial) => partial.requestIndex).sort()).toEqual([0, 1])
    expect(partials.map((partial) => partial.image)).toEqual([
      'data:image/png;base64,cGFydGlhbA==',
      'data:image/png;base64,cGFydGlhbA==',
    ])
  })

  it('does not send stream fields for GPT-Image-2 Images API requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings({
        streamImages: true,
        streamPartialImages: 3,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBeUndefined()
    expect(body.partial_images).toBeUndefined()
  })

  it('routes Gallery GPT-Image-2(VIP) to responses endpoint with gpt-5.5 and image_generation tool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIResponsesSettingsWithModel('gpt-5.5'),
      sourceMode: 'gallery',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: 'auto', output_format: 'png' },
      inputImageDataUrls: [],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/responses')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('gpt-5.5')
    expect(body.stream).toBeUndefined()
    expect(body.tools?.[0]?.type).toBe('image_generation')
    expect(body.tools?.[0]?.size).toBe('auto')
    expect(body.tools?.[0]?.output_format).toBe('png')
    expect(body.generationConfig).toBeUndefined()
    expect(body.responseModalities).toBeUndefined()
    expect(body.imageConfig).toBeUndefined()
  })

  it('routes Gallery GPT-Image-2(VIP) image edit to responses endpoint with input_image', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIResponsesSettingsWithModel('gpt-5.5'),
      sourceMode: 'gallery',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: 'auto', output_format: 'png' },
      inputImageDataUrls: ['data:image/png;base64,aW5wdXQ='],
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/responses')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/v1/images/edits')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    const content = body.input?.[0]?.content
    expect(Array.isArray(content)).toBe(true)
    expect(content.some((item: any) => item.type === 'input_image')).toBe(true)
    expect(body.tools?.[0]?.type).toBe('image_generation')
    expect(body.tools?.[0]?.output_format).toBe('png')
    expect(body.generationConfig).toBeUndefined()
    expect(body.responseModalities).toBeUndefined()
    expect(body.imageConfig).toBeUndefined()
  })

  it('streams Responses API partial images and resolves the completed response image', async () => {
    const streamBody = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"rewritten","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0].partial_images).toBe(1)
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('parses Responses API image result objects in gallery mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: { b64_json: 'ZmluYWw=' },
        size: '1024x1024',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('keeps Responses API stream output item images when completed response omits result', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.done","item":{"id":"img-call-1","type":"image_generation_call","status":"generating","action":"generate","result":"ZmluYWw=","size":"1024x1024"},"output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","status":"completed","result":""}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings({
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path when API proxy is locked', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings({
        apiProxy: false,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not add cache request headers that require extra CORS allow-list entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings(),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('Pragma')
    expect(headers).not.toHaveProperty('Cache-Control')
    expect((init as RequestInit).cache).toBe('no-store')
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: createOpenAIImagesSettings({
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('polls custom async tasks immediately and keeps polling after transient network errors', async () => {
    vi.useFakeTimers()
    const onCustomTaskEnqueued = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            errorPath: 'data.fail_reason',
            result: {
              imageUrlPaths: ['data.data.data.*.url'],
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 60,
        }],
        activeProfileId: 'profile-custom',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onCustomTaskEnqueued,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onCustomTaskEnqueued).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/v1/images/tasks/task-1')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not apply submit timeout to custom async polling after receiving a task id', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'IN_PROGRESS' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 5,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            result: {
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 1,
        }],
        activeProfileId: 'profile-custom',
        timeout: 1,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(6000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
  })

  it('queries billing endpoints and converts usd to points', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hard_limit_usd: 100,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_usage: 4321,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [subscriptionUrl, usageUrl] = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(subscriptionUrl).toContain('/v1/dashboard/billing/subscription')
    expect(usageUrl).toContain('/v1/dashboard/billing/usage?start_date=2023-01-01&end_date=')
    expect(subscriptionUrl).not.toContain('/v1/v1/')
    expect(usageUrl).not.toContain('/v1/v1/')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yyyy = tomorrow.getFullYear()
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const dd = String(tomorrow.getDate()).padStart(2, '0')
    expect(usageUrl).toContain(`end_date=${yyyy}-${mm}-${dd}`)

    const firstInit = fetchMock.mock.calls[0][1] as RequestInit
    expect((firstInit.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(result).toEqual({
      success: true,
      total_points: 1250,
      used_points: 540,
      remaining_points: 710,
    })
  })

  it('uses the Aittco upstream for billing even when profile baseUrl points to OpenAI', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hard_limit_usd: 10,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_usage_usd: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'test-key',
        })),
      },
    })

    const [subscriptionUrl, usageUrl] = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(subscriptionUrl).toContain('https://vip.aittco.com/v1/dashboard/billing/subscription')
    expect(usageUrl).toContain('https://vip.aittco.com/v1/dashboard/billing/usage?start_date=2023-01-01&end_date=')
    expect(subscriptionUrl).not.toContain('api.openai.com')
    expect(usageUrl).not.toContain('api.openai.com')
  })

  it('keeps remaining points at least zero', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hard_limit_usd: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_usage_usd: 5,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
      },
    })

    expect(result).toEqual({
      success: true,
      total_points: 12,
      used_points: 62,
      remaining_points: 0,
    })
  })

  it('throws a clear error when subscription request fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'invalid key' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_usage: 100,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
      },
    })).rejects.toThrow(/查询总额度失败/)
  })

  it('throws a clear error when usage request fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hard_limit_usd: 2,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'usage denied' },
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
      },
    })).rejects.toThrow(/查询已用额度失败/)
  })

  it('redacts api key in thrown errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('request failed for sk-secret-123'))

    await expect(queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'sk-secret-123',
      },
    })).rejects.toThrow('[REDACTED]')

    await expect(queryApiKeyBalance({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'sk-secret-123',
      },
    })).rejects.not.toThrow('sk-secret-123')
  })
})

describe('bananaModels', () => {
  it('maps GPT-Image-2(VIP) display name to gpt-5.5 with responses route', () => {
    const model = getBananaModelByDisplayName('GPT-Image-2(VIP)')
    expect(model?.model).toBe('gpt-5.5')
    expect(model?.providerRoute).toBe('openai-responses')
    expect(getBananaModelRoute('gpt-5.5')).toBe('openai-responses')
    expect(normalizeBananaModelId('GPT-Image-2(VIP)')).toBe('gpt-5.5')
  })

  it('keeps normal GPT-Image-2 mapped to images route', () => {
    expect(normalizeBananaModelId('GPT-Image-2')).toBe('gpt-image-2')
    expect(getBananaModelRoute('gpt-image-2')).toBe('openai-images')
  })
})
