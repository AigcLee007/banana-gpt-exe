import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from './lib/apiProfiles'

const entries = new Map<string, string>()
const storage = {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => { entries.set(key, value) },
  removeItem: (key: string) => { entries.delete(key) },
}
let store: typeof import('./store')
let initial: ReturnType<typeof import('./store')['useStore']['getState']>

beforeAll(async () => {
  // Zustand reads window.localStorage while the store module initializes.
  vi.stubGlobal('window', { localStorage: storage })
  store = await import('./store')
  initial = store.useStore.getState()
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  entries.clear()
  const profile = { ...createDefaultOpenAIProfile(), apiMode: 'responses' as const }
  store.useStore.setState({
    ...initial,
    settings: normalizeSettings({ ...initial.settings, profiles: [profile], activeProfileId: profile.id,
      persistInputOnRestart: true, agentPersistInputOnRestart: true }),
    appMode: 'agent',
    activeAgentConversationId: 'conversation',
    agentConversations: [{ id: 'conversation', title: 'Conversation', createdAt: 1, updatedAt: 1, rounds: [], messages: [] }],
    prompt: '', inputImages: [], agentInputDrafts: {},
    galleryInputDraft: { prompt: 'Gallery only', inputImages: [], maskDraft: null, maskEditorImageId: null },
  })
})

async function reloadPersistedState() {
  const saved = storage.getItem('gpt-image-playground')!
  store.useStore.setState({ ...initial })
  storage.setItem('gpt-image-playground', saved)
  await store.useStore.persist.rehydrate()
}

describe('workspace input hydration through actual Zustand persistence', () => {
  it('keeps a modern empty Agent draft separate from a persisted Gallery draft', async () => {
    await reloadPersistedState()
    store.useStore.getState().setAppMode('agent')
    expect(store.useStore.getState().prompt).toBe('')
    expect(store.useStore.getState().agentInputDrafts).toEqual({})
    store.useStore.getState().setAppMode('gallery')
    expect(store.useStore.getState().prompt).toBe('Gallery only')
  })

  it('does not display the Gallery draft when Agent draft persistence is disabled', async () => {
    store.useStore.getState().setSettings({ agentPersistInputOnRestart: false })
    await reloadPersistedState()
    expect(store.useStore.getState().prompt).toBe('')
    expect(store.useStore.getState().agentInputDrafts).toEqual({})
    expect(store.useStore.getState().galleryInputDraft?.prompt).toBe('Gallery only')
  })

  it('still migrates legacy Agent root input without a Gallery draft field', async () => {
    const saved = JSON.parse(storage.getItem('gpt-image-playground')!)
    delete saved.state.galleryInputDraft
    saved.state.prompt = 'Legacy Agent draft'
    storage.setItem('gpt-image-playground', JSON.stringify(saved))
    await reloadPersistedState()
    store.useStore.getState().setAppMode('agent')
    expect(store.useStore.getState().prompt).toBe('Legacy Agent draft')
    expect(store.useStore.getState().agentInputDrafts.conversation.prompt).toBe('Legacy Agent draft')
  })
})
