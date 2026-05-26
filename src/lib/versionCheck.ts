export interface VersionManifestDesktopInfo {
  windowsUrl?: string
  macosUrl?: string
  notes?: string
}

export interface VersionManifest {
  version?: string
  buildId?: string
  commit?: string
  force?: boolean
  desktop?: VersionManifestDesktopInfo
}

export interface VersionSnapshot {
  version: string
  buildId: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export function compareSemver(a: string, b: string): number {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = normalize(a)
  const right = normalize(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function createCurrentVersionSnapshot(): VersionSnapshot {
  return {
    version: __APP_VERSION__ || '0.0.0',
    buildId: __BUILD_ID__ || __BUILD_TIME__ || '',
  }
}

export function isDesktopRuntime(userAgent = navigator.userAgent): boolean {
  return /Electron/i.test(userAgent)
}

export function isWebUpdateAvailable(current: VersionSnapshot, remote: VersionManifest): boolean {
  const remoteVersion = String(remote.version || '').trim()
  const remoteBuildId = String(remote.buildId || '').trim()
  if (!remoteVersion && !remoteBuildId) return false
  if (remoteVersion && compareSemver(remoteVersion, current.version) > 0) return true
  if (remoteVersion && compareSemver(remoteVersion, current.version) < 0) return false
  return Boolean(remoteBuildId && remoteBuildId !== current.buildId)
}

export function isDesktopUpdateAvailable(current: VersionSnapshot, remote: VersionManifest): boolean {
  const remoteVersion = String(remote.version || '').trim()
  const remoteBuildId = String(remote.buildId || '').trim()
  if (!remoteVersion && !remoteBuildId) return false
  if (remoteVersion && compareSemver(remoteVersion, current.version) > 0) return true
  if (remoteVersion && compareSemver(remoteVersion, current.version) < 0) return false
  return Boolean(remoteBuildId && remoteBuildId !== current.buildId)
}

export function shouldRunDesktopAutoCheck(
  now: number,
  lastAutoCheckAt: number | null,
  lastFailedAt: number | null,
): boolean {
  if (lastFailedAt != null && now - lastFailedAt < HOUR_MS) return false
  if (lastAutoCheckAt == null) return true
  return now - lastAutoCheckAt >= DAY_MS
}

export function getVersionManifestUrl(basePath = '/version.json', now = Date.now()): string {
  const sep = basePath.includes('?') ? '&' : '?'
  return `${basePath}${sep}ts=${now}`
}

export async function fetchVersionManifest(fetchImpl: typeof fetch, now = Date.now()): Promise<VersionManifest> {
  const response = await fetchImpl(getVersionManifestUrl('/version.json', now), {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as VersionManifest
  return payload
}

export function getDesktopDownloadUrl(remote: VersionManifest, platform = navigator.platform): string | null {
  const desktop = remote.desktop
  if (!desktop) return null
  if (/mac/i.test(platform)) return desktop.macosUrl?.trim() || null
  return desktop.windowsUrl?.trim() || null
}

