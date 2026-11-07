import type { DesktopUpdateState } from '../lib/desktopUpdater'

interface Props {
  state: DesktopUpdateState
  busy: boolean
  pending: boolean
  onDismiss(): void
  onCheck(): void
  onDownload(): void
  onInstall(): void
}

const titles: Record<DesktopUpdateState['status'], string> = {
  idle: '软件更新', checking: '正在检查更新', available: '发现新版本', downloading: '正在下载更新',
  downloaded: '更新已准备就绪', installing: '正在安装更新', 'not-available': '当前已是最新版本', error: '更新暂时未完成', unsupported: '暂不支持自动更新',
}

export default function DesktopUpdateDialog({ state, busy, pending, onDismiss, onCheck, onDownload, onInstall }: Props) {
  const percent = Math.min(100, Math.max(0, Math.round(Number.isFinite(state.percent) ? state.percent! : 0)))
  const readyToInstall = state.status === 'downloaded' || (state.status === 'error' && state.errorStage === 'install')
  const retryDownload = state.status === 'error' && state.errorStage === 'download'
  const primary = 'rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="desktop-update-title" className="relative w-full max-w-md rounded-2xl border border-[color:var(--app-border)] bg-[var(--app-surface-elevated)] p-5 shadow-[var(--app-shadow)]">
        <h3 id="desktop-update-title" className="text-base font-semibold text-[color:var(--app-text)]">{titles[state.status]}</h3>
        <p className="mt-2 text-sm text-[color:var(--app-text-muted)]">当前版本：{state.currentVersion}{state.version && <><br />最新版本：{state.version}</>}</p>
        {state.notes && <p className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-[color:var(--app-text-muted)]">{state.notes}</p>}
        {state.status === 'available' && <p className="mt-3 text-sm text-[color:var(--app-text-muted)]">更新将在后台下载，完成后由你选择安装时间。</p>}
        {state.status === 'downloading' && <div className="mt-3" aria-live="polite">
          <p className="text-sm text-[color:var(--app-text-muted)]">下载进度 {percent}%</p>
          <div role="progressbar" aria-label="更新下载进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--app-bg-soft)]"><div className="h-full bg-blue-500 transition-[width]" style={{ width: `${percent}%` }} /></div>
        </div>}
        {readyToInstall && <p className="mt-3 text-sm text-[color:var(--app-text-muted)]">点击重启并安装后将关闭应用，安装完成后重新打开。稍后安装可继续使用当前版本。</p>}
        {state.status === 'installing' && <p role="status" className="mt-3 text-sm text-[color:var(--app-text-muted)]">请等待安装完成，应用将自动关闭并重新打开。</p>}
        {readyToInstall && busy && <p role="status" className="mt-2 text-sm text-amber-600 dark:text-amber-400">当前有任务或上传进行中，请等待任务完成后再安装。</p>}
        {state.status === 'error' && <p role="alert" className="mt-3 text-sm text-[color:var(--app-text-muted)]">{state.error || (state.errorStage === 'download' ? '下载失败，请检查网络后重试。' : state.errorStage === 'install' ? '暂时无法安装，请稍后重试。' : '检查更新失败，请检查网络后重试。')}</p>}
        {state.status === 'unsupported' && <p className="mt-3 text-sm text-[color:var(--app-text-muted)]">当前安装方式暂不支持自动更新，请从官网下载并安装最新版本。</p>}
        {state.status !== 'installing' && <div className="mt-4 flex flex-wrap gap-2">
          {readyToInstall ? <button type="button" className={primary} disabled={busy || pending} onClick={onInstall}>重启并安装</button>
            : state.status === 'available' || retryDownload ? <button type="button" className={primary} disabled={pending} onClick={onDownload}>{retryDownload ? '重新下载' : '下载更新'}</button>
              : ['idle', 'not-available', 'error'].includes(state.status) && <button type="button" className={primary} disabled={pending} onClick={onCheck}>{state.status === 'error' ? '重新检查' : '检查更新'}</button>}
          <button type="button" onClick={onDismiss} className="rounded-xl border border-[color:var(--app-border)] px-3 py-2 text-sm text-[color:var(--app-text-muted)] transition hover:bg-[color:var(--app-bg-soft)]">{state.status === 'downloading' ? '后台下载' : readyToInstall ? '稍后安装' : '关闭'}</button>
        </div>}
      </section>
    </div>
  )
}
