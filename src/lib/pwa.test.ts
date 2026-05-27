import { describe, expect, it } from 'vitest'
import {
  PWA_INSTALL_DISMISSED_KEY,
  dismissInstallPrompt,
  isAndroidBrowser,
  isElectronRuntime,
  isInstallPromptDismissed,
  isIosSafari,
} from './pwa'

describe('pwa utils', () => {
  it('detects iOS Safari user agent', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(isIosSafari(ua)).toBe(true)
  })

  it('detects Android browser', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(isAndroidBrowser(ua)).toBe(true)
  })

  it('detects Electron runtime', () => {
    expect(isElectronRuntime('Mozilla/5.0 Electron/30.0.0')).toBe(true)
  })

  it('persists dismiss flag', () => {
    const memoryStorage = (() => {
      const map = new Map<string, string>()
      return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value)
        },
        removeItem: (key: string) => {
          map.delete(key)
        },
      }
    })()
    memoryStorage.removeItem(PWA_INSTALL_DISMISSED_KEY)
    dismissInstallPrompt(memoryStorage as unknown as Storage)
    expect(isInstallPromptDismissed(memoryStorage as unknown as Storage)).toBe(true)
  })
})
