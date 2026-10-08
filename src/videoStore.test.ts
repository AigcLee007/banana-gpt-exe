import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'

const clientState = vi.hoisted(() => ({ settings: {} as import('./types').AppSettings, showToast: vi.fn() }))

vi.mock('./lib/videoDb', () => ({
  getAllVideoTasks: vi.fn(async () => []),
  putVideoTask: vi.fn(async () => undefined),
  deleteVideoTask: vi.fn(),
  deleteMedia: vi.fn(),
  uploadMediaFile: vi.fn(async () => 'saved-frame'),
  requestPersistentStorage: vi.fn(async () => false),
}))
vi.mock('./lib/videoApi', () => ({
  submitVideoTask: vi.fn(async () => { throw new Error('视频服务当前繁忙，请稍后重试') }),
  pollVideoTask: vi.fn(),
  downloadVideoContent: vi.fn(),
  formatVideoTaskError: (value: string) => value,
}))
vi.mock('./store', () => ({ useStore: { getState: () => clientState } }))

import { putVideoTask, uploadMediaFile } from './lib/videoDb'
import { downloadVideoContent, pollVideoTask, submitVideoTask } from './lib/videoApi'
import { sdAdapter } from './lib/videoAdapters/sd'
import { useVideoStore } from './videoStore'

beforeEach(() => {
  clientState.settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, apiKey: 'mock-user-video-key' })) })
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
  useVideoStore.setState({ tasks: [], uploadingFiles: new Set(), isGenerating: false, inputMode: 'create', firstFrameId: null, lastFrameId: null, refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], sourceVideoId: null, prompt: 'A fox walking' })
  useVideoStore.getState().setModel('grok-imagine-video-1.5')
})
afterEach(() => {
  for (const task of useVideoStore.getState().tasks) useVideoStore.getState().cancelTask(task.id)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('video workbench on LAN HTTP', () => {
  it('tracks and completes an upload without crypto.randomUUID', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    await expect(useVideoStore.getState().uploadFile(file)).resolves.toBe('saved-frame')
    expect(uploadMediaFile).toHaveBeenCalledWith(file, 'upload')
    expect(useVideoStore.getState().uploadingFiles.size).toBe(0)
  })

  it('creates a task and preserves submission failure feedback without crypto.randomUUID', async () => {
    vi.mocked(submitVideoTask).mockImplementationOnce(async () => { throw new Error('视频服务当前繁忙，请稍后重试') })
    await useVideoStore.getState().generateVideo()
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(useVideoStore.getState().tasks).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'error', error: '视频服务当前繁忙，请稍后重试' })]))
    expect(useVideoStore.getState().isGenerating).toBe(false)
  })

  it('clears the upload lock and propagates storage failures', async () => {
    vi.mocked(uploadMediaFile).mockRejectedValueOnce(new Error('存储空间不足'))
    await expect(useVideoStore.getState().uploadFile(new File(['image'], 'image.png', { type: 'image/png' }))).rejects.toThrow('存储空间不足')
    expect(useVideoStore.getState().uploadingFiles.size).toBe(0)
  })
})

describe('video credentials from the current settings', () => {
  it.each(['grok-imagine-video-1.5', 'MiniMax-H3', 'gemini-omni-flash-10s'])('uses the user API Key for %s', async (model) => {
    useVideoStore.getState().setModel(model)
    await useVideoStore.getState().generateVideo()
    expect(vi.mocked(submitVideoTask).mock.calls[0][0].apiProfile?.apiKey).toBe('mock-user-video-key')
  })

  it('rejects a missing key without creating a task or sending a request', async () => {
    clientState.settings = normalizeSettings(DEFAULT_SETTINGS)
    await useVideoStore.getState().generateVideo()
    expect(submitVideoTask).not.toHaveBeenCalled()
    expect(useVideoStore.getState().tasks).toEqual([])
    expect(clientState.showToast).toHaveBeenCalledWith('请先在设置 → API 配置中填写 API Key', 'error')
    expect(useVideoStore.getState().isGenerating).toBe(false)
  })
})

