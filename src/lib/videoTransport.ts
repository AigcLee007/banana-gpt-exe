import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import type { VideoApiProfileSnapshot } from './videoTypes'

/** Packaged desktops have no same-origin HTTP server; use the configured relay directly. */
export function buildVideoApiUrl(profile: VideoApiProfileSnapshot, path: string, requireWebProxy = false): string {
  const protocol = typeof window === 'undefined' ? '' : window.location.protocol
  const localApp = protocol === 'app:' || protocol === 'file:'
  const proxyConfig = readClientDevProxyConfig()
  if (!localApp && (requireWebProxy || shouldUseApiProxy(profile.apiProxy, proxyConfig))) {
    return `${proxyConfig?.prefix ?? '/api-proxy'}/v1/${path.replace(/^\/+/, '')}`
  }
  return buildApiUrl(profile.baseUrl, path, proxyConfig, false)
}
