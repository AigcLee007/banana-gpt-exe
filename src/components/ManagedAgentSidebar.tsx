import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AgentConversation } from '../types'
import { getManagedAgentRenameKeyAction, getManagedAgentRenameTitle, groupManagedAgentConversations } from '../lib/managedAgentHistory'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import WorkspacePreferences from './WorkspacePreferences'
import WorkspaceDataDialog from './WorkspaceDataDialog'
import { CloseIcon, EditIcon, HistoryIcon, SettingsIcon, SidebarLeftIcon, TrashIcon } from './icons'
import './ManagedAgentSidebar.css'

export interface ManagedAgentSidebarProps {
  conversations: AgentConversation[]
  activeId: string | null
  collapsed: boolean
  mobileOpen: boolean
  query: string
  onQueryChange: (query: string) => void
  onCreate: () => void
  onSelect: (id: string) => void
  onToggle: () => void
  onCloseMobile: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  generatingTitleIds: Record<string, boolean>
  historyRef: RefObject<HTMLElement | null>
}

type SidebarMenu = { kind: 'conversation'; id: string } | { kind: 'settings' }

export default function ManagedAgentSidebar({
  conversations, activeId, collapsed, mobileOpen, query, onQueryChange, onCreate, onSelect,
  onToggle, onCloseMobile, onRename, onDelete, generatingTitleIds, historyRef,
}: ManagedAgentSidebarProps) {
  const [menu, setMenu] = useState<SidebarMenu | null>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const [panel, setPanel] = useState<'preferences' | 'data' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [today, setToday] = useState(() => new Date())
  const [mobileViewport, setMobileViewport] = useState(false)
  const [deleteRequestedId, setDeleteRequestedId] = useState<string | null>(null)
  const confirmDialog = useStore(state => state.confirmDialog)
  const managedDeleteDialog = deleteRequestedId && confirmDialog?.title === '删除对话' ? confirmDialog : null
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const editingIdRef = useRef<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const groups = useMemo(() => groupManagedAgentConversations(conversations, today), [conversations, today])
  const scrollBoundaries = useMemo(() => [historyRef, menuRef], [historyRef])
  const menuConversation = menu?.kind === 'conversation' ? conversations.find(item => item.id === menu.id) : null

  const focusVisible = (target: HTMLElement | null) => {
    if (target?.isConnected && target.getClientRects().length > 0) target.focus({ preventScroll: true })
  }
  const closeMenu = (restoreFocus = true) => {
    setMenu(null)
    if (restoreFocus) focusVisible(menuTriggerRef.current)
  }
  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    pointerOriginRef.current = null
  }
  const cancelRename = () => {
    editingIdRef.current = null
    setEditingId(null)
  }
  const commitRename = (restoreFocus = false) => {
    const id = editingIdRef.current
    editingIdRef.current = null
    setEditingId(null)
    const item = conversations.find(conversation => conversation.id === id)
    if (!item) return
    const nextTitle = getManagedAgentRenameTitle(item, title, generatingTitleIds)
    if (nextTitle !== null) onRename(item.id, nextTitle)
    if (restoreFocus) focusVisible(menuTriggerRef.current)
  }
  const startRename = (item: AgentConversation) => {
    if (generatingTitleIds[item.id]) return
    closeMenu(false)
    editingIdRef.current = item.id
    setTitle(item.title)
    setEditingId(item.id)
  }
  const openMenu = (next: SidebarMenu, trigger: HTMLButtonElement) => {
    clearLongPress()
    menuTriggerRef.current = trigger
    setMenu(next)
  }
  const openPanel = (next: 'preferences' | 'data', trigger: HTMLButtonElement) => {
    panelTriggerRef.current = menu?.kind === 'settings' ? menuTriggerRef.current : trigger
    closeMenu(false)
    setPanel(next)
  }
  const closePanel = () => {
    setPanel(null)
    focusVisible(panelTriggerRef.current)
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setMobileViewport(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const now = new Date()
      setToday(now)
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(schedule, nextMidnight.getTime() - now.getTime() + 10)
    }
    schedule()
    const refresh = () => { if (!document.hidden) { clearTimeout(timer); schedule() } }
    document.addEventListener('visibilitychange', refresh)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  useEffect(() => () => clearLongPress(), [])
  useEffect(() => { closeMenu(false); cancelRename() }, [collapsed, mobileOpen, query])
  useEffect(() => {
    if (!editingId) return
    renameInputRef.current?.focus({ preventScroll: true })
    renameInputRef.current?.select()
  }, [editingId])
  useEffect(() => {
    if (editingId && (!conversations.some(item => item.id === editingId) || generatingTitleIds[editingId])) cancelRename()
  }, [editingId, generatingTitleIds, conversations])

  usePreventBackgroundScroll(mobileOpen && mobileViewport && panel === null && !managedDeleteDialog, scrollBoundaries)
  useCloseOnEscape(mobileOpen && mobileViewport && !panel && !managedDeleteDialog && !menu && !editingId, onCloseMobile)
  useCloseOnEscape(Boolean(menu), () => closeMenu())

  useEffect(() => {
    if (!mobileOpen || !mobileViewport) return
    const history = historyRef.current
    if (!history) return
    const previous = document.activeElement as HTMLElement | null
    history.querySelector<HTMLButtonElement>('[data-agent-mobile-close]')?.focus({ preventScroll: true })
    return () => {
      focusVisible(previous)
    }
  }, [mobileOpen, mobileViewport, historyRef])

  useEffect(() => {
    const history = historyRef.current
    if (!history) return
    if (mobileOpen && mobileViewport && !panel && !managedDeleteDialog) {
      history.setAttribute('role', 'dialog')
      history.setAttribute('aria-modal', 'true')
    } else {
      history.removeAttribute('role')
      history.removeAttribute('aria-modal')
    }
    return () => { history.removeAttribute('role'); history.removeAttribute('aria-modal') }
  }, [mobileOpen, mobileViewport, panel, managedDeleteDialog, historyRef])

  useEffect(() => {
    if (deleteRequestedId && !confirmDialog) setDeleteRequestedId(null)
  }, [deleteRequestedId, confirmDialog])

  useEffect(() => {
    if (!managedDeleteDialog) return
    // Bridge only a deletion launched by this managed sidebar; keep the shared dialog unchanged.
    const heading = [...document.querySelectorAll<HTMLElement>('[data-no-drag-select] h3')]
      .find(element => element.textContent?.trim() === managedDeleteDialog.title)
    const dialog = heading?.parentElement
    if (!dialog) return
    const restoreTarget = menuTriggerRef.current
    const attributes = ['role', 'aria-modal', 'aria-label', 'tabindex', 'data-aap-agent-confirm'] as const
    const previousAttributes = attributes.map(attribute => [attribute, dialog.getAttribute(attribute)] as const)
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', managedDeleteDialog.title)
    dialog.setAttribute('tabindex', '-1')
    dialog.setAttribute('data-aap-agent-confirm', 'true')
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0)
    const cancel = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === (managedDeleteDialog.cancelText ?? '取消'))
    ;(cancel ?? controls()[0] ?? dialog).focus({ preventScroll: true })
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = controls(), first = items[0], last = items[items.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }
    const keepFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (cancel ?? controls()[0] ?? dialog).focus({ preventScroll: true })
    }
    dialog.addEventListener('keydown', keyboard)
    document.addEventListener('focusin', keepFocus)
    return () => {
      dialog.removeEventListener('keydown', keyboard)
      document.removeEventListener('focusin', keepFocus)
      previousAttributes.forEach(([attribute, value]) => { if (value === null) dialog.removeAttribute(attribute); else dialog.setAttribute(attribute, value) })
      if (restoreTarget?.isConnected && restoreTarget.getClientRects().length > 0) focusVisible(restoreTarget)
      else {
        const fallback = [...(historyRef.current?.querySelectorAll<HTMLElement>('button[aria-current="page"],button') ?? [])]
          .find(element => element.getClientRects().length > 0)
        focusVisible(fallback ?? null)
      }
    }
  }, [managedDeleteDialog, historyRef])

  useEffect(() => {
    if (!menu) return
    const place = () => {
      const rect = menuTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const barHeight = parseFloat(getComputedStyle(document.body).getPropertyValue('--aap-bar-h')) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--aap-bar-h')) || 0
      if (rect.bottom < barHeight || rect.top > innerHeight) { closeMenu(false); return }
      const height = menuRef.current?.offsetHeight || 96
      const width = menuRef.current?.offsetWidth || 192
      setMenuPosition({
        top: Math.max(barHeight + 8, Math.min(rect.bottom + 5, innerHeight - height - 12)),
        left: Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)),
      })
    }
    place()
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !menuTriggerRef.current?.contains(target)) closeMenu(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [menu])

  const handleRowPointerDown = (item: AgentConversation, event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || editingId || (event.target as HTMLElement).closest('[data-agent-conversation-more]')) return
    clearLongPress()
    suppressClickRef.current = null
    pointerOriginRef.current = { x: event.clientX, y: event.clientY }
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>('[data-agent-conversation-more]')
    longPressTimerRef.current = setTimeout(() => {
      if (!trigger) return
      suppressClickRef.current = item.id
      openMenu({ kind: 'conversation', id: item.id }, trigger)
    }, 450)
  }
  const handleMenuKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (event.key === 'Tab') { event.preventDefault(); closeMenu(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
  }

  return <>
    <aside
      ref={historyRef} id="agent-conversation-history" data-aap-agent-sidebar="true"
      data-collapsed={String(collapsed)} data-mobile-open={String(mobileOpen)}
      aria-label="Agent 会话列表" className="aap-managed-agent-sidebar" tabIndex={-1}
      onKeyDown={event => {
        if (panel || managedDeleteDialog || !historyRef.current?.contains(event.target as Node)) return
        if (editingId && getManagedAgentRenameKeyAction(event.key, event.nativeEvent.isComposing) === 'cancel') { event.preventDefault(); event.stopPropagation(); cancelRename(); return }
        if (!mobileOpen || !mobileViewport || event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(item => item.getClientRects().length > 0)
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === historyRef.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === historyRef.current)) { event.preventDefault(); first.focus() }
      }}
    >
      <div data-aap-agent-history="true" className="aap-agent-history-expanded">
        <div className="aap-agent-sidebar-top">
          <button type="button" data-agent-mobile-close aria-label="关闭会话历史" title="关闭会话历史" className="aap-agent-icon-button aap-agent-mobile-close" onClick={onCloseMobile}><CloseIcon aria-hidden="true" /></button>
          <button type="button" aria-label="折叠会话列表" title="折叠会话列表" aria-expanded={!collapsed} aria-controls="agent-conversation-history" className="aap-agent-icon-button aap-agent-desktop-toggle" onClick={onToggle}><SidebarLeftIcon aria-hidden="true" /></button>
          <span className="aap-agent-sidebar-heading">Agent</span>
          <button type="button" data-aap-agent-new aria-label="新对话" title="新对话" className="aap-agent-icon-button" onClick={onCreate}><EditIcon aria-hidden="true" /></button>
        </div>
        <div className="aap-agent-history-search"><input type="search" aria-label="搜索会话" placeholder="搜索标题或对话内容" value={query} onChange={event => onQueryChange(event.target.value)} /></div>
        <div className="aap-agent-history-list" onScroll={clearLongPress}>
          {groups.length === 0 && <p className="aap-agent-history-empty">{query.trim() ? '没有找到匹配的会话' : '还没有会话，开始一次创作吧'}</p>}
          {groups.map(group => <section key={group.key} aria-label={group.label} className="aap-agent-history-group">
            <h3>{group.label}</h3>
            {group.conversations.map(item => <div
              key={item.id} data-agent-conversation-item data-active={item.id === activeId || undefined}
              data-menu-open={menu?.kind === 'conversation' && menu.id === item.id || undefined}
              className="aap-agent-history-row"
              onPointerDown={event => handleRowPointerDown(item, event)}
              onPointerMove={event => { const origin = pointerOriginRef.current; if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) clearLongPress() }}
              onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress}
              onContextMenu={event => { event.preventDefault(); const trigger = event.currentTarget.querySelector<HTMLButtonElement>('[data-agent-conversation-more]'); if (trigger) openMenu({ kind: 'conversation', id: item.id }, trigger) }}
            >
              {editingId === item.id ? <input
                ref={renameInputRef} aria-label="会话标题" className="aap-agent-rename-input" value={title}
                onChange={event => setTitle(event.target.value)} onBlur={() => commitRename()}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) { event.stopPropagation(); return }
                  const action = getManagedAgentRenameKeyAction(event.key, event.nativeEvent.isComposing)
                  if (action === 'commit') { event.preventDefault(); event.stopPropagation(); commitRename(true) }
                  else if (action === 'cancel') { event.preventDefault(); event.stopPropagation(); cancelRename(); focusVisible(menuTriggerRef.current) }
                }}
              /> : <button type="button" className="aap-agent-history-title" title={item.title} aria-current={item.id === activeId ? 'page' : undefined} onClick={event => {
                if (suppressClickRef.current === item.id) { suppressClickRef.current = null; event.preventDefault(); return }
                closeMenu(false); onSelect(item.id)
              }}>{item.title || '新对话'}</button>}
              <button
                type="button" data-agent-conversation-more aria-label={`${item.title || '新对话'}的更多操作`}
                aria-haspopup="menu" aria-expanded={menu?.kind === 'conversation' && menu.id === item.id}
                aria-controls={menu?.kind === 'conversation' && menu.id === item.id ? menuId : undefined}
                className="aap-agent-icon-button aap-agent-history-more"
                onClick={event => { event.stopPropagation(); if (menu?.kind === 'conversation' && menu.id === item.id) closeMenu(); else openMenu({ kind: 'conversation', id: item.id }, event.currentTarget) }}
                onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openMenu({ kind: 'conversation', id: item.id }, event.currentTarget) } }}
              ><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg></button>
            </div>)}
          </section>)}
        </div>
        <div className="aap-agent-sidebar-footer">
          <button type="button" onClick={event => openPanel('preferences', event.currentTarget)}><SettingsIcon aria-hidden="true" /><span>对话偏好</span></button>
          <button type="button" onClick={event => openPanel('data', event.currentTarget)}><HistoryIcon aria-hidden="true" /><span>本机数据管理</span></button>
        </div>
      </div>
      <div data-aap-agent-rail="true" className="aap-agent-sidebar-rail">
        <button type="button" aria-label="展开会话列表" title="展开会话列表" aria-expanded={!collapsed} aria-controls="agent-conversation-history" className="aap-agent-icon-button" onClick={onToggle}><SidebarLeftIcon aria-hidden="true" /></button>
        <button type="button" aria-label="新对话" title="新对话" className="aap-agent-icon-button" onClick={onCreate}><EditIcon aria-hidden="true" /></button>
        <button type="button" aria-label="Agent 设置" title="Agent 设置" aria-haspopup="menu" aria-expanded={menu?.kind === 'settings'} aria-controls={menu?.kind === 'settings' ? menuId : undefined} className="aap-agent-icon-button aap-agent-rail-settings" onClick={event => { if (menu?.kind === 'settings') closeMenu(); else openMenu({ kind: 'settings' }, event.currentTarget) }}><SettingsIcon aria-hidden="true" /></button>
      </div>
    </aside>
    {menu && createPortal(<div ref={menuRef} id={menuId} role="menu" aria-label={menu.kind === 'settings' ? 'Agent 设置' : '会话操作'} data-aap-agent-menu className="aap-agent-sidebar-menu" style={menuPosition} onKeyDown={handleMenuKeyboard}>
      {menu.kind === 'settings' ? <>
        <button type="button" role="menuitem" onClick={event => openPanel('preferences', event.currentTarget)}><SettingsIcon aria-hidden="true" />对话偏好</button>
        <button type="button" role="menuitem" onClick={event => openPanel('data', event.currentTarget)}><HistoryIcon aria-hidden="true" />本机数据管理</button>
      </> : menuConversation && <>
        <button type="button" role="menuitem" disabled={Boolean(generatingTitleIds[menuConversation.id])} title={generatingTitleIds[menuConversation.id] ? '标题生成中，暂不能修改标题' : undefined} onClick={() => startRename(menuConversation)}><EditIcon aria-hidden="true" />重命名</button>
        <button type="button" role="menuitem" className="aap-agent-menu-delete" onClick={() => { closeMenu(); setDeleteRequestedId(menuConversation.id); onDelete(menuConversation.id) }}><TrashIcon aria-hidden="true" />删除</button>
      </>}
    </div>, document.body)}
    {panel === 'preferences' && <WorkspacePreferences mode="agent" onClose={closePanel} />}
    {panel === 'data' && <WorkspaceDataDialog mode="agent" onClose={closePanel} />}
  </>
}