describe('Omni capabilities in the workbench', () => {
  it('clears tail frames and unsupported references on model switch and limits images to seven', () => {
    useVideoStore.getState().setModel('MiniMax-H3')
    useVideoStore.getState().setFirstFrame('first')
    useVideoStore.getState().setLastFrame('last')
    useVideoStore.getState().setInputMode('reference')
    useVideoStore.getState().setReferenceItems([
      ...Array.from({ length: 9 }, (_, index) => ({ id: `image-${index}`, type: 'image' as const })),
      { id: 'video', type: 'video' }, { id: 'audio', type: 'audio' },
    ])
    useVideoStore.getState().setModel('gemini-omni-flash-10s')
    const state = useVideoStore.getState()
    expect(state.lastFrameId).toBeNull()
    expect(state.refImageIds).toHaveLength(7)
    expect(state.refVideoIds).toEqual([])
    expect(state.refAudioIds).toEqual([])
    expect(state.refItems.every((item) => item.type === 'image')).toBe(true)
    expect(() => state.addRefImage('eighth')).toThrow(/7/)
    expect(() => state.addRefVideo('video')).toThrow(/不支持/)
    expect(state.params).toMatchObject({ duration: 10, resolution: '720p', n: 1 })
  })

  it('creates one reference task with image inputs and downloads completed content into media storage', async () => {
    const { pollVideoTask, downloadVideoContent } = await import('./lib/videoApi')
    vi.mocked(submitVideoTask).mockResolvedValueOnce({ remoteTaskId: 'remote-omni', status: 'queued', recoverable: true })
    vi.mocked(pollVideoTask).mockResolvedValueOnce({ status: 'succeeded' })
    vi.mocked(downloadVideoContent).mockResolvedValueOnce(new Blob(['video'], { type: 'video/mp4' }))
    useVideoStore.getState().setModel('gemini-omni-flash-10s')
    useVideoStore.getState().setInputMode('reference')
    useVideoStore.getState().addRefImage('image')
    await useVideoStore.getState().generateVideo()
    await vi.waitFor(() => expect(useVideoStore.getState().tasks[0]?.status).toBe('done'))
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(vi.mocked(submitVideoTask).mock.calls[0][0]).toMatchObject({ adapter: 'omni', mode: 'ref2v', inputs: { refImageIds: ['image'], refVideoIds: [], refAudioIds: [] } })
    expect(downloadVideoContent).toHaveBeenCalledWith('remote-omni', expect.objectContaining({ adapter: 'omni' }))
    expect(uploadMediaFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'video/mp4' }), 'generated')
  })
})

