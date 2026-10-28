import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentConversation, AgentRound, TaskRecord } from '../types'

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(fixture.state), { getState: () => fixture.state }),
  getActiveAgentRounds: (conversation: AgentConversation) => conversation.rounds,
  getAgentSiblingRounds: (_conversation: AgentConversation, round: AgentRound) => [round],
  getCachedImage: () => '',
  ensureImageCached: vi.fn(),
  deleteAgentRoundFromConversation: vi.fn(), editOutputs: vi.fn(), getAgentBranchLeafId: vi.fn(),
  regenerateAgentAssistantMessage: vi.fn(), remapAgentRoundMentionsForPathChange: vi.fn(),
  removeMultipleTasks: vi.fn(), removeTask: vi.fn(), reuseConfig: vi.fn(), updateTaskInStore: vi.fn(), stopAgentResponse: vi.fn(),
}))
vi.mock('./TaskCard', () => ({ default: () => <div>图片任务</div> }))
vi.mock('./MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }))
vi.mock('./ViewportTooltip', () => ({ default: () => null }))
import AgentWorkspace from './AgentWorkspace'

let conversation: AgentConversation
let round: AgentRound
beforeEach(() => {
  vi.unstubAllGlobals()
  round = { id: 'r1', index: 1, userMessageId: 'u1', assistantMessageId: 'a1', prompt: '拍摄一组产品照', inputImageIds: [], outputTaskIds: [], status: 'done', error: null, createdAt: 1, finishedAt: 2 }
  conversation = { id: 'c1', title: '产品摄影', createdAt: 1, updatedAt: 2, rounds: [round], messages: [
    { id: 'u1', roundId: 'r1', role: 'user', content: '拍摄一组产品照', createdAt: 1 },
    { id: 'a1', roundId: 'r1', role: 'assistant', content: '已完成', createdAt: 2 },
  ] }
  fixture.state = {
    agentConversations: [conversation], agentConversationsLoaded: true, activeAgentConversationId: 'c1',
    agentSidebarCollapsed: true, agentMobileHeaderVisible: false, appMode: 'agent', tasks: [],
    settings: {}, agentGeneratingTitleIds: {},
  }
})
afterEach(() => vi.unstubAllGlobals())

const render = () => renderToStaticMarkup(<AgentWorkspace />)
describe('Agent conversation workbench', () => {
  it('uses one managed new conversation action in the sidebar and a compact title toolbar', () => {
    vi.stubGlobal('window', { __AAP__: { baseUrl: '/gw' } })
    const html = render()
    expect(html).toContain('data-aap-agent-workspace="expanded"')
    expect(html).toContain('data-aap-agent-sidebar')
    const desktopToolbar = html.split('data-agent-desktop-toolbar')[1].split('data-agent-mobile-toolbar')[0]
    expect(desktopToolbar).not.toContain('新对话')
    expect(html).toContain('折叠会话列表')
    expect(html).toContain('data-aap-agent-new')
    expect(html).toContain('data-aap-agent-content')
  })

  it('keeps managed content and the composer on the same 800px axis with a 260px sidebar', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const input = readFileSync(new URL('./InputBar.tsx', import.meta.url), 'utf8')
    expect(css).toContain('--aap-agent-sidebar-width: 260px')
    expect(css).toContain('max-width: 800px')
    expect(css).toContain('[data-aap-agent-composer]')
    expect(input).toContain('data-aap-agent-composer')
    expect(css).toContain('calc(50% + var(--aap-agent-sidebar-width) / 2)')
  })
  it('keeps desktop history available even when the mobile drawer is closed', () => {
    const html = render()
    expect(html).toContain('aria-label="Agent 会话列表"')
    expect(html).toContain('lg:sticky')
    expect(html).toContain('aria-label="搜索会话"')
    expect(html).toContain('aria-current="page"')
  })

  it('provides named desktop history and new conversation controls', () => {
    const html = render()
    expect(html).toContain('aria-label="折叠会话列表"')
    expect(html).toContain('>新对话</')
  })

  it('shows a retry action for a failed response and no retry for a running response', () => {
    round.status = 'error'
    round.error = '网络中断'
    expect(render()).toContain('aria-label="重试本轮"')
    round.status = 'running'
    const html = render()
    expect(html).toContain('aria-label="停止生成"')
    expect(html).not.toContain('aria-label="重试本轮"')
  })

  it('offers a stop control before the first streamed assistant message arrives', () => {
    round.status = 'running'
    conversation.messages = conversation.messages.filter(message => message.role === 'user')
    expect(render()).toContain('aria-label="停止生成"')
  })

  it('disables downloading while a task has no actual output image', () => {
    round.outputTaskIds = ['t1']
    fixture.state.tasks = [{ id: 't1', status: 'error', outputImages: [] } as unknown as TaskRecord]
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*aria-label="下载所有图片"/)
  })

  it('offers output continuation and gallery navigation for generated images', () => {
    round.outputTaskIds = ['t1']
    fixture.state.tasks = [{ id: 't1', status: 'done', outputImages: ['img1'] } as unknown as TaskRecord]
    const html = render()
    expect(html).toContain('aria-label="继续修改图片"')
    expect(html).toContain('aria-label="在画廊查看"')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="下载所有图片"/)
  })

  it('keeps response actions visible for keyboard navigation', () => {
    expect(render()).toContain('lg:group-focus-within:opacity-100')
  })

  it('offers manual answer saving only for completed managed assistant answers', () => {
    expect(render()).not.toContain('保存回答到素材库')
    vi.stubGlobal('window', { __AAP__: { baseUrl: '/gw' } })
    expect(render()).toContain('aria-label="保存回答到素材库"')
    round.status = 'running'
    expect(render()).not.toContain('保存回答到素材库')
    round.status = 'error'
    expect(render()).not.toContain('保存回答到素材库')
  })

  it('offers editable starter prompts for an empty conversation', () => {
    conversation.rounds = []
    conversation.messages = []
    expect(render()).toContain('选择示例，开始创作')
    expect(render()).toContain('产品摄影')
    expect(render()).toContain('海报设计')
  })

  it('removes the empty managed title toolbar and shows three explained capability starters', () => {
    vi.stubGlobal('window', { __AAP__: { baseUrl: '/gw' } })
    conversation.rounds = []
    conversation.messages = []
    const html = render()
    expect(html).not.toContain('data-agent-desktop-toolbar')
    expect(html).toContain('先聊方案，再开始创作')
    expect(html).toContain('产品实拍，生成电商套图')
    expect(html).toContain('围绕参考图持续修改')
    expect(html).toContain('确认方向后再生成')
    expect(html).toContain('data-aap-agent-start')
    expect(html).toContain('aria-label="展开输入框"')
    expect(html).not.toContain('data-aap-agent-welcome-hidden-description')
  })

  it('keeps a compact title only once messages exist and retains standalone starters', () => {
    vi.stubGlobal('window', { __AAP__: { baseUrl: '/gw' } })
    expect(render()).toContain('data-agent-desktop-toolbar')
    expect(render()).toContain('>电商套图</button>')
    expect(render()).not.toContain('data-aap-agent-start')
    vi.unstubAllGlobals()
    conversation.messages = []
    conversation.rounds = []
    expect(render()).toContain('data-agent-desktop-toolbar')
    expect(render()).toContain('海报设计')
    expect(render()).not.toContain('>电商套图</button>')
  })
})
