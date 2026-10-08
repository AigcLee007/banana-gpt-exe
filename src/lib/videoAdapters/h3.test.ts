import { describe, expect, it, vi } from 'vitest'

vi.mock('../videoDb', () => ({
  getMedia: vi.fn(async () => ({ blob: new Blob(['fake-image'], { type: 'image/png' }) })),
}))

const fakeFileReader = class {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
      this.onload?.()
    }).catch((error) => this.onerror?.(error))
  }
}
vi.stubGlobal('FileReader', fakeFileReader)
import { h3Adapter } from './h3'
import { encodeVideoMention } from '../videoPromptMentions'
import type { VideoTaskRecord } from '../videoTypes'

describe('h3Adapter', () => {
  const profile = {
    profileId: 'profile-1',
    baseUrl: 'https://vip.aittco.com',
    apiKey: 'test-key',
    apiProxy: false,
  }

  describe('parseSubmit', () => {
    it('parses queued status', () => {
      const result = h3Adapter.parseSubmit({
        id: 'task_abc123',
        status: 'queued',
      })
      expect(result.taskId).toBe('task_abc123')
      expect(result.status).toBe('queued')
    })

    it('parses in_progress status', () => {
      const result = h3Adapter.parseSubmit({
        id: 'task_abc123',
        status: 'in_progress',
      })
      expect(result.taskId).toBe('task_abc123')
      expect(result.status).toBe('running')
    })
  })

  describe('buildPoll', () => {
    it('builds correct poll request', () => {
      const { url, init } = h3Adapter.buildPoll('task_abc123', profile)
      expect(url).toBe('https://vip.aittco.com/v1/videos/task_abc123')
      expect(init.method).toBe('GET')
      expect(init.headers).toHaveProperty('Authorization')
    })
  })

  describe('buildSubmit frame payloads', () => {
    const imageTask = (mode: 'i2v' | 'flf2v') => ({
      id: `task-${mode}`,
      prompt: '测试画面',
      mode,
      model: 'MiniMax-H3',
      params: { duration: 4, resolution: '768p' as const, aspectRatio: '16:9', audio: true, n: 1 },
      inputs: {
        firstFrameId: 'first',
        ...(mode === 'flf2v' ? { lastFrameId: 'last' } : {}),
        refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [],
      },
      status: 'queued' as const, adapter: 'h3' as const, error: null,
      createdAt: Date.now(), finishedAt: null, elapsed: null, apiProfile: profile,
    })

    it('sends first_frame content for i2v', async () => {
      const originalFetch = globalThis.fetch
      const task = imageTask('i2v')
      const { getMedia } = await import('../videoDb')
      void getMedia
      const spec = await h3Adapter.buildSubmit({ task, profile })
      expect(spec.url).toBe('https://vip.aittco.com/v1/videos')
      expect(String(spec.init.body)).toContain('first_frame')
      globalThis.fetch = originalFetch
    })

    it('sends both frame roles for flf2v', async () => {
      const task = imageTask('flf2v')
      const spec = await h3Adapter.buildSubmit({ task, profile })
      expect(String(spec.init.body)).toContain('first_frame')
      expect(String(spec.init.body)).toContain('last_frame')
    })
    it('serializes both frame mentions without losing first/last frame roles', async () => {
      const task = imageTask('flf2v')
      task.prompt = `${encodeVideoMention({id:'first',type:'image',label:'图片1'})}过渡到${encodeVideoMention({id:'last',type:'image',label:'图片2'})}`
      const spec = await h3Adapter.buildSubmit({task,profile})
      const body = JSON.parse(String(spec.init.body))
      expect(body.prompt).toBe('图片1过渡到图片2')
      expect(body.metadata.metaso_content.filter((c: {type:string}) => c.type === 'image_url').map((c: {role:string}) => c.role)).toEqual(['first_frame','last_frame'])
      expect(body.metadata.metaso_content[0].text).toBe('图片1过渡到图片2')
    })
    it('serializes single frame mentions even when refItems is empty', async () => {
      const task = imageTask('i2v')
      task.prompt = encodeVideoMention({id:'first',type:'image',label:'图片1'})
      const spec = await h3Adapter.buildSubmit({task,profile})
      expect(JSON.parse(String(spec.init.body)).prompt).toBe('图片1')
    })
  })

  it('serializes reference chips to readable prompt and excludes internal IDs from multipart', async () => {
    const task: VideoTaskRecord = {
      id:'reference-test', prompt:`参照${encodeVideoMention({id:'reference-A',type:'image',label:'图片1'})}`,
      model:'MiniMax-H3',mode:'ref2v',adapter:'h3',status:'queued',error:null,
      params:{duration:4,resolution:'768p',aspectRatio:'16:9',audio:true,n:1},
      inputs:{refImageIds:['reference-A'],refVideoIds:[],refAudioIds:[],refItems:[{id:'reference-A',type:'image'}]},
      createdAt:0,finishedAt:null,elapsed:null,
    }
    const spec = await h3Adapter.buildSubmit({task,profile})
    const form = spec.init.body as FormData
    expect(form.get('prompt')).toBe('参照图片1')
    expect(form.getAll('reference_image')).toHaveLength(1)
    expect(form.get('n')).toBeNull()
  })

  describe('parsePoll', () => {
    it('maps completed to succeeded', () => {
      const result = h3Adapter.parsePoll({ status: 'completed', progress: 100 })
      expect(result.status).toBe('succeeded')
      expect(result.progress).toBe(100)
    })
    it('maps in_progress to running', () => {
      const result = h3Adapter.parsePoll({ status: 'in_progress', progress: 50 })
      expect(result.status).toBe('running')
      expect(result.progress).toBe(50)
    })
    it('maps failed with error', () => {
      const result = h3Adapter.parsePoll({ status: 'failed', error: 'Invalid prompt' })
      expect(result.status).toBe('failed')
      expect(result.error).toBe('Invalid prompt')
    })
    it('maps queued', () => {
      const result = h3Adapter.parsePoll({ status: 'queued', progress: 0 })
      expect(result.status).toBe('queued')
      expect(result.progress).toBe(0)
    })
  })
})
