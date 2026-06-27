import { describe, expect, it, vi } from 'vitest'
import {
  compareSemver,
  fetchVersionManifest,
  getDesktopDownloadUrl,
  getVersionManifestUrl,
  isDesktopUpdateAvailable,
  isWebUpdateAvailable,
  shouldRunDesktopAutoCheck,
  shouldRunWebAutoCheck,
  type VersionSnapshot,
} from './versionCheck'

describe('versionCheck', () => {
  const current: VersionSnapshot = { version: '0.4.5', buildId: 'build-a' }

  it('compares semver correctly', () => {
    expect(compareSemver('0.4.6', '0.4.5')).toBeGreaterThan(0)
    expect(compareSemver('v0.4.5', '0.4.5')).toBe(0)
    expect(compareSemver('0.4.4', '0.4.5')).toBeLessThan(0)
  })

  it('detects web update when build id differs', () => {
    expect(isWebUpdateAvailable(current, { version: '0.4.5', buildId: 'build-b' })).toBe(true)
  })

  it('detects desktop update when version is higher', () => {
    expect(isDesktopUpdateAvailable(current, { version: '0.4.6', buildId: 'build-a' })).toBe(true)
  })

  it('builds version url with timestamp', () => {
    expect(getVersionManifestUrl('/version.json', 123)).toBe('/version.json?ts=123')
  })

  it('fetches manifest with no-store cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.4.6' }),
    })
    const data = await fetchVersionManifest(fetchImpl as unknown as typeof fetch, 123)
    expect(data.version).toBe('0.4.6')
    expect(fetchImpl).toHaveBeenCalledWith('/version.json?ts=123', { cache: 'no-store' })
  })

  it('desktop auto check throttles by 24h and fail cooldown 1h', () => {
    const now = 1_000_000
    expect(shouldRunDesktopAutoCheck(now, null, null)).toBe(true)
    expect(shouldRunDesktopAutoCheck(now, now - 1_000, null)).toBe(false)
    expect(shouldRunDesktopAutoCheck(now, now - 25 * 60 * 60 * 1000, null)).toBe(true)
    expect(shouldRunDesktopAutoCheck(now, null, now - 30 * 60 * 1000)).toBe(false)
  })

  it('web auto check throttles by 1h', () => {
    const now = 1_000_000
    expect(shouldRunWebAutoCheck(now, null)).toBe(true)
    expect(shouldRunWebAutoCheck(now, now - 59 * 60 * 1000)).toBe(false)
    expect(shouldRunWebAutoCheck(now, now - 60 * 60 * 1000)).toBe(true)
  })

  it('returns desktop download url by platform', () => {
    const remote = {
      desktop: {
        windowsUrl: 'https://example.com/win.exe',
        macosUrl: 'https://example.com/mac.dmg',
      },
    }
    expect(getDesktopDownloadUrl(remote, 'MacIntel')).toBe('https://example.com/mac.dmg')
    expect(getDesktopDownloadUrl(remote, 'Win32')).toBe('https://example.com/win.exe')
  })
})

