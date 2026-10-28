import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, mergePortalProfile } from './apiProfiles'
import { normalizeEditorProfile, loadPortalConnection } from './settingsConnection'

describe('saving connection preferences', () => {
  it('keeps the managed gateway and credential when saving a preference', () => {
    const settings = mergePortalProfile(DEFAULT_SETTINGS, { baseUrl: 'http://localhost:8080/gw/v1', key: 'test-managed' })
    const saved = normalizeEditorProfile(settings.profiles[0], true)
    expect(saved.baseUrl).toBe('http://localhost:8080/gw/v1')
    expect(saved.apiKey).toBe('test-managed')
    expect(saved.apiProxy).toBe(false)
  })
  it('preserves a custom connection in Portal', () => {
    const custom = createDefaultOpenAIProfile({ id: 'custom', baseUrl: 'https://custom.example/v1/', apiKey: 'test-custom' })
    expect(normalizeEditorProfile(custom, true).baseUrl).toBe('https://custom.example/v1')
  })
  it('keeps the existing standalone fixed-address behavior', () => {
    const profile = createDefaultOpenAIProfile({ baseUrl: 'https://old.example' })
    expect(normalizeEditorProfile(profile, false).baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
  })
})

describe('Portal connection startup', () => {
  it('replaces a corrupted managed address with the authenticated bootstrap', async () => {
    const stale = mergePortalProfile(DEFAULT_SETTINGS, { baseUrl: 'https://vip.aittco.com', key: 'stale' })
    const settings = await loadPortalConnection(stale, async () => new Response(JSON.stringify({ baseUrl: '/gw/v1', key: 'fresh' })))
    expect(settings.baseUrl).toBe('/gw/v1')
    expect(settings.apiKey).toBe('fresh')
  })
  it('fails closed on bootstrap errors instead of returning the cached connection', async () => {
    await expect(loadPortalConnection(DEFAULT_SETTINGS, async () => new Response('{}', { status: 401 }))).rejects.toThrow()
  })
  it('rejects an incomplete bootstrap rather than using a cached key', async () => {
    await expect(loadPortalConnection(DEFAULT_SETTINGS, async () => new Response('{"baseUrl":"/gw/v1"}'))).rejects.toThrow()
  })
})
