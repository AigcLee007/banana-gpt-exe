import { fal } from '@fal-ai/client'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callImageApi } from './api'

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: vi.fn(),
    subscribe: vi.fn(),
    queue: {
      subscribeToStatus: vi.fn(),
      result: vi.fn(),
    },
  },
}))

const falMock = fal as unknown as {
  config: Mock
  subscribe: Mock
}

describe('callFalAiImageApi', () => {
  it.each([false, true])('clears hidden format and complexity on other fal lines for edit=%s', async isEdit => {
    falMock.subscribe.mockResolvedValue({ requestId: 'req-26', data: { images: [{ b64_json: 'aW1hZ2U=' }] } })
    const profile = createDefaultFalProfile({ apiKey: 'fal-key', model: 'openai/gpt-image-2.6/sunburst' })
    const result = await callImageApi({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id }), prompt: 'animation',
      params: { ...DEFAULT_PARAMS, output_format: 'gif', complexity: 'high', frame_count: 6, frame_duration_ms: 150 },
      inputImageDataUrls: isEdit ? ['data:image/png;base64,aW1hZ2U='] : [], nativeTransparentBackground: true,
    })
    expect(falMock.subscribe).toHaveBeenCalledWith(`openai/gpt-image-2.6/sunburst/${isEdit ? 'edit' : 'text-to-image'}`, expect.objectContaining({ input: expect.objectContaining({
      output_format: 'png', background: 'transparent',
    }) }))
    const input = falMock.subscribe.mock.calls[0][1].input
    expect(input).not.toHaveProperty('reasoning_effort')
    expect(input).not.toHaveProperty('frame_count')
    expect(input).not.toHaveProperty('frame_duration_ms')
    expect(result.images[0]).toMatch(/^data:image\/png;/)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses the default fal endpoint without proxyUrl', async () => {
    falMock.subscribe.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({ apiKey: 'fal-key', baseUrl: DEFAULT_FAL_BASE_URL }))

    expect(falMock.config).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
    })
  })

  it('passes custom fal API URL to the SDK proxyUrl option', async () => {
    falMock.subscribe.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({
      apiKey: 'fal-key',
      baseUrl: 'https://fal-proxy.example.com/api/fal/',
    }))

    expect(falMock.config).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      proxyUrl: 'https://fal-proxy.example.com/api/fal',
    })
  })
})
