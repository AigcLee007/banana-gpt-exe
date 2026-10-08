import { afterEach, describe, expect, it, vi } from 'vitest'
import { h3Adapter } from './videoAdapters/h3'
import { grokAdapter } from './videoAdapters/grok'
import { omniAdapter } from './videoAdapters/omni'
import { sdAdapter } from './videoAdapters/sd'
import type { VideoTaskRecord } from './videoTypes'

const profile = { profileId: 'video-profile', baseUrl: 'https://relay.example.test/v1/', apiKey: 'test-key', apiProxy: true }
const models = [
  { model: 'MiniMax-H3', adapter: h3Adapter, duration: 4, resolution: '768p' },
  { model: 'grok-imagine-video-1.5', adapter: grokAdapter, duration: 8, resolution: '480p' },
  { model: 'gemini-omni-flash-10s', adapter: omniAdapter, duration: 10, resolution: '720p' },
  { model: 'sd2.0-15s', adapter: sdAdapter, duration: 15, resolution: '720p' },
  { model: 'sd2.5-30s', adapter: sdAdapter, duration: 30, resolution: '720p' },
] as const

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('video request transport', () => {
  it('normalizes an H3 API URL that already contains v1', () => {
    const directProfile = { ...profile, apiProxy: false }
    expect(h3Adapter.buildPoll('task-1', directProfile).url).toBe('https://relay.example.test/v1/videos/task-1')
    expect(h3Adapter.buildContent('task-1', directProfile).url).toBe('https://relay.example.test/v1/videos/task-1/content')
  })

  it('routes H3 through the locked web video proxy even when the saved switch is off', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://relay.example.test/v1')
    expect(h3Adapter.buildPoll('task-1', { ...profile, apiProxy: false }).url).toBe('/api-proxy/v1/videos/task-1')
  })

  it.each(models)('uses authenticated absolute requests for $model in the packaged desktop app', async ({ model, adapter, duration, resolution }) => {
    vi.stubGlobal('window', { location: { protocol: 'app:' } })
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    const task: VideoTaskRecord = {
      id: 'local-task', prompt: 'A fox walking', mode: 't2v', model,
      params: { duration, resolution, aspectRatio: '16:9', audio: false, n: 1 },
      inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [] },
      status: 'queued', adapter: 'h3', error: null, createdAt: 0, finishedAt: null, elapsed: null,
    }
    const submit = await adapter.buildSubmit({ task, profile })
    const poll = adapter.buildPoll('task /1', profile)
    const content = adapter.buildContent('task /1', profile)
    expect(submit.url).toBe('https://relay.example.test/v1/videos')
    expect(poll.url).toBe('https://relay.example.test/v1/videos/task%20%2F1')
    expect(content.url).toBe('https://relay.example.test/v1/videos/task%20%2F1/content')
    for (const spec of [submit, poll, content]) {
      expect(new Headers(spec.init.headers).get('Authorization')).toBe('Bearer test-key')
    }
  })
})
