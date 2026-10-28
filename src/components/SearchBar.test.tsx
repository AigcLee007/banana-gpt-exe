import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('../store', () => ({ useStore: (selector: (value: unknown) => unknown) => selector(state.current), clearFailedTasks: vi.fn() }))
import SearchBar from './SearchBar'
const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'task', prompt: 'A fox', params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null, ...patch,
})

describe('gallery filters', () => {
  it('displays status counts and includes recoverable tasks in generating', () => {
    state.current = {
      searchQuery: '', filterStatus: 'all', filterFavorite: false,
      tasks: [task(), task({ id: 'recovering', status: 'error', customRecoverable: true }), task({ id: 'done', status: 'done' })],
    }
    const html = renderToStaticMarkup(<SearchBar />)
    expect(html).toContain('生成中 (2)')
    expect(html).toContain('已完成 (1)')
    expect(html).toContain('失败 (0)')
    expect(html).toContain('aria-label="搜索画廊记录"')
    expect(html).toContain('批量选择')
  })

  it('offers reset when no records match a filter', () => {
    state.current = { searchQuery: 'missing', filterStatus: 'error', filterFavorite: true, tasks: [] }
    expect(renderToStaticMarkup(<SearchBar />)).toContain('重置筛选')
  })
})
