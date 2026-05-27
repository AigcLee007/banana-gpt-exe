import { useEffect, useMemo, useState } from 'react'
import {
  type BeforeInstallPromptEvent,
  dismissInstallPrompt,
  isAndroidBrowser,
  isElectronRuntime,
  isInstallPromptDismissed,
  isIosSafari,
  isStandaloneDisplayMode,
} from '../lib/pwa'

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  const standalone = useMemo(() => isStandaloneDisplayMode(), [])
  const iosSafari = useMemo(() => isIosSafari(), [])
  const android = useMemo(() => isAndroidBrowser(), [])
  const electron = useMemo(() => isElectronRuntime(), [])

  useEffect(() => {
    if (electron || standalone) return
    setDismissed(isInstallPromptDismissed())
  }, [electron, standalone])

  useEffect(() => {
    if (electron || standalone) return
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [electron, standalone])

  if (electron || standalone || dismissed) return null
  if (!iosSafari && !android && !deferredPrompt) return null

  const onDismiss = () => {
    dismissInstallPrompt()
    setDismissed(true)
  }

  const onInstall = async () => {
    if (!deferredPrompt) return
    try {
      setInstalling(true)
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
      onDismiss()
    } finally {
      setInstalling(false)
      setDeferredPrompt(null)
    }
  }

  return (
    <div className="fixed bottom-[calc(84px+env(safe-area-inset-bottom,0px))] left-1/2 z-[75] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-[color:var(--app-border)] bg-[var(--app-surface-elevated)] p-3 shadow-[var(--app-shadow)]">
      <div className="text-sm font-semibold text-[color:var(--app-text)]">添加到主屏幕</div>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--app-text-muted)]">
        {iosSafari
          ? '将艾特智绘添加到主屏幕：点击 Safari 分享按钮，然后选择“添加到主屏幕”。'
          : '将艾特智绘安装到桌面，获得更接近 App 的体验。'}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {deferredPrompt && (
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? '安装中...' : '安装'}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-[color:var(--app-border)] px-3 py-1.5 text-xs text-[color:var(--app-text-muted)] transition hover:bg-[color:var(--app-bg-soft)]"
        >
          知道了
        </button>
      </div>
    </div>
  )
}
