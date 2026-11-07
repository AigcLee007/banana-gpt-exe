// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ settings: {}, streamPreviews: {}, toggleTaskSelection: vi.fn() }),
  ensureImageCached: vi.fn(), ensureImageThumbnailCached: vi.fn(), subscribeImageThumbnail: vi.fn(), updateTaskInStore: vi.fn(), retryTask: vi.fn(),
}))
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import TaskCard from './TaskCard'

const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task', prompt: 'A fox walking', params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null, ...patch,
})
const render = (patch: Partial<TaskRecord> = {}, isSelected = false) => renderToStaticMarkup(
  <TaskCard task={task(patch)} isSelected={isSelected} onClick={vi.fn()} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} />,
)

describe('gallery task feedback', () => {
  it('plays the original GIF even when a static thumbnail arrives later', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const gif = 'data:image/gif;base64,R0lGODlh'
    vi.mocked(ensureImageCached).mockResolvedValue(gif)
    vi.mocked(ensureImageThumbnailCached).mockResolvedValue({ dataUrl: 'data:image/webp;base64,thumb', width: 2, height: 2 })
    vi.mocked(subscribeImageThumbnail).mockReturnValue(() => {})
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<TaskCard task={task({ status: 'done', outputImages: ['gif-image'], params: { ...DEFAULT_PARAMS, output_format: 'gif' } })} onClick={vi.fn()} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} />))
      expect(container.querySelector('img')?.getAttribute('src')).toBe(gif)
      const subscriptions = vi.mocked(subscribeImageThumbnail).mock.calls
      act(() => subscriptions[subscriptions.length - 1]?.[1]({ dataUrl: 'data:image/webp;base64,later', width: 2, height: 2 }))
      expect(container.querySelector('img')?.getAttribute('src')).toBe(gif)
    } finally {
      act(() => root.unmount())
    }
  })
  it('shows animation frame settings and requested complexity in history', () => {
    const html = render({ params: { ...DEFAULT_PARAMS, output_format: 'gif', complexity: 'high', frame_count: 9, frame_duration_ms: 200 } })
    expect(html).toContain('9 帧')
    expect(html).toContain('200ms')
    expect(html).toContain('复杂度 high')
  })
  it.each([
    [{ status: 'running' }, '生成中'], [{ status: 'done' }, '已完成'],
    [{ status: 'error', error: '连接失败' }, '生成失败'],
    [{ status: 'error', error: '已停止生成。' }, '已停止'],
    [{ status: 'error', customRecoverable: true }, '恢复中'],
    [{ status: 'error', falRecoverable: true }, '恢复中'],
  ] as const)('labels each task state explicitly', (patch, label) => {
    expect(render(patch)).toContain(label)
  })

  it('keeps loading and completed previews in the same square frame', () => {
    expect(render()).toContain('aspect-ratio:1/1')
    expect(render({ status: 'done', outputImages: ['image'] })).toContain('aspect-ratio:1/1')
    expect(render()).toContain('aria-busy="true"')
  })

  it('offers an accessible selection control for every card', () => {
    expect(render()).toContain('aria-label="选择记录"')
    expect(render({}, true)).toContain('aria-pressed="true"')
    expect(render({}, true)).toContain('aria-label="取消选择记录"')
  })

  it('shows a failure summary and does not offer retry while recovering', () => {
    expect(render({ status: 'error', error: '服务暂不可用' })).toContain('服务暂不可用')
    const recovering = render({ status: 'error', customRecoverable: true })
    expect(recovering).not.toContain('aria-label="重试任务"')
    expect(recovering).not.toContain('生成失败')
  })
})
