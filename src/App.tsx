import { useCallback, useEffect, useRef, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import {
  createCurrentVersionSnapshot,
  fetchVersionManifest,
  getDesktopDownloadUrl,
  isDesktopRuntime,
  isDesktopUpdateAvailable,
  isWebUpdateAvailable,
  shouldRunDesktopAutoCheck,
  type VersionManifest,
} from './lib/versionCheck'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import AgentWorkspace from './components/AgentWorkspace'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import PwaInstallPrompt from './components/PwaInstallPrompt'
import { useGlobalClickSuppression } from './lib/clickSuppression'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const theme = useStore((s) => s.settings.theme ?? 'light')
  const tasks = useStore((s) => s.tasks)
  const showToast = useStore((s) => s.showToast)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()
  const [updatePrompt, setUpdatePrompt] = useState<{
    remote: VersionManifest
    currentVersion: string
    latestVersion: string
    isDesktop: boolean
  } | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const currentVersionRef = useRef(createCurrentVersionSnapshot())
  const isDesktop = isDesktopRuntime()
  const hasRunningTasks = tasks.some((task) => task.status === 'running')

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    const normalizedTheme = theme === 'cream' ? 'sepia' : theme
    document.documentElement.classList.toggle('dark', normalizedTheme === 'dark')
    document.documentElement.setAttribute('data-theme', normalizedTheme)
  }, [theme])

  const runVersionCheck = useCallback(async (manual = false) => {
    if (isCheckingUpdate) return
    const now = Date.now()
    const lastAutoRaw = window.localStorage.getItem('update:lastAutoCheckAt')
    const lastFailRaw = window.localStorage.getItem('update:lastFailedAt')
    const lastAuto = lastAutoRaw ? Number(lastAutoRaw) : null
    const lastFail = lastFailRaw ? Number(lastFailRaw) : null

    if (isDesktop && !manual && !shouldRunDesktopAutoCheck(now, Number.isFinite(lastAuto ?? NaN) ? lastAuto : null, Number.isFinite(lastFail ?? NaN) ? lastFail : null)) {
      return
    }

    try {
      setIsCheckingUpdate(true)
      const remote = await fetchVersionManifest(fetch, now)
      if (!manual) window.localStorage.setItem('update:lastAutoCheckAt', String(now))
      const current = currentVersionRef.current
      const webUpdate = !isDesktop && isWebUpdateAvailable(current, remote)
      const desktopUpdate = isDesktop && isDesktopUpdateAvailable(current, remote)
      if (webUpdate || desktopUpdate) {
        setUpdatePrompt({
          remote,
          currentVersion: current.version,
          latestVersion: remote.version || current.version,
          isDesktop,
        })
        return
      }
      if (manual) showToast('当前已是最新版本', 'success')
    } catch {
      window.localStorage.setItem('update:lastFailedAt', String(now))
      if (manual) {
        showToast('检查更新失败，请稍后重试', 'error')
      }
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [isCheckingUpdate, isDesktop, showToast])

  useEffect(() => {
    const onCheckUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ manual?: boolean }>
      void runVersionCheck(Boolean(customEvent.detail?.manual))
    }
    window.addEventListener('app:check-update', onCheckUpdate as EventListener)
    return () => window.removeEventListener('app:check-update', onCheckUpdate as EventListener)
  }, [runVersionCheck])

  useEffect(() => {
    if (isDesktop) {
      const timer = window.setTimeout(() => {
        void runVersionCheck(false)
      }, 10_000)
      return () => window.clearTimeout(timer)
    }

    void runVersionCheck(false)
    const interval = window.setInterval(() => {
      void runVersionCheck(false)
    }, 3 * 60 * 1000)
    const onFocus = () => {
      void runVersionCheck(false)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [isDesktop, runVersionCheck])

  const handleReloadToLatest = useCallback(() => {
    const nextUrl = `${window.location.pathname}?v=${Date.now()}${window.location.hash || ''}`
    window.location.replace(nextUrl)
  }, [])

  const handleOpenDesktopDownload = useCallback(() => {
    const url = updatePrompt ? getDesktopDownloadUrl(updatePrompt.remote) : null
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    showToast('请前往官网下载最新版', 'info')
  }, [showToast, updatePrompt])

  return (
    <>
      <Header />
      {appMode === 'agent' ? (
        <AgentWorkspace />
      ) : (
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            <TaskGrid />
          </div>
        </main>
      )}
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <SupportPromptModal />
      <PwaInstallPrompt />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      {updatePrompt && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-[color:var(--app-border)] bg-[var(--app-surface-elevated)] p-5 shadow-[var(--app-shadow)]">
            <h3 className="text-base font-semibold text-[color:var(--app-text)]">发现新版本</h3>
            <p className="mt-2 text-sm text-[color:var(--app-text-muted)]">
              当前版本：{updatePrompt.currentVersion}
              <br />
              最新版本：{updatePrompt.latestVersion}
            </p>
            {!updatePrompt.isDesktop && (
              <p className="mt-2 text-xs text-[color:var(--app-text-subtle)]">
                系统已更新，为避免继续使用旧缓存，请刷新到最新版本。
              </p>
            )}
            {hasRunningTasks && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                当前有任务进行中，刷新或重启可能中断页面状态。
              </p>
            )}
            <div className="mt-4 flex gap-2">
              {updatePrompt.isDesktop ? (
                <>
                  <button
                    type="button"
                    className="rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                    onClick={handleOpenDesktopDownload}
                  >
                    下载新版本
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-[color:var(--app-border)] px-3 py-2 text-sm text-[color:var(--app-text-muted)] transition hover:bg-[color:var(--app-bg-soft)]"
                    onClick={() => setUpdatePrompt(null)}
                  >
                    稍后提醒
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                  onClick={handleReloadToLatest}
                >
                  立即更新
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
