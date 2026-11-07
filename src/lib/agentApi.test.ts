import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { createDefaultColorAdjustments } from './colorGrading'
import { COLOR_ASSISTANT_ALLOWED_PATHS } from './colorAssistant'
import { callAgentColorAssistantApi, callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle } from './agentApi'
import { AGENT_FIXED_MODEL } from './bananaModels'

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('instructs Midjourney Agent to request one group for four alternatives', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })
    await callAgentResponsesApi({ settings: { ...DEFAULT_SETTINGS, agentImageModel: 'Midjourney v8.2-High' }, profile, params: DEFAULT_PARAMS, input: [] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.instructions).toContain('one Midjourney task')
    expect(body.instructions).toContain('do not submit four tasks')
    expect(body.tools.find((item: { name: string }) => item.name === 'generate_image').description).toContain('one group')
  })

  it('streams Agent text with the strict single-image function schema', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      name: 'generate_image',
    })
    expect(body.tools[0].parameters.properties).toEqual({
      id: {
        type: 'string',
        description: 'Short stable identifier for this image, e.g. "cover", "base_character", "scene_1".',
      },
      prompt: {
        type: 'string',
        description: 'Complete image generation prompt with all visual details. Include matching XML ref tags when referring to existing images.',
      },
    })
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/png;base64,ZmluYWw=' }],
    })
  })

  it('keeps mask data out of the strict generate_image schema', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].parameters.properties.input_image_mask).toBeUndefined()
  })

  it('keeps app-controlled image params out of the strict generate_image schema', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'jpeg',
        output_compression: 80,
      },
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    const parameters = body.tools[0].parameters
    expect(body.tools[0]).toMatchObject({ name: 'generate_image', strict: true })
    expect(parameters.properties).toEqual({
      id: {
        type: 'string',
        description: 'Short stable identifier for this image, e.g. "cover", "base_character", "scene_1".',
      },
      prompt: {
        type: 'string',
        description: 'Complete image generation prompt with all visual details. Include matching XML ref tags when referring to existing images.',
      },
    })
    expect(parameters.required).toEqual(['id', 'prompt'])
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        id: 'ig_base64',
        result: { base64: 'ZmlsZQ==' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_base64',
      dataUrl: 'data:image/png;base64,ZmlsZQ==',
      actualParams: {},
    }])
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamBody))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      signal: abortController.signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta)
        abortController.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_search',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'OpenAI web search docs' },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'See OpenAI docs.',
            annotations: [{
              type: 'url_citation',
              start_index: 4,
              end_index: 15,
              url: 'https://platform.openai.com/docs',
              title: 'OpenAI Docs',
            }],
          }],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })

  it('reports failed image output item without aborting the ongoing stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: '已跳过失败图片',
      images: [],
    })
    expect(result.rawResponsePayload).toContain('resp_1')
  })

  it('does not duplicate the assistant message item when response.completed lacks an item id', async () => {
    const itemId = 'msg_abc123'
    const streamBody = [
      `data: {"type":"response.created","response":{"id":"resp_1","output":[]}}`,
      '',
      `data: {"type":"response.output_item.added","item":{"id":"${itemId}","type":"message","status":"in_progress","content":[],"role":"assistant"}}`,
      '',
      `data: {"type":"response.output_text.delta","delta":"hi","item_id":"${itemId}"}`,
      '',
      `data: {"type":"response.output_text.delta","delta":"!","item_id":"${itemId}"}`,
      '',
      `data: {"type":"response.output_item.done","item":{"id":"${itemId}","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"}}`,
      '',
      `data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const outputItemSnapshots: number[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      onOutputItems: (items) => outputItemSnapshots.push(items.length),
    })

    const messageItems = (result.outputItems ?? []).filter((item) => item.type === 'message')
    expect(messageItems).toHaveLength(1)
    expect(result.text).toBe('hi!')
    expect(outputItemSnapshots[outputItemSnapshots.length - 1]).toBe(1)
  })

  it('keeps Banana Agent requests on the fixed Agent model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'user-selected-gallery-model',
    })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, model: 'settings-gallery-model' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe(AGENT_FIXED_MODEL)
  })

  it('exposes custom image function tools in the main agent loop', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'user-selected-gallery-model',
      streamImages: true,
      streamPartialImages: 2,
    })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, model: 'settings-gallery-model' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe(AGENT_FIXED_MODEL)
    expect(body.instructions).toContain('generate_image')
    expect(body.instructions).toContain('generate_image_batch')
    expect(body.instructions).not.toContain('use the built-in image_generation tool')
    expect(body.tools.map((tool: { name?: string }) => tool.name)).toEqual([
      'generate_image',
      'generate_image_batch',
      'continue_generation',
    ])
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      name: 'generate_image',
      strict: true,
    })
    expect(body.tools[0].parameters.properties).toEqual({
      id: {
        type: 'string',
        description: 'Short stable identifier for this image, e.g. "cover", "base_character", "scene_1".',
      },
      prompt: {
        type: 'string',
        description: 'Complete image generation prompt with all visual details. Include matching XML ref tags when referring to existing images.',
      },
    })
    expect(body.tools[0].parameters.required).toEqual(['id', 'prompt'])
  })

  it('uses the selected Agent text model for conversation requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentTextModel: 'gpt-6.1-sol' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).model).toBe('gpt-6.1-sol')
    expect(JSON.parse(String((init as RequestInit).body)).reasoning).toEqual({ effort: 'high' })
  })

  it('uses the selected Agent text model for title requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '<title>Test</title>' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await callAgentConversationTitleApi({
      settings: { ...DEFAULT_SETTINGS, agentTextModel: 'gpt-6.1-sol' },
      profile,
      prompt: 'prompt',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).model).toBe('gpt-6.1-sol')
    expect(JSON.parse(String((init as RequestInit).body)).reasoning).toEqual({ effort: 'high' })
  })

  it('uses the selected Agent text model for batch image helper requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'img_1', result: 'ZmlsZQ==' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', streamImages: false })

    await callBatchImageSingle({
      settings: { ...DEFAULT_SETTINGS, agentTextModel: 'gpt-6.1-sol' },
      profile,
      params: DEFAULT_PARAMS,
      batchItemId: 'item_1',
      prompt: 'prompt',
      referenceImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).model).toBe('gpt-6.1-sol')
    expect(JSON.parse(String((init as RequestInit).body)).reasoning).toEqual({ effort: 'high' })
  })

  it('injects configurable math formatting instructions', async () => {
    const createResponse = () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createResponse())
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('## Math formatting')
    expect(body.instructions).toContain('Use `$...$` for inline formulas.')

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentMathFormattingPrompt: false },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.instructions).not.toContain('## Math formatting')
  })
})

describe('color assistant API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  const proposal = {
    explanation: 'Brighten the subject while keeping the background restrained.',
    changes: [{ path: 'basic.exposure', value: 0.4 }],
    curves: [{ channel: 'master', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    clarification: null,
  }

  const functionCall = (argumentsValue: string, name = 'propose_color_adjustments') => ({
    type: 'function_call',
    name,
    arguments: argumentsValue,
  })

  const responseFor = (output: unknown[], status = 200) => new Response(JSON.stringify({ output }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

  it('sends one image-aware strict proposal request and returns its parsed recipe', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([
      functionCall(JSON.stringify(proposal)),
    ]))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'color-key',
      baseUrl: 'https://color.example.test/v1',
      apiMode: 'responses',
      apiProxy: false,
    })
    const settings = { ...DEFAULT_SETTINGS, agentTextModel: 'gpt-6.1-sol' as const }
    const adjustments = createDefaultColorAdjustments()
    adjustments.whiteBalance.temperature = 7350
    adjustments.whiteBalance.tint = 7
    adjustments.whiteBalance.neutralGains = [1.4, 1, 0.8]
    adjustments.basic.exposure = 0.25
    adjustments.levels.master.gamma = 1.12
    adjustments.curves.master = [{ x: 0, y: 0 }, { x: 0.5, y: 0.58 }, { x: 1, y: 1 }]
    adjustments.hsl.red.saturation = 14
    adjustments.colorGrading.shadows.hue = 18
    adjustments.channelMixer.blue = [3, 4, 93]
    adjustments.lut = { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: Array(24).fill(0) }

    const result = await callAgentColorAssistantApi({
      settings,
      profile,
      instruction: 'Make this portrait warmer, but keep skin natural.',
      adjustments,
      previewImageDataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
      colorAnalysis: {
        width: 768,
        height: 432,
        samplingStep: 3,
        sampledPixels: 40000,
        ignoredTransparentSamples: 0,
        channels: {
          red: { mean: 136, p10: 72, median: 132, p90: 205, clippedLowPercent: 0.1, clippedHighPercent: 0.2 },
          green: { mean: 122, p10: 68, median: 119, p90: 184, clippedLowPercent: 0.1, clippedHighPercent: 0.2 },
          blue: { mean: 114, p10: 65, median: 112, p90: 172, clippedLowPercent: 0.1, clippedHighPercent: 0.1 },
        },
        luminance: { shadowPercent: 18, midtonePercent: 69, highlightPercent: 13, clippedBlackPercent: 0.4, clippedWhitePercent: 0.3 },
        lowChromaCandidates: { sampleCount: 4200, percent: 10.5, medianLab: { lightness: 55, a: 8, b: 4 } },
      },
    })

    expect(result).toEqual(proposal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://color.example.test/v1/responses')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer color-key' })
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('gpt-6.1-sol')
    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.instructions).toContain('请使用中文填写 explanation 和 clarification 字段。')
    expect(body.stream).toBeUndefined()
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      name: 'propose_color_adjustments',
      strict: true,
    })
    expect(body.instructions).toContain('Each change value is a final absolute target, not a delta.')
    expect(body.instructions).toContain('Leave all unlisted recipe paths unchanged.')
    expect(body.instructions).toContain('Treat low-chroma pixels as candidate neutrals, not confirmed neutral objects.')
    expect(body.instructions).toContain('counts and percentages are estimates of the full preview.')
    const toolDescription = body.tools[0].description as string
    for (const range of [
      'exposure [-5, 5]',
      'other basic values [-100, 100]',
      'white-balance temperature [2000, 12000]',
      'tint [-100, 100]',
      'inputBlack [0, 254]',
      'inputWhite [1, 255]',
      'gamma [0.01, 9.99]',
      'outputBlack and outputWhite [0, 255]',
      'inputBlack < inputWhite',
      'outputBlack <= outputWhite',
      'HSL hue [-180, 180]',
      'saturation and luminance [-100, 100]',
      'Color-grading wheel hue [-180, 180]',
      'saturation [0, 100]',
      'luminance [-100, 100]',
      'balance [-100, 100]',
      'blending [0, 100]',
      'Channel-mixer coefficients [-200, 200]',
    ]) {
      expect(toolDescription).toContain(range)
    }
    expect(toolDescription).toContain('channelMixer.<outputChannel>.<index>')
    expect(toolDescription).toContain('<outputChannel> is the output channel')
    expect(toolDescription).toContain('index 0, 1, 2 select red, green, blue input contributions, respectively')
    expect(toolDescription).toContain('Curves replace the full selected channel')
    expect(toolDescription).toContain('provide 2 to 64 points')
    expect(toolDescription).toContain('finite normalized x/y in [0, 1]')
    expect(toolDescription).toContain('strictly increasing x')
    expect(body.tool_choice).toEqual({ type: 'function', name: 'propose_color_adjustments' })
    expect(body.tools.some((tool: { type: string }) => tool.type === 'image_generation')).toBe(false)

    const parameters = body.tools[0].parameters
    expect(parameters.type).toBe('object')
    expect(parameters.additionalProperties).toBe(false)
    expect(parameters.required).toEqual(['explanation', 'changes', 'curves', 'clarification'])
    expect(parameters.properties.changes.items).toMatchObject({
      type: 'object',
      required: ['path', 'value'],
      additionalProperties: false,
    })
    expect(parameters.properties.changes.items.properties.path.enum).toEqual(COLOR_ASSISTANT_ALLOWED_PATHS)
    expect(parameters.properties.curves.items).toMatchObject({
      type: 'object',
      required: ['channel', 'points'],
      additionalProperties: false,
    })
    expect(parameters.properties.curves.items.properties.points.items).toMatchObject({
      type: 'object',
      required: ['x', 'y'],
      additionalProperties: false,
    })
    expect(body.input).toHaveLength(1)
    expect(body.input[0].role).toBe('user')
    expect(body.input[0].content).toHaveLength(2)
    expect(body.input[0].content[0].type).toBe('input_text')
    expect(body.input[0].content[0].text).toContain('Make this portrait warmer, but keep skin natural.')
    expect(body.input[0].content[0].text).toContain('Measured preview color statistics JSON:')
    expect(body.input[0].content[0].text).toContain('"medianLab"')
    expect(body.input[0].content[1]).toEqual({
      type: 'input_image',
      image_url: 'data:image/jpeg;base64,cHJldmlldw==',
    })

    const recipeText = body.input[0].content[0].text
      .split('Editable recipe JSON:\n')[1]
      .split('\n\nMeasured preview color statistics JSON:\n')[0]
    const recipe = JSON.parse(recipeText)
    expect(Object.keys(recipe)).toEqual(['basic', 'whiteBalance', 'levels', 'curves', 'hsl', 'colorGrading', 'channelMixer'])
    expect(recipe.whiteBalance).toEqual({ temperature: 7350, tint: 7 })
    expect(recipe.basic.exposure).toBe(0.25)
    expect(recipe.levels.master.gamma).toBe(1.12)
    expect(recipe.curves.master).toHaveLength(3)
    expect(recipe.hsl.red.saturation).toBe(14)
    expect(recipe.colorGrading.shadows.hue).toBe(18)
    expect(recipe.channelMixer.blue).toEqual([3, 4, 93])
    expect(JSON.stringify(recipe)).not.toContain('neutralGains')
    expect(JSON.stringify(recipe)).not.toContain('lut')
  })

  it('sends only instruction and recipe text when no preview image is supplied', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([
      functionCall(JSON.stringify(proposal)),
    ]))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Reduce the blue cast.',
      adjustments: createDefaultColorAdjustments(),
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.input[0].content).toHaveLength(1)
    expect(body.input[0].content[0].type).toBe('input_text')
    expect(body.input[0].content[0].text).toContain('Reduce the blue cast.')
    expect(body.input[0].content[0].text).toContain('Editable recipe JSON:')
    expect(body.input[0].content.some((part: { type: string }) => part.type === 'input_image')).toBe(false)
  })

  it('accepts reasoning output items alongside exactly one proposal function call', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([
      { type: 'reasoning', summary: [] },
      functionCall(JSON.stringify(proposal)),
      { type: 'reasoning', summary: [] },
    ]))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Make this image softer.',
      adjustments: createDefaultColorAdjustments(),
    })).resolves.toEqual(proposal)
  })

  it('uses the configured API proxy for the color proposal request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([
      functionCall(JSON.stringify(proposal)),
    ]))
    vi.stubGlobal('__DEV_PROXY_CONFIG__', {
      enabled: true,
      prefix: '/color-proxy',
      target: 'https://proxy.example.test/v1',
    })
    const profile = createDefaultOpenAIProfile({
      apiKey: 'proxy-key',
      baseUrl: 'https://proxy.example.test/v1',
      apiMode: 'responses',
      apiProxy: true,
    })

    await callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Make it cooler.',
      adjustments: createDefaultColorAdjustments(),
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/color-proxy/responses')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer proxy-key' })
  })

  it.each([
    ['missing function call', []],
    ['duplicate function calls', [functionCall(JSON.stringify(proposal)), functionCall(JSON.stringify(proposal))]],
    ['wrong function name', [functionCall(JSON.stringify(proposal), 'other_function')]],
    ['assistant prose output', [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }]],
    ['image output', [{ type: 'image_generation_call', result: 'aW1hZ2U=' }]],
    ['unknown output type', [{ type: 'other_output' }]],
  ])('rejects %s', async (_label, output) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor(output))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
    })).rejects.toThrow()
  })

  it('rejects malformed function arguments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([functionCall('{bad json')]))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
    })).rejects.toThrow()
  })

  it('rejects JSON arguments that violate the proposal contract', async () => {
    const invalidProposal = { ...proposal, changes: [{ path: 'lut.data', value: 1 }] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([functionCall(JSON.stringify(invalidProposal))]))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
    })).rejects.toThrow()
  })

  it('rejects non-success responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseFor([], 503))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
    })).rejects.toThrow()
  })

  it('rejects a pre-aborted request without calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const controller = new AbortController()
    controller.abort()
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })

    await expect(callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
      signal: controller.signal,
    })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the caller cancels', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const requestSignal = (init as RequestInit).signal as AbortSignal
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
      })
    })
    const controller = new AbortController()
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })
    const request = callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    controller.abort(new DOMException('Request cancelled', 'AbortError'))
    await expect(request).rejects.toThrow('Request cancelled')
  })

  it('aborts an in-flight request when the configured timeout expires', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const requestSignal = (init as RequestInit).signal as AbortSignal
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
      })
    })
    const profile = { ...createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }), timeout: 1 }
    const request = callAgentColorAssistantApi({
      settings: DEFAULT_SETTINGS,
      profile,
      instruction: 'Adjust this image.',
      adjustments: createDefaultColorAdjustments(),
    })

    const rejection = expect(request).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })
})
