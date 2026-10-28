import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../videoStore', () => ({ useVideoStore: () => ({ tasks: [], selectedTaskIds: new Set() }) }))
vi.mock('../store', () => ({ useStore: () => vi.fn() }))
vi.mock('./VideoTaskCard', () => ({ default: () => null }))
import VideoTaskGrid from './VideoTaskGrid'

describe('video task collection', () => {
  it('offers explicit filters and a useful empty-state next step', () => {
    const html = renderToStaticMarkup(<VideoTaskGrid />)
    for (const label of ['排队中', '生成中', '处理中', '已完成', '失败', '已停止']) expect(html).toContain(label)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="搜索视频任务"')
    expect(html).toContain('填写提示词')
  })
})
