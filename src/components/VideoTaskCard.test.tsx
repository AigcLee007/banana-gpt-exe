import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeVideoParams } from '../lib/videoModels'
import type { VideoTaskRecord } from '../lib/videoTypes'

vi.mock('../videoStore', () => ({ useVideoStore: () => ({ selectedTaskIds: new Set(), toggleSelectTask: vi.fn(), setDetailTask: vi.fn(), cancelTask: vi.fn(), reuseTaskConfig: vi.fn() }) }))
vi.mock('../hooks/useMediaBlobUrl', () => ({ useMediaBlobUrl: () => null }))
vi.mock('../lib/videoDb', () => ({ getMediaPosterBlobUrl: vi.fn(), getMediaBlobUrl: vi.fn() }))
import VideoTaskCard from './VideoTaskCard'

const task = (patch: Partial<VideoTaskRecord> = {}): VideoTaskRecord => ({
  id: 'task', prompt: 'A fox walking', model: 'grok-imagine-video-1.5', mode: 't2v',
  params: normalizeVideoParams({}, 'grok-imagine-video-1.5', 't2v'),
  inputs: { refImageIds: [], refVideoIds: [], refAudioIds: [] }, adapter: 'grok',
  status: 'queued', error: null, createdAt: Date.now(), finishedAt: null, elapsed: null, ...patch,
})

describe('video task feedback', () => {
  it.each([
    ['queued', undefined, '排队中'], ['running', undefined, '生成中'],
    ['running', true, '处理中'], ['done', undefined, '已完成'],
    ['error', undefined, '生成失败'], ['canceled', undefined, '已停止跟踪'],
  ] as const)('labels %s processing=%s explicitly', (status, processing, label) => {
    const html = renderToStaticMarkup(<VideoTaskCard task={task({ status, ...{ processing } })} />)
    expect(html).toContain(label)
  })

  it('does not invent a percentage when the upstream sends no progress', () => {
    const html = renderToStaticMarkup(<VideoTaskCard task={task({ status: 'running' })} />)
    expect(html).not.toContain('0%')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('停止跟踪')
    expect(html).not.toContain('▶ 播放')
  })

  it('uses the upstream percentage for an accessible progress indicator', () => {
    const html = renderToStaticMarkup(<VideoTaskCard task={task({ status: 'running', progress: 42 })} />)
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="42"')
  })

  it('offers a review step before retrying a failed generation', () => {
    const html = renderToStaticMarkup(<VideoTaskCard task={task({ status: 'error', error: '服务暂不可用' })} />)
    expect(html).toContain('调整后重试')
    expect(html).toContain('服务暂不可用')
    expect(html).not.toContain('停止跟踪')
  })

  it('keeps portrait and landscape output in the same preview frame', () => {
    for (const aspectRatio of ['9:16', '16:9'] as const) {
      const source = task()
      source.params.aspectRatio = aspectRatio
      const html = renderToStaticMarkup(<VideoTaskCard task={source} />)
      expect(html).toContain('aspect-ratio:16/9')
    }
  })
})
