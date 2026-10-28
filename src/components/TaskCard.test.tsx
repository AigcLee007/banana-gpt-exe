import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ settings: {}, streamPreviews: {}, toggleTaskSelection: vi.fn() }),
  ensureImageThumbnailCached: vi.fn(), subscribeImageThumbnail: vi.fn(), updateTaskInStore: vi.fn(), retryTask: vi.fn(),
}))
import TaskCard from './TaskCard'

const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task', prompt: 'A fox walking', params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null, ...patch,
})
const render = (patch: Partial<TaskRecord> = {}, isSelected = false) => renderToStaticMarkup(
  <TaskCard task={task(patch)} isSelected={isSelected} onClick={vi.fn()} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} />,
)

describe('gallery task feedback', () => {
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
