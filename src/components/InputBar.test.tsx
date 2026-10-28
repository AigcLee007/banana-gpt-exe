import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'
import { BANANA_GALLERY_MODELS, usesGeminiImageParams } from '../lib/bananaModels'

const draft = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(draft.state), { getState: () => draft.state }),
  submitTask: vi.fn(), submitAgentMessage: vi.fn(), stopAgentResponse: vi.fn(), addImageFromFile: vi.fn(),
  createInputImageFromFile: vi.fn(), deleteImageIfUnreferenced: vi.fn(), updateTaskInStore: vi.fn(),
  removeMultipleTasks: vi.fn(), getCachedImage: vi.fn(), ensureImageCached: vi.fn(), getActiveAgentRounds: vi.fn(),
}))
import InputBar from './InputBar'

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280 })
  draft.state = {
    prompt: '', appMode: 'gallery', inputImages: [], params: { ...DEFAULT_PARAMS }, settings: DEFAULT_SETTINGS,
    selectedTaskIds: [], tasks: [], agentConversations: [], searchQuery: '', filterStatus: 'all', filterFavorite: false,
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('image composer parameter controls', () => {
  it.each(BANANA_GALLERY_MODELS.filter(item => !usesGeminiImageParams(item.model)).flatMap(item =>
    ['gallery', 'agent'].map(mode => [mode, item.model]),
  ))('hides format, compression and moderation for %s using %s', (mode, model) => {
    const profile = createDefaultOpenAIProfile({ model: mode === 'gallery' ? model : 'gemini-3-pro-image-preview' })
    draft.state.appMode = mode
    draft.state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, agentImageModel: model })
    const html = renderToStaticMarkup(<InputBar />)
    for (const label of ['格式', '压缩率', '审核']) expect(html).not.toContain('>' + label + '</span>')
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