describe('SD models in the workbench', () => {
  it.each(['sd2.0-15s', 'sd2.5-30s'])('downloads and stores completed %s content without a video URL', async (model) => {
    vi.mocked(submitVideoTask).mockResolvedValueOnce({ remoteTaskId: 'remote-sd', status: 'queued', recoverable: true })
    vi.mocked(pollVideoTask).mockResolvedValueOnce({ status: 'succeeded', progress: 100 })
    vi.mocked(downloadVideoContent).mockResolvedValueOnce(new Blob(['sd-video'], { type: 'video/mp4' }))
    useVideoStore.getState().setModel(model)
    useVideoStore.getState().setInputMode('reference')
    useVideoStore.getState().addRefImage('image')
    await useVideoStore.getState().generateVideo()
    await vi.waitFor(() => expect(useVideoStore.getState().tasks[0]?.status).toBe('done'))
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(downloadVideoContent).toHaveBeenCalledWith('remote-sd', expect.objectContaining({ model, adapter: 'sd' }))
    expect(uploadMediaFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'video/mp4' }), 'generated')
    await vi.waitFor(() => expect(putVideoTask).toHaveBeenCalledWith(expect.objectContaining({ model, status: 'done', outputVideoId: 'saved-frame', progress: 100 })))
  })

  it('keeps polling a long SD task every fifteen seconds without resubmitting it', async () => {
    vi.useFakeTimers()
    vi.mocked(submitVideoTask).mockResolvedValueOnce({ remoteTaskId: 'remote-long-sd', status: 'queued', recoverable: true })
    let polls = 0
    vi.mocked(pollVideoTask).mockImplementation(async () => ({ status: ++polls <= 40 ? 'queued' : 'running', progress: 50 }))
    useVideoStore.getState().setModel('sd2.5-30s')
    await useVideoStore.getState().generateVideo()
    await vi.advanceTimersByTimeAsync(0)
    expect(pollVideoTask).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14999)
    expect(pollVideoTask).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(pollVideoTask).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000 - 15000)
    expect(pollVideoTask).toHaveBeenCalledTimes(81)
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(downloadVideoContent).not.toHaveBeenCalled()
    expect(useVideoStore.getState().tasks[0]).toMatchObject({ remoteTaskId: 'remote-long-sd', status: 'running' })
  })

  it('stores a safe final failure reason and stops polling without a content download or resubmission', async () => {
    vi.useFakeTimers()
    const result = sdAdapter.parsePoll({ status: 'failed', progress: 100, error: { message: 'Content does not meet the requirements' } })
    vi.mocked(submitVideoTask).mockResolvedValueOnce({ remoteTaskId: 'remote-failed-sd', status: 'queued', recoverable: true })
    vi.mocked(pollVideoTask).mockResolvedValueOnce(result)
    useVideoStore.getState().setModel('sd2.0-15s')
    await useVideoStore.getState().generateVideo()
    await vi.advanceTimersByTimeAsync(0)
    const failed = useVideoStore.getState().tasks[0]
    expect(failed).toMatchObject({ status: 'error', error: result.error, remoteTaskId: 'remote-failed-sd' })
    await vi.waitFor(() => expect(putVideoTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: result.error })))
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(pollVideoTask).toHaveBeenCalledOnce()
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(downloadVideoContent).not.toHaveBeenCalled()
  })

  it.each([['sd2.0-15s', 15], ['sd2.5-30s', 30]] as const)('switches to %s without tail frames, video/audio, or stale parameters', async (model, seconds) => {
    useVideoStore.getState().setModel('MiniMax-H3')
    useVideoStore.getState().setLastFrame('tail')
    useVideoStore.getState().setFirstFrame('image')
    useVideoStore.getState().setReferenceItems([{ id: 'ref', type: 'image' }, { id: 'video', type: 'video' }, { id: 'audio', type: 'audio' }])
    useVideoStore.getState().setParams({ n: 4 })
    useVideoStore.getState().setModel(model)
    expect(useVideoStore.getState()).toMatchObject({ mode: 'i2v', lastFrameId: null, refVideoIds: [], refAudioIds: [], params: { duration: seconds, resolution: '720p', n: 1 } })
    await useVideoStore.getState().generateVideo()
    expect(submitVideoTask).toHaveBeenCalledOnce()
    expect(vi.mocked(submitVideoTask).mock.calls[0][0]).toMatchObject({ model, adapter: 'sd', mode: 'i2v', params: { duration: seconds, n: 1 }, inputs: { firstFrameId: 'image', refImageIds: [], refVideoIds: [], refAudioIds: [] }, apiProfile: { apiKey: 'mock-user-video-key', apiProxy: true } })
  })

  it.each(['sd2.0-15s', 'sd2.5-30s'])('supports 30 references for %s and rejects the thirty-first', (model) => {
    useVideoStore.getState().setModel(model)
    useVideoStore.getState().setInputMode('reference')
    for (let index = 0; index < 30; index++) useVideoStore.getState().addRefImage(`image-${index}`)
    expect(useVideoStore.getState().refImageIds).toHaveLength(30)
    expect(() => useVideoStore.getState().addRefImage('extra')).toThrow(/30/)
    expect(() => useVideoStore.getState().addRefVideo('video')).toThrow(/不支持/)
    expect(() => useVideoStore.getState().addRefAudio('audio')).toThrow(/不支持/)
  })

  it('rejects unsupported formats and oversize uploads before saving media', async () => {
    useVideoStore.getState().setModel('sd2.5-30s')
    await expect(useVideoStore.getState().uploadFile(new File(['image'], 'image.gif', { type: 'image/gif' }))).rejects.toThrow(/JPEG|PNG|WEBP/)
    const oversized = new File(['image'], 'image.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 15 * 1024 * 1024 + 1 })
    await expect(useVideoStore.getState().uploadFile(oversized)).rejects.toThrow(/15/)
    expect(uploadMediaFile).not.toHaveBeenCalled()
    expect(useVideoStore.getState().uploadingFiles.size).toBe(0)
  })
})

describe('Grok fixed task pricing', () => {
  it.each([
    { duration: 1, resolution: '480p' as const, firstFrameId: null },
    { duration: 15, resolution: '1080p' as const, firstFrameId: 'saved-frame' },
  ])('records 15 credits for $duration seconds at $resolution', async ({ duration, resolution, firstFrameId }) => {
    useVideoStore.getState().setParams({ duration, resolution, aspectRatio: '1:1' })
    useVideoStore.getState().setFirstFrame(firstFrameId)
    await useVideoStore.getState().generateVideo()
    expect(vi.mocked(submitVideoTask).mock.calls[0][0].estimatedCredits).toBe(15)
    expect(useVideoStore.getState().tasks[0].estimatedCredits).toBe(15)
  })
})
