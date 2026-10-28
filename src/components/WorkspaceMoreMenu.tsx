import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import WorkspacePreferences from './WorkspacePreferences'
import WorkspaceDataDialog from './WorkspaceDataDialog'

export default function WorkspaceMoreMenu({ mode, section = 'all' }: { mode: AppMode; section?: 'all' | 'creation' | 'works' }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<'preferences' | 'data' | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const closeMenu = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  useCloseOnEscape(open, closeMenu)
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const height = menu.current?.offsetHeight ?? 210
      const floor = parseFloat(getComputedStyle(document.body).getPropertyValue('--aap-bar-h')) || 0
      if (rect.bottom < floor || rect.top > innerHeight) { closeMenu(); return }
      setPosition({ top: Math.max(floor + 8, Math.min(rect.bottom + 6, innerHeight - height - 12)), left: Math.max(12, Math.min(rect.right - 208, innerWidth - 220)) })
    }
    place()
    menu.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  const name = mode === 'gallery' ? '画廊' : mode === 'video' ? section === 'creation' ? '视频创作' : '视频作品' : 'Agent'
  const itemClass = 'block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[color:var(--app-bg-soft)] focus-visible:bg-[color:var(--app-bg-soft)] focus-visible:outline-none'
  return <>
    <button ref={trigger} type="button" aria-label={`${name}更多操作`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-bg-soft)] focus-visible:ring-2 focus-visible:ring-blue-400"><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg></button>
    {open && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={`${name}更多操作`} style={position} className="fixed z-[1100] w-52 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-1.5 text-[color:var(--app-text)] shadow-xl" onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
      if (event.key === 'Tab') { setOpen(false); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }}>
      {section !== 'works' && <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); setPanel('preferences') }}>{mode === 'agent' ? '对话偏好' : '创作偏好'}</button>}
      {section !== 'creation' && <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); setPanel('data') }}>本机数据管理</button>}
    </div>, document.body)}
    {panel === 'preferences' && <WorkspacePreferences mode={mode} onClose={() => { setPanel(null); trigger.current?.focus() }} />}
    {panel === 'data' && <WorkspaceDataDialog mode={mode} onClose={() => { setPanel(null); trigger.current?.focus() }} />}
  </>
}
