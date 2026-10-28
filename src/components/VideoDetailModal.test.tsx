import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { VideoTaskRecord } from '../lib/videoTypes'
import { normalizeVideoParams } from '../lib/videoModels'

const draft = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../videoStore', () => ({ useVideoStore: () => draft.state }))
vi.mock('../hooks/useMediaBlobUrl', () => ({ useMediaBlobUrl: () => null }))
import VideoDetailModal from './VideoDetailModal'

beforeEach(() => {
  draft.state = { detailTaskId: 'task-price', tasks: [] }
})

describe('video task detail pricing', () => {
  it.each([
    ['running', true, '处理中'], ['running', undefined, '生成中'],
    ['canceled', undefined, '已停止跟踪'], ['done', undefined, '视频预览不可用'],
  ] as const)('describes %s processing=%s consistently', (status, processing, label) => {
    draft.state.tasks = [{
      id: 'task-price', model: 'sd2-933-3', adapter: 'sdMedia', mode: 't2v', prompt: 'fox',
      params: normalizeVideoParams({}, 'sd2-933-3', 't2v'),
      inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [] },
      status, processing, error: null, createdAt: 1, finishedAt: null, elapsed: null,
    }]
    const html = renderToStaticMarkup(<VideoDetailModal />)
    expect(html).toContain(label)
    expect(html).not.toContain('生成中 0%')
    expect(html).not.toContain('取消任务')
  })

  it.each([
    ['sd2-933-3', 45, '45'],
    ['sd2-933-全', 60, '60'],
    ['sd2.5-10-全', 37.5, '37.5'],
    ['sd2.0-15s', 20, '20.0'],
  ] as const)('preserves the expected credit precision for %s', (model, estimatedCredits, label) => {
    const task: VideoTaskRecord = {
      id: 'task-price', model, adapter: model === 'sd2.0-15s' ? 'sd' : 'sdMedia',
      mode: 't2v', prompt: '海边日出', params: normalizeVideoParams({}, model, 't2v'),
      inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [] },
      status: 'queued', error: null, createdAt: 1, finishedAt: null, elapsed: null, estimatedCredits,
    }
    draft.state.tasks = [task]
    const html = renderToStaticMarkup(<VideoDetailModal />)
    expect(html).toContain(`${label} 💎`)
    expect(html).toContain(model)
  })
})
