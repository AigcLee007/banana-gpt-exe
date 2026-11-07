import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useVideoStore } from '../videoStore'
import { getDesktopUpdateBusy, installDesktopUpdate, type DesktopUpdateState } from '../lib/desktopUpdater'
import { subscribeDesktopWork } from '../lib/desktopWorkActivity'

const readBusy = () => getDesktopUpdateBusy(useStore.getState(), useVideoStore.getState())

export function useDesktopUpdater() {
  const bridge = typeof window === 'undefined' ? undefined : window.desktopUpdater
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(readBusy)
  const stateRef = useRef<DesktopUpdateState | null>(null)
  const revision = useRef(0)
  const active = useRef(false)
  const actionPending = useRef(false)

  const receive = useCallback((next: DesktopUpdateState) => {
    if (!active.current) return
    const previous = stateRef.current
    stateRef.current = next
    setState(next)
    // Minimizing a download keeps progress quiet; completion asks for consent again.
    if (['available', 'downloaded', 'installing', 'error'].includes(next.status)
      && (previous?.status !== next.status || previous.version !== next.version)) setVisible(true)
  }, [])

  const perform = useCallback(async (kind: 'check' | 'download' | 'install') => {
    if (!bridge || actionPending.current || stateRef.current?.status === 'installing') return
    actionPending.current = true
    setPending(true)
    setVisible(true)
    const startedAt = ++revision.current
    try {
      if (kind === 'install') {
        const result = await installDesktopUpdate(bridge, readBusy)
        if (!result.ok && !readBusy()) receive({ ...stateRef.current!, currentVersion: stateRef.current?.currentVersion ?? '', status: 'error', errorStage: 'install', error: result.message })
      } else {
        if (kind === 'check') receive({ currentVersion: stateRef.current?.currentVersion ?? '', status: 'checking' })
        const next = await bridge[kind]()
        if (revision.current === startedAt) receive(next)
      }
    } catch {
      receive({ ...stateRef.current!, currentVersion: stateRef.current?.currentVersion ?? '', status: 'error', errorStage: kind, error: undefined })
    } finally {
      actionPending.current = false
      if (active.current) setPending(false)
    }
  }, [bridge, receive])

  useEffect(() => {
    if (!bridge) return
    active.current = true
    const reportBusy = () => {
      const current = readBusy()
      setBusy(current)
      // A failed report leaves main's conservative busy default in place.
      void bridge.setBusy(current).catch(() => {})
    }
    const stopImages = useStore.subscribe(reportBusy)
    const stopVideos = useVideoStore.subscribe(reportBusy)
    const stopWork = subscribeDesktopWork(reportBusy)
    reportBusy()
    const initialRevision = revision.current
    const stopState = bridge.onState((next) => { revision.current += 1; receive(next) })
    void bridge.getState().then((next) => {
      if (revision.current === initialRevision) receive(next)
    }).catch(() => {
      if (revision.current === initialRevision) receive({ currentVersion: '', status: 'error', errorStage: 'check' })
    })
    const check = () => { void perform('check') }
    window.addEventListener('app:check-update', check)
    return () => {
      active.current = false
      stopState()
      stopImages()
      stopVideos()
      stopWork()
      window.removeEventListener('app:check-update', check)
      void bridge.setBusy(true).catch(() => {})
    }
  }, [bridge, perform, receive])

  return {
    native: Boolean(bridge), state, visible, busy, pending,
    dismiss: () => { if (stateRef.current?.status !== 'installing') setVisible(false) },
    check: () => perform('check'), download: () => perform('download'), install: () => perform('install'),
  }
}
