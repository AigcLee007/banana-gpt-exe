import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'
import { BANANA_GALLERY_MODELS, usesGeminiImageParams } from '../lib/bananaModels'

const draft = vi.hoisted(() => ({ state: {} as Record<string, unknown>, pickerOnChange: null as ((model: string) => void) | null }))
vi.mock('./ImageModelPicker', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ImageModelPicker')>()
  return { default: (props: Parameters<typeof original.default>[0]) => {
    if (props.memoryScope === 'gallery') draft.pickerOnChange = props.onChange
    return <original.default {...props} />
  } }
})
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(draft.state), { getState: () => draft.state }),
  submitTask: vi.fn(), submitAgentMessage: vi.fn(), stopAgentResponse: vi.fn(), addImageFromFile: vi.fn(),
  createInputImageFromFile: vi.fn(), deleteImageIfUnreferenced: vi.fn(), updateTaskInStore: vi.fn(),
  removeMultipleTasks: vi.fn(), getCachedImage: vi.fn(), ensureImageCached: vi.fn(), getActiveAgentRounds: vi.fn(),
}))
import InputBar from './InputBar'

beforeEach(() => {
  draft.pickerOnChange = null
  vi.stubGlobal('window', { innerWidth: 1280 })
  draft.state = {
    prompt: '', appMode: 'gallery', inputImages: [], params: { ...DEFAULT_PARAMS }, settings: DEFAULT_SETTINGS,
    selectedTaskIds: [], tasks: [], agentConversations: [], searchQuery: '', filterStatus: 'all', filterFavorite: false,
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('image composer parameter controls', () => {
  it.each(['gallery', 'agent'])('shows dedicated Midjourney controls in %s mode', (mode) => {
    const profile = createDefaultOpenAIProfile({ model: 'Midjourney v8.2-Low' })
    draft.state.appMode = mode
    draft.state.params = { ...DEFAULT_PARAMS, size: '1:1', midjourneyQuality: '0.25' }
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, agentImageModel: 'Midjourney v8.2-High' })
    const html = renderToStaticMarkup(<InputBar />)
    for (const label of ['比例', '质量', '高清', '生成组数/次数']) expect(html).toContain('>' + label + '</span>')
    expect(html).toContain('0.25')
    for (const label of ['尺寸', '透明背景', '格式', '复杂度']) expect(html).not.toContain('>' + label + '</span>')
  })
  it.each(BANANA_GALLERY_MODELS.filter(item => !usesGeminiImageParams(item.model) && item.providerRoute !== 'midjourney').flatMap(item =>
    ['gallery', 'agent'].map(mode => [mode, item.model]),
  ))('exposes output options only on 1K animation lines for %s using %s', (mode, model) => {
    const profile = createDefaultOpenAIProfile({ model: mode === 'gallery' ? model : 'gemini-3-pro-image-preview' })
    draft.state.appMode = mode
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, agentImageModel: model })
    const html = renderToStaticMarkup(<InputBar />)
    for (const label of ['压缩率', '审核']) expect(html).not.toContain('>' + label + '</span>')
    if (model.endsWith('-1k')) {
      expect(html).toContain('>格式</span>')
      expect(html).toContain('>复杂度</span>')
    } else {
      expect(html).not.toContain('>格式</span>')
      expect(html).not.toContain('>复杂度</span>')
    }
    expect(html).toContain('>尺寸</span>')
    expect(html).toContain('>质量</span>')
    expect(html).toContain('>数量</span>')
    expect(html).not.toContain('placeholder="0-100"')
    if (mode === 'gallery') {
      expect(html).toContain('>透明背景</span>')
      expect(html).toContain('grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_4.75rem_4rem]')
    } else {
      expect(html).not.toContain('>透明背景</span>')
      expect(html).toContain('grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_4rem]')
    }
  })

  it('shows GIF frame bounds and defaults for GPT Image 2.6', () => {
    const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-sunburst-1k' })
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    draft.state.params = { ...DEFAULT_PARAMS, output_format: 'gif' }
    const html = renderToStaticMarkup(<InputBar />)
    expect(html).toContain('>复杂度</span>')
    expect(html).toContain('aria-label="GIF 帧数"')
    expect(html).toContain('min="2" max="16"')
    expect(html).toContain('value="9"')
    expect(html).toContain('aria-label="GIF 每帧时长（毫秒）"')
    expect(html).toContain('min="20" max="2000"')
    expect(html).toContain('value="200"')
  })

  it('keeps SVG and GIF disabled in Agent mode', () => {
    draft.state.appMode = 'agent'
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, agentImageModel: 'gpt-image-2.6-sunburst-1k' })
    const html = renderToStaticMarkup(<InputBar />)
    expect(html).toMatch(/<option value="svg" disabled=""/)
    expect(html).toMatch(/<option value="gif" disabled=""/)
  })

  it('disables SVG with reference images while leaving GIF available', () => {
    const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-flare-1k' })
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    draft.state.inputImages = [{ id: 'ref', dataUrl: 'data:image/png;base64,AAAA' }]
    const html = renderToStaticMarkup(<InputBar />)
    expect(html).toMatch(/<option value="svg" disabled=""/)
    expect(html).not.toMatch(/<option value="gif" disabled=""/)
  })

  it.each([
    { provider: 'openai', model: 'gpt-6.1-sol', apiMode: 'responses' as const, imageGenerationModel: 'gpt-image-2.6-sunburst-1k' },
  ])('exposes advanced output controls for $provider $apiMode profiles', (overrides) => {
    const profile = createDefaultOpenAIProfile(overrides)
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    const html = renderToStaticMarkup(<InputBar />)
    expect(html).toContain('aria-label="输出格式"')
    expect(html).toContain('>复杂度</span>')
    expect(html).not.toMatch(/<option value="gif" disabled=""/)
  })

  it('switches a Responses profile to the Gemini route when selecting Nano Banana', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.6-sunburst' })
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    const setSettings = vi.fn()
    draft.state.setSettings = setSettings
    draft.state.setParams = vi.fn()
    renderToStaticMarkup(<InputBar />)
    draft.pickerOnChange!('gemini-3-pro-image-preview')
    expect(setSettings).toHaveBeenCalledWith({ model: 'gemini-3-pro-image-preview', apiMode: 'images' })
  })

  it('updates the Responses image tool model while preserving the text model', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.6-sunburst' })
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    const setSettings = vi.fn()
    draft.state.setSettings = setSettings
    draft.state.setParams = vi.fn()
    renderToStaticMarkup(<InputBar />)
    draft.pickerOnChange!('gpt-image-2.6-flare')
    expect(setSettings).toHaveBeenCalledWith({ profiles: [expect.objectContaining({ apiMode: 'responses', model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.6-flare' })] })
  })

  it.each(BANANA_GALLERY_MODELS.filter(item => usesGeminiImageParams(item.model)).map(item => [item.model]))(
    'preserves the Nano Banana aspect ratio and size controls for %s', (model) => {
      const profile = createDefaultOpenAIProfile({ model })
      draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
      const html = renderToStaticMarkup(<InputBar />)
      expect(html).toContain('>比例</span>')
      expect(html).toContain('>图片尺寸</span>')
      expect(html).toContain('grid-cols-[minmax(0,1fr)_6.5rem_10rem_4rem]')
    },
  )
})
