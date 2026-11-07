import { hasDesktopWork } from './desktopWorkActivity'

export interface DesktopUpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'not-available' | 'error' | 'unsupported'
  currentVersion: string
  version?: string
  notes?: string
  percent?: number
  transferred?: number
  total?: number
  error?: string
  errorStage?: 'check' | 'download' | 'install'
}

export interface DesktopUpdater {
  getState(): Promise<DesktopUpdateState>
  check(): Promise<DesktopUpdateState>
  download(): Promise<DesktopUpdateState>
  install(): Promise<{ ok: boolean; message?: string }>
  setBusy(busy: boolean): Promise<void>
  onState(listener: (state: DesktopUpdateState) => void): () => void
}

declare global {
  interface Window { desktopUpdater?: DesktopUpdater }
}

interface ImageWorkState {
  tasks: readonly { status: string }[]
  agentConversations: readonly { rounds: readonly { status: string }[] }[]
}

interface VideoWorkState {
  tasks: readonly { status: string }[]
  isGenerating: boolean
  uploadingFiles: ReadonlySet<string>
}

export function getDesktopUpdateBusy(images: ImageWorkState, videos: VideoWorkState): boolean {
  return hasDesktopWork()
    || images.tasks.some((task) => task.status === 'running')
    || images.agentConversations.some((conversation) => conversation.rounds.some((round) => round.status === 'running'))
    || videos.tasks.some((task) => task.status === 'queued' || task.status === 'running')
    || videos.isGenerating
    || videos.uploadingFiles.size > 0
}

export async function installDesktopUpdate(bridge: DesktopUpdater, readBusy: () => boolean) {
  const busy = readBusy()
  await bridge.setBusy(busy)
  // Work may start while the main process acknowledges the last report.
  if (busy || readBusy()) {
    await bridge.setBusy(true)
    return { ok: false, message: '当前有任务进行中，请等待任务完成后再安装。' }
  }
  return bridge.install()
}
