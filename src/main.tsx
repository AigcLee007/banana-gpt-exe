import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { loadPortalConnection } from './lib/settingsConnection'
import { useStore } from './store'

declare global {
  interface Window {
    __AAP__?: {
      baseUrl: string
      key?: string
      portalName?: string
      lockProfile?: boolean
    }
    __AAP_THEME__?: { get: () => 'light' | 'dark'; set: (value: string) => void }
  }
}

installMobileViewportGuards()

const injected = window.__AAP__
const mode = new URLSearchParams(window.location.search).get('mode')
if (mode === 'gallery' || mode === 'video' || mode === 'agent') {
  useStore.getState().setAppMode(mode)
}

if (injected?.baseUrl) {
  const sharedTheme = window.__AAP_THEME__
  if (sharedTheme) {
    const applyTheme = () => useStore.getState().setSettings({ theme: sharedTheme.get() })
    applyTheme()
    window.addEventListener('aap:theme', applyTheme)
    useStore.subscribe((state, previous) => {
      const theme = state.settings.theme
      if (theme !== previous.settings.theme && (theme === 'light' || theme === 'dark') && theme !== sharedTheme.get()) sharedTheme.set(theme)
    })
  }
}

if ('serviceWorker' in navigator) {
  // Keep PWA installable without aggressive offline caches,
  // so web clients can always pick up latest version.json/app shell updates.
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister())
  })
}

const root = createRoot(document.getElementById('root')!)
function renderApp() {
  root.render(<StrictMode><App /></StrictMode>)
}
async function startPortal() {
  root.render(<div role="status" className="mx-auto max-w-md p-8">正在连接工作台…</div>)
  try {
    const settings = await loadPortalConnection(useStore.getState().settings)
    useStore.getState().setSettings(settings)
    renderApp()
  } catch {
    root.render(
      <div role="alert" className="mx-auto max-w-md space-y-4 p-8">
        <p>站点连接暂不可用，请重试或重新登录。</p>
        <button type="button" onClick={() => void startPortal()}>重新连接</button>
        <a className="ml-4" href="/_portal/login">重新登录</a>
      </div>,
    )
  }
}
if (injected?.baseUrl) void startPortal()
else renderApp()
