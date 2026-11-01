import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const state = vi.hoisted(() => ({
  appMode: 'gallery',
  setAppMode: vi.fn(),
  setShowSettings: vi.fn(),
  setUpscaleDialog: vi.fn(),
  agentMobileHeaderVisible: true,
  agentConversations: [],
  activeAgentConversationId: null,
  createAgentConversation: vi.fn(),
  setAgentEditingConversationId: vi.fn(),
  settings: { theme: 'light' },
  setSettings: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../hooks/useTooltip', () => ({
  useTooltip: () => ({ visible: true, handlers: {}, dismiss: vi.fn() }),
}))
vi.mock('./ViewportTooltip', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role="tooltip">{children}</div> : null,
}))

import Header from './Header'

describe('header upscale entry', () => {
  it('places the 8K action beside the gallery entry in desktop and mobile navigation', () => {
    const html = renderToStaticMarkup(<Header />)
    const galleryButtons = [...html.matchAll(/>画廊<\/button>/g)].map((match) => match.index!)
    const upscaleButtons = [...html.matchAll(/aria-label="高清放大"/g)].map((match) => match.index!)
    const videoButtons = [...html.matchAll(/>视频<\/button>/g)].map((match) => match.index!)

    expect(galleryButtons[0]).toBeLessThan(upscaleButtons[0])
    expect(upscaleButtons[0]).toBeLessThan(videoButtons[0])
    expect(galleryButtons[1]).toBeLessThan(upscaleButtons[1])
    expect(upscaleButtons[1]).toBeLessThan(videoButtons[1])
    expect(html).toContain('src="./8k-ultra-hd.svg"')
    expect(html).toContain('>8K超清</span>')
    expect(html.match(/w-\[20px\] shrink-0/g)).toHaveLength(2)
    expect(html.match(/text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-amber-400\/10 dark:hover:text-amber-200/g)).toHaveLength(2)
    expect(html).not.toContain('bg-amber-300')
  })

  it('explains what each navigation action does', () => {
    const html = renderToStaticMarkup(<Header />)

    expect(html).toContain('图片生成，最新的顶级生图模型')
    expect(html).toContain('提升图片的清晰度，最高8K超清')
    expect(html).toContain('视频生成，多种视频模型')
    expect(html).toContain('通过对话生成、编辑图片')
  })
})
