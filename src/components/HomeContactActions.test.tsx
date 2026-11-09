// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HomeContactActions, { CustomerSupportDialog } from './HomeContactActions'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mountActions() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<HomeContactHarness />))
  return container
}

function HomeContactHarness() {
  const [supportOpen, setSupportOpen] = useState(false)
  return (
    <>
      <HomeContactActions placement="desktop" onOpenSupport={() => setSupportOpen(true)} />
      <HomeContactActions placement="mobile" onOpenSupport={() => setSupportOpen(true)} />
      <CustomerSupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} />
    </>
  )
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('home contact actions', () => {
  it('links to purchase in a separate safe browser tab and opens the support QR dialog', () => {
    const view = mountActions()
    const purchaseLink = view.querySelector<HTMLAnchorElement>('[data-home-contact-actions="desktop"] a[aria-label="购买"]')
    expect(purchaseLink?.getAttribute('href')).toBe('https://item.taobao.com/item.htm?id=1058856152173')
    expect(purchaseLink?.getAttribute('target')).toBe('_blank')
    expect(purchaseLink?.getAttribute('rel')).toBe('noopener noreferrer')

    const supportButton = view.querySelector<HTMLButtonElement>('[data-home-contact-actions="desktop"] button[aria-label="客服"]')
    expect(supportButton).not.toBeNull()
    act(() => supportButton?.click())

    const dialog = document.body.querySelector('[role="dialog"][aria-label="联系客服"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe('/wechat.png')
  })

  it('closes the support dialog with Escape and its close button', () => {
    const view = mountActions()
    const supportButton = view.querySelector<HTMLButtonElement>('[data-home-contact-actions="mobile"] button[aria-label="客服"]')
    act(() => supportButton?.click())
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    act(() => supportButton?.click())
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭客服窗口"]')
    act(() => closeButton?.click())
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the mobile contact buttons labeled in a separate compact row', () => {
    const view = mountActions()
    const mobileActions = view.querySelector('[data-home-contact-actions="mobile"]')

    expect(mobileActions?.textContent).toContain('购买')
    expect(mobileActions?.textContent).toContain('客服')
  })
})
