import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('react-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-dom')>()
  return { ...original, createPortal: (content: React.ReactNode) => content }
})

import ViewportTooltip from './ViewportTooltip'

describe('ViewportTooltip presentation', () => {
  it('uses app theme tokens and sizes to its content within the viewport', () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body: {} },
    })

    const html = renderToStaticMarkup(<ViewportTooltip visible>短提示</ViewportTooltip>)

    expect(html).toContain('background-color:var(--app-surface-elevated)')
    expect(html).toContain('color:var(--app-text)')
    expect(html).toContain('border-color:var(--app-border)')
    expect(html).toContain('width:max-content')
    expect(html).toContain('max-width:min(20rem, calc(100vw - 2rem))')
    expect(html).toContain('border-top-color:var(--app-surface-elevated)')
    expect(html).not.toContain('bg-gray-800')
  })
})
