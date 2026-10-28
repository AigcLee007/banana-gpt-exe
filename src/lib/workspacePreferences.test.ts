import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergePortalProfile, normalizeSettings } from './apiProfiles'
import { getAgentEnterSubmit, getAgentPersistDraft, getVideoPersistedDraft } from './workspacePreferences'

describe('workspace input preferences', () => {
  it('keeps the chosen Agent text model on managed bootstrap refresh', () => {
    const bootstrap = { baseUrl: '/gw/v1', key: 'test-placeholder' }
    const existing = mergePortalProfile(DEFAULT_SETTINGS, bootstrap)
    existing.agentTextModel = 'gpt-5.6-sol'
    expect(mergePortalProfile(existing, bootstrap).agentTextModel).toBe('gpt-5.6-sol')
  })
  it('migrates Agent input habits from existing preferences until explicitly overridden', () => {
    const settings = normalizeSettings({ enterSubmit: true, persistInputOnRestart: false })
    expect(getAgentEnterSubmit(settings)).toBe(true)
    expect(getAgentPersistDraft(settings)).toBe(false)
  })
  it('preserves independent Agent preferences through normalization', () => {
    const settings = normalizeSettings({ enterSubmit: true, persistInputOnRestart: true, agentEnterSubmit: false, agentPersistInputOnRestart: false })
    expect(getAgentEnterSubmit(settings)).toBe(false)
    expect(getAgentPersistDraft(settings)).toBe(false)
    expect(settings.enterSubmit).toBe(true)
    expect(settings.persistInputOnRestart).toBe(true)
  })
  it('omits video draft content and attachments when draft persistence is disabled', () => {
    const state = { inputMode: 'create' as const, mode: 't2v' as const, model: 'video', params: {}, prompt: 'private draft', firstFrameId: 'image', lastFrameId: null, refItems: [], refImageIds: ['image'], refVideoIds: [], refAudioIds: [], preferences: { persistDraft: false, clearAfterSubmit: false } }
    const saved = getVideoPersistedDraft(state)
    expect(saved.prompt).toBe('')
    expect(saved.firstFrameId).toBeNull()
    expect(saved.refImageIds).toEqual([])
    expect(saved.model).toBe('video')
    expect(saved.preferences.persistDraft).toBe(false)
    expect(state.prompt).toBe('private draft')
  })
})
