import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentConversation } from '../types'

vi.mock('./WorkspacePreferences', () => ({ default: () => null }))
vi.mock('./WorkspaceDataDialog', () => ({ default: () => null }))
vi.mock('../store', () => ({ useStore: (selector: (state: { confirmDialog: null }) => unknown) => selector({ confirmDialog: null }) }))
import ManagedAgentSidebar from './ManagedAgentSidebar'

function render(conversations: AgentConversation[] = [], collapsed = false) {
  return renderToStaticMarkup(<ManagedAgentSidebar
    conversations={conversations} activeId="active" collapsed={collapsed} mobileOpen={false} query=""
    onQueryChange={() => {}} onCreate={() => {}} onSelect={() => {}} onToggle={() => {}} onCloseMobile={() => {}}
    onRename={() => {}} onDelete={() => {}} generatingTitleIds={{}} historyRef={{ current: null }}
  />)
}

describe('managed Agent sidebar', () => {
  it('provides named quiet creation, search, history and direct footer controls', () => {
    const html = render()
    expect(html).toContain('aria-label="Agent 会话列表"')
    expect(html).toContain('data-aap-agent-new')
    expect(html).toContain('aria-label="搜索会话"')
    expect(html).toContain('aria-label="关闭会话历史"')
    expect(html).toContain('>对话偏好</span>')
    expect(html).toContain('>本机数据管理</span>')
  })

  it('shows grouped title-only rows with accessible more actions and an active state', () => {
    const now = Date.now()
    const html = render([{ id: 'active', title: '产品摄影', createdAt: now, updatedAt: now, rounds: [], messages: [] }])
    expect(html).toContain('>今天</h3>')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="产品摄影的更多操作"')
    expect(html).not.toContain('<time')
    expect(html).not.toContain(new Date(now).toLocaleString())
  })

  it('keeps expansion, creation and settings accessible in the collapsed rail', () => {
    const html = render([], true)
    const rail = html.split('data-aap-agent-rail="true"')[1]
    expect(html).toContain('data-collapsed="true"')
    expect(rail).toContain('aria-label="展开会话列表"')
    expect(rail).toContain('aria-label="新对话"')
    expect(rail).toContain('aria-label="Agent 设置"')
  })
})
