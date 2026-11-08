import { readRuntimeEnv } from './runtimeEnv'

const APP_API_PROXY_PATH = '/desktop-api-proxy'

function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return init === undefined ? fetch(input) : fetch(input, init)
}

function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'app:'
}

function normalizeBase(value: string): URL | null {
  const raw = value.trim()
  if (!raw) return null
  try { return new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `https://${raw}`) }
  catch { return null }
}

function isTargetInApiBase(target: URL, base: URL): boolean {
  if (target.origin !== base.origin) return false
  const basePath = base.pathname.replace(/\/+$/, '') || '/'
  const underBase = basePath === '/' || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
  return underBase || /^\/midjourney-v82\/(?:generations|tasks\/[A-Za-z0-9_-]+)$/.test(target.pathname) || /^\/v1beta\/models\/[^/]+:[A-Za-z]+$/.test(target.pathname)
}

function getDesktopTarget(rawUrl: string, apiBaseUrl?: string): { target: URL; base: URL } | null {
  if (rawUrl.startsWith('/api-proxy/')) {
    const base = normalizeBase(readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL) || apiBaseUrl || '')
    if (!base) return null
    const source = new URL(rawUrl, 'app://local')
    const endpoint = source.pathname.replace(/^\/api-proxy\//, '')
    const rootPath = base.pathname.replace(/\/(?:v1|v1beta)\/?$/i, '').replace(/\/+$/, '')
    const target = new URL(`${rootPath}/${endpoint}${source.search}`, base.origin)
    return isTargetInApiBase(target, base) ? { target, base } : null
  }

  let target: URL
  try { target = new URL(rawUrl) } catch { return null }
  if (target.protocol !== 'https:') return { target, base: normalizeBase(apiBaseUrl || '') || new URL(target.origin) }
  const configuredBase = normalizeBase(apiBaseUrl || '')
  if (configuredBase) return isTargetInApiBase(target, configuredBase) ? { target, base: configuredBase } : null

  const match = target.pathname.match(/^(.*?\/v1(?:beta)?)(?:\/|$)/i)
  const base = new URL(match?.[1] || '/', target.origin)
  return isTargetInApiBase(target, base) ? { target, base } : null
}

export async function desktopApiFetch(input: RequestInfo | URL, init?: RequestInit, apiBaseUrl?: string): Promise<Response> {
  if (!isDesktopApp()) return nativeFetch(input, init)

  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const rawUrl = request?.url ?? (input instanceof URL ? input.href : String(input))
  const resolved = getDesktopTarget(rawUrl, apiBaseUrl)
  if (!resolved || (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('/api-proxy/'))) return nativeFetch(input, init)

  const headers = new Headers(request?.headers)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  headers.set('X-Desktop-Api-Target', resolved.target.href)
  headers.set('X-Desktop-Api-Base', resolved.base.href)
  const method = init?.method || request?.method || 'GET'
  const body = init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? request.body : undefined)

  return fetch(APP_API_PROXY_PATH, {
    ...init,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    credentials: 'omit',
    redirect: 'manual',
    cache: init?.cache ?? 'no-store',
  })
}
