import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './icons'

export const workspaceControlClass = 'rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2 text-sm text-[color:var(--app-text)] outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40'

export default function WorkspaceDialog({ title, onClose, children, busy = false, suspended = false, wide = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; suspended?: boolean; wide?: boolean }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = () => { if (!busy) onClose() }
  useCloseOnEscape(!suspended, close)
  usePreventBackgroundScroll(!suspended, panel)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(
    <div inert={suspended || undefined} className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40 px-3 pb-3 backdrop-blur-sm sm:items-center sm:pb-6" style={{ paddingTop: 'calc(var(--aap-bar-h,0px) + 16px)' }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`flex max-h-[calc(100dvh-var(--aap-bar-h,0px)-2rem)] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col overflow-y-auto rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] text-[color:var(--app-text)] shadow-2xl outline-none`} onKeyDown={event => {
        if (event.key !== 'Tab') return
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')].filter(el => !el.matches(':disabled') && el.getClientRects().length > 0)
        const first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }}>
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--app-border)] px-5 py-4">
          <h2 id={titleId} className="font-semibold">{title}</h2>
          <button type="button" aria-label="关闭面板" disabled={busy} onClick={close} className="rounded-lg p-2 text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-bg-soft)] disabled:opacity-40"><CloseIcon className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">{children}</div>
      </div>
    </div>, document.body,
  )
}

export function PreferenceSwitch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-start justify-between gap-5"><div><span className="text-sm font-medium">{label}</span>{description && <p className="mt-1 text-xs leading-relaxed text-[color:var(--app-text-muted)]">{description}</p>}</div><button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={`mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-1 ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}><span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} /></button></div>
}
