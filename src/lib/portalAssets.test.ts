import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'local', dataUrl: 'data:image/png,local' })),
  images: [] as unknown[], mode: 'gallery', prompt: '',
  videoPrompt: '', first: null as string | null, last: null as string | null,
  inputMode: 'create', refs: [] as { id: string; type: string }[], upload: vi.fn(async () => 'media-local'),
  model: { modes: { i2v: {}, flf2v: {}, ref2v: { maxImages: 2, maxVideos: 1, maxAudios: 0 } }, imageMimeTypes: ['image/png'], videoMimeTypes: ['video/mp4'] },
}))
vi.mock('../store', () => ({ createInputImageFromFile: native.create, useStore: { getState: () => ({ appMode: native.mode, inputImages: native.images, prompt: native.prompt, setAppMode: (s: string) => { native.mode = s }, addInputImage: (i: unknown) => { native.images.push(i) }, setPrompt: (s: string) => { native.prompt = s }, showToast: vi.fn() }) } }))
vi.mock('../videoStore', () => ({ useVideoStore: { getState: () => ({ inputMode: native.inputMode, firstFrameId: native.first, lastFrameId: native.last, refImageIds: native.refs.filter(r => r.type === 'image').map(r => r.id), refVideoIds: native.refs.filter(r => r.type === 'video').map(r => r.id), refAudioIds: [], refItems: native.refs, prompt: native.videoPrompt, uploadFile: native.upload, setPrompt: (s: string) => { native.videoPrompt = s }, setFirstFrame: (s: string) => { native.first = s }, setLastFrame: (s: string) => { native.last = s }, addReference: (r: { id: string; type: string }) => { native.refs.push(r) } }) } }))
vi.mock('./videoModels', () => ({ getVideoModelDefinition: () => native.model }))
vi.mock('./db', () => ({ getAllImages: vi.fn(async () => []), getImage: vi.fn() }))
vi.mock('./videoDb', () => ({ getAllMedia: vi.fn(async () => []), getMedia: vi.fn() }))
import { studioAssetLimits, useStudioAssets } from './portalAssets'

const item = (kind: string, mime: string, text?: string) => ({ asset: { id: kind, kind, title: kind, mime }, blob: new Blob([text || kind], { type: mime }), text })
beforeEach(() => { native.images = []; native.mode = 'gallery'; native.prompt = ''; native.videoPrompt = ''; native.first = null; native.last = null; native.refs = []; native.inputMode = 'create'; vi.clearAllMocks() })
describe('Studio native asset handoff', () => {
  it('copies image bytes into the native draft and appends editable text', async () => {
    native.prompt = 'Existing'
    await useStudioAssets('gallery', [item('image', 'image/png'), item('text', 'text/plain', 'New prompt')])
    expect(native.images).toHaveLength(1)
    expect(native.prompt).toBe('Existing\n\nNew prompt')
    expect(native.create).toHaveBeenCalledOnce()
  })
  it('validates all media before changing gallery draft', async () => {
    await expect(useStudioAssets('gallery', [item('image', 'image/png'), item('audio', 'audio/wav')])).rejects.toThrow('类型')
    expect(native.create).not.toHaveBeenCalled()
    expect(native.images).toHaveLength(0)
  })
  it('assigns only empty native first/last frame roles without generating', async () => {
    native.first = 'existing-first'
    await useStudioAssets('video', [item('image', 'image/png')])
    expect(native.first).toBe('existing-first')
    expect(native.last).toBe('media-local')
    expect(native.mode).toBe('video')
  })
  it('checks current reference count and MIME before upload', async () => {
    native.inputMode = 'reference'; native.refs = [{ id: 'v', type: 'video' }]
    expect(studioAssetLimits('video').video).toBe(0)
    await expect(useStudioAssets('video', [item('video', 'video/mp4')])).rejects.toThrow('数量')
    await expect(useStudioAssets('video', [item('image', 'image/jpeg')])).rejects.toThrow('类型')
    expect(native.upload).not.toHaveBeenCalled()
  })
  it('treats cancel as no change', async () => {
    await useStudioAssets('agent', [])
    expect(native.mode).toBe('gallery')
    expect(native.create).not.toHaveBeenCalled()
  })
})
