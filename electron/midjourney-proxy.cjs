// Narrow root-scoped proxy shared by Vite and packaged Electron.
function classifyPath(path) {
  if (path === '/midjourney-v82/generations') return ['POST', 'OPTIONS']
  if (/^\/midjourney-v82\/tasks\/[A-Za-z0-9_-]+$/.test(path)) return ['GET', 'HEAD', 'OPTIONS']
  if (/^\/v1\/tasks\/[A-Za-z0-9_-]+\/artifacts(?:\/[A-Za-z0-9_.-]+(?:\/content)?)?$/.test(path)) return ['GET', 'HEAD', 'OPTIONS']
  return null
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

module.exports = { classifyPath, handleMidjourneyProxy, handleImageDownload }
