import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, HeadsetIcon, ShoppingCartIcon } from './icons'

const PURCHASE_URL = 'https://item.taobao.com/item.htm?id=1058856152173'

interface HomeContactActionsProps {
  placement: 'desktop' | 'mobile'
  onOpenSupport: () => void
}

export default function HomeContactActions({ placement, onOpenSupport }: HomeContactActionsProps) {
  const isMobile = placement === 'mobile'
  const purchaseClass = isMobile
    ? 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300/70 bg-amber-50 px-2 text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20'
    : 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-amber-300/70 bg-amber-50 px-1.5 text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20 sm:h-9 sm:gap-1.5 sm:px-2.5'
  const supportClass = isMobile
    ? 'inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-300/70 bg-emerald-50 px-2 text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20'
    : 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-emerald-300/70 bg-emerald-50 px-1.5 text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20 sm:h-9 sm:gap-1.5 sm:px-2.5'

  return (
    <div
      data-home-contact-actions={placement}
      className={isMobile ? 'grid grid-cols-2 gap-2 px-2 pb-1 sm:hidden' : 'hidden shrink-0 items-center gap-0.5 sm:flex sm:gap-1'}
    >
      <a
        href={PURCHASE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="购买"
        title="购买"
        className={purchaseClass}
      >
        <ShoppingCartIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={isMobile ? 'text-xs font-medium' : 'hidden text-sm font-medium lg:inline'}>购买</span>
      </a>
      <button
        type="button"
        onClick={onOpenSupport}
        aria-label="客服"
        aria-haspopup="dialog"
        title="客服"
        className={supportClass}
      >
        <HeadsetIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={isMobile ? 'text-xs font-medium' : 'hidden text-sm font-medium lg:inline'}>客服</span>
      </button>
    </div>
  )
}

interface CustomerSupportDialogProps {
  open: boolean
  onClose: () => void
}

export function CustomerSupportDialog({ open, onClose }: CustomerSupportDialogProps) {
  useCloseOnEscape(open, onClose)
  usePreventBackgroundScroll(open)

  if (!open) return null

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="联系客服"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-[color:var(--app-border)] bg-[var(--app-surface-elevated)] p-5 text-center shadow-[var(--app-shadow)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭客服窗口"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-[color:var(--app-text-muted)] transition-colors hover:bg-[var(--app-bg-soft)] hover:text-[color:var(--app-text)]"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <h2 className="pt-1 text-lg font-semibold text-[color:var(--app-text)]">联系客服</h2>
        <img
          src="/wechat.png"
          alt="微信客服二维码"
          className="mx-auto mt-4 h-52 w-52 max-w-full rounded-lg border border-[color:var(--app-border)] object-cover"
        />
        <p className="mt-3 text-sm text-[color:var(--app-text-muted)]">微信扫码联系人工客服</p>
      </section>
    </div>,
    document.body,
  )
}
