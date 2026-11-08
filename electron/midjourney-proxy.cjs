// Narrow root-scoped proxy shared by Vite and packaged Electron.
const dns = require('node:dns').promises
const { isIP } = require('node:net')

function classifyPath(path) {
  if (path === '/midjourney-v82/generations') return ['POST', 'OPTIONS']
  if (/^\/midjourney-v82\/tasks\/[A-Za-z0-9_-]+$/.test(path)) return ['GET', 'HEAD', 'OPTIONS']
  if (/^\/v1\/tasks\/[A-Za-z0-9_-]+\/artifacts(?:\/[A-Za-z0-9_.-]+(?:\/content)?)?$/.test(path)) return ['GET', 'HEAD', 'OPTIONS']
  return null
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number)
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224
  }
  if (isIP(normalized) === 6) {
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7))
    return normalized === '::' || normalized === '::1' || /^(?:fc|fd|fe[89ab])/.test(normalized)
  }
  return true
}

function isMidjourneyPath(pathname, method) {
  if (pathname === '/midjourney-v82/generations') return method === 'POST'
  return /^\/midjourney-v82\/tasks\/[A-Za-z0-9_-]+$/.test(pathname) && ['GET', 'HEAD'].includes(method)
}

function isUnderConfiguredBase(target, configuredBase) {
  if (target.origin !== configuredBase.origin) return false
  const basePath = configuredBase.pathname.replace(/\/+$/, '') || '/'
  return basePath === '/'
    ? target.pathname.startsWith('/')
    : target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
}

function validateDesktopApiTarget(targetValue, baseValue, method) {
  let target
  let configuredBase
  try {
    target = new URL(targetValue)
    configuredBase = new URL(baseValue)
  } catch { return { status: 400, message: '无效的 API 地址' } }

  if (target.protocol !== 'https:' || configuredBase.protocol !== 'https:' ||
      target.username || target.password || configuredBase.username || configuredBase.password ||
      target.hash || configuredBase.search || configuredBase.hash || target.origin !== configuredBase.origin) {
    return { status: 403, message: 'API 地址不在当前配置范围内' }
  }
  if (!['GET', 'HEAD', 'POST', 'PUT'].includes(method)) return { status: 405, message: '不支持的 API 请求方式' }
  if (!isUnderConfiguredBase(target, configuredBase) && !isMidjourneyPath(target.pathname, method) &&
      !(target.pathname.startsWith('/v1beta/models/') && method === 'POST')) {
    return { status: 403, message: 'API 路径不在当前配置范围内' }
  }
  if (target.pathname.startsWith('/midjourney-v82/') && !isMidjourneyPath(target.pathname, method)) {
    return { status: 403, message: 'Midjourney API 路径不受支持' }
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(hostname) && isPrivateAddress(hostname)) return { status: 403, message: '禁止访问本机或内网 API 地址' }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { status: 403, message: '禁止访问本机或内网 API 地址' }
  }
  return { target, configuredBase, hostname }
}

async function handleDesktopApiProxy(request, fetchImpl, lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true })) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Range, X-Desktop-Api-Target, X-Desktop-Api-Base' } })
  }
  const authorization = request.headers.get('Authorization')?.trim()
  if (!authorization || !/^(?:Bearer|Key)\s+\S+$/i.test(authorization)) return new Response('请先填写 API Key', { status: 401 })
  const validated = validateDesktopApiTarget(
    request.headers.get('X-Desktop-Api-Target') || '',
    request.headers.get('X-Desktop-Api-Base') || '',
    request.method,
  )
  if (validated.status) return new Response(validated.message, { status: validated.status })

  if (!isIP(validated.hostname)) {
    try {
      const addresses = await lookup(validated.hostname)
      if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) return new Response('禁止访问本机或内网 API 地址', { status: 403 })
    } catch { return new Response('API 地址解析失败', { status: 502 }) }
  }

  const headers = new Headers()
  for (const name of ['Authorization', 'Content-Type', 'Accept', 'Range', 'X-Fal-Target-Url']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const init = {
    method: request.method,
    headers,
    redirect: 'error',
    signal: request.signal,
    ...(['POST', 'PUT'].includes(request.method) && request.body ? { body: request.body, duplex: 'half' } : {}),
  }
  try {
    const upstream = await fetchImpl(validated.target.href, init)
    const responseHeaders = new Headers()
    for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges', 'Cache-Control', 'Retry-After']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new Response(request.method === 'HEAD' || [204, 304].includes(upstream.status) ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    if (request.signal.aborted) return new Response('请求已取消', { status: 499 })
    if (error?.name === 'TypeError' && /redirect/i.test(error.message)) return new Response('API 服务不允许跨域跳转', { status: 502 })
    return new Response('API 代理连接失败', { status: 502 })
  }
}

async function handleMidjourneyProxy(request, fetchImpl, baseUrl = 'https://vip.aittco.com', prefix = '/api-proxy') {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(prefix + '/') || url.search) return new Response('Forbidden: API Proxy path restricted', { status: 403 })
  const path = url.pathname.slice(prefix.length)
  const methods = classifyPath(path)
  if (!methods) return new Response('Forbidden: API Proxy path restricted', { status: 403 })
  if (!methods.includes(request.method)) return new Response('Method Not Allowed', { status: 405 })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': methods.join(','), 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range' } })
  const authorization = request.headers.get('Authorization')?.trim()
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return new Response('请先填写 API Key', { status: 401 })
  const headers = { Authorization: authorization }
  for (const name of ['Content-Type', 'Range']) { const value = request.headers.get(name); if (value) headers[name] = value }
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
  try {
    const upstream = await fetchImpl(`${root}${path}`, {
      method: request.method, headers, redirect: 'error',
      ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}),
    })
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' })
    for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value) }
    return new Response(request.method === 'HEAD' || [204, 304].includes(upstream.status) ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders })
  } catch { return new Response('Midjourney 代理连接失败', { status: 502 }) }
}

async function handleImageDownload(request, fetchImpl) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
  const source = new URL(request.url).searchParams.get('url')
  let url
  try { url = new URL(source) } catch { return new Response('Forbidden', { status: 403 }) }
  if (url.protocol !== 'https:' || url.username || url.password || !/^(?:file(?:[1-9]|10)\.aitohumanize\.com|visionary\.beer)$/.test(url.hostname)) return new Response('Forbidden: download proxy host restricted', { status: 403 })
  // Credentials and cookies never reach the image host, including redirects.
  try { return await fetchImpl(url.href, { method: 'GET', redirect: 'error', credentials: 'omit' }) }
  catch { return new Response('图片代理连接失败', { status: 502 }) }
}

module.exports = { classifyPath, handleDesktopApiProxy, handleMidjourneyProxy, handleImageDownload }
