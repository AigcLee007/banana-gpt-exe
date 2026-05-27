export const PWA_INSTALL_DISMISSED_KEY = 'pwa-install-dismissed'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  return mediaStandalone || iosStandalone
}

export function isIosSafari(uaInput?: string): boolean {
  const ua = uaInput ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (!ua) return false
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isWebKit = /WebKit/.test(ua)
  const isChromeLike = /CriOS|FxiOS|EdgiOS/.test(ua)
  return isIOS && isWebKit && !isChromeLike
}

export function isAndroidBrowser(uaInput?: string): boolean {
  const ua = uaInput ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  return /Android/i.test(ua)
}

export function isElectronRuntime(uaInput?: string): boolean {
  const ua = uaInput ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  return /Electron/i.test(ua)
}

export function isInstallPromptDismissed(storage?: Storage): boolean {
  if (!storage) {
    if (typeof window === 'undefined') return false
    storage = window.localStorage
  }
  return storage.getItem(PWA_INSTALL_DISMISSED_KEY) === '1'
}

export function dismissInstallPrompt(storage?: Storage): void {
  if (!storage) {
    if (typeof window === 'undefined') return
    storage = window.localStorage
  }
  storage.setItem(PWA_INSTALL_DISMISSED_KEY, '1')
}
