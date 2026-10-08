import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import viteConfig from '../vite.config'

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void
let server: Server
let origin: string
const upstreamFetch = vi.fn<typeof fetch>()
const nativeFetch = globalThis.fetch

beforeAll(async () => {
  const config = await (viteConfig as Function)({ command: 'serve', mode: 'development' })
  const plugin = config.plugins.find((item: { name: string }) => item.name === 'app-version-manifest')
  let middleware: Middleware | undefined
  plugin.configureServer({ middlewares: { use(handler: string | Middleware) {
    if (typeof handler === 'function') middleware = handler
  } } })
  if (!middleware) throw new Error('Video proxy middleware missing')
  server = createServer((req, res) => middleware!(req, res, () => {
    res.statusCode = 404
    res.end()
  }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  vi.stubGlobal('fetch', upstreamFetch)
  vi.stubEnv('API_PROXY_URL', 'https://vip.aittco.com/v1')
  // A legacy shared key must never replace the caller's credentials.
  vi.stubEnv('GROK_IMAGINE_VIDEO_API_KEY', 'mock-legacy-server-key')
  upstreamFetch.mockResolvedValue(new Response('{"id":"task-1","status":"queued"}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  upstreamFetch.mockReset()
})
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function callProxy(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string | Buffer) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
    const req = request(`${origin}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('Video proxy response timed out')))
    req.end(body)
  })
}

describe('user-key video proxy', () => {
  it('returns complete JSON when the upstream gzip response is decompressed by fetch', async () => {
    const json = JSON.stringify({ id: 'gzip-task', status: 'queued' })
    const compressed = gzipSync(json)
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': compressed.length })
      res.end(compressed)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    vi.stubEnv('API_PROXY_URL', `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`)
    upstreamFetch.mockImplementationOnce(nativeFetch)
    try {
      const response = await callProxy('/api-proxy/v1/videos/task-1', 'GET', { Authorization: 'Bearer mock-user-key' })
      expect(response.body.toString()).toBe(json)
      expect(response.headers['content-encoding']).toBeUndefined()
      expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(json))
    } finally {
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('forwards Omni JSON image arrays without changing the payload or credentials', async () => {
    const body = JSON.stringify({ model: 'gemini-omni-flash-10s', prompt: 'A fox', seconds: '10', aspect_ratio: '9:16', resolution: '720p', images: ['data:image/png;base64,ZmFrZQ==', 'https://example.test/image.png'] })
    await callProxy('/api-proxy/v1/videos', 'POST', { Authorization: 'Bearer mock-omni-key', 'Content-Type': 'application/json' }, body)
    const init = upstreamFetch.mock.calls[0][1]
    expect(Buffer.from(init?.body as Buffer).toString()).toBe(body)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer mock-omni-key')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  })
  it.each([
    ['/api-proxy/v1/videos', 'POST'],
    ['/api-proxy/v1/videos/task-1', 'GET'],
    ['/api-proxy/v1/videos/task-1/content', 'GET'],
  ])('forwards the user key for %s', async (path, method) => {
    const response = await callProxy(path, method, { Authorization: 'Bearer mock-user-video-key' })
    expect(response.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalledWith(`https://vip.aittco.com${path.replace('/api-proxy', '')}`, expect.objectContaining({
      method, headers: expect.objectContaining({ Authorization: 'Bearer mock-user-video-key' }),
    }))
  })

  it('keeps credentials separate for different users', async () => {
    await callProxy('/api-proxy/v1/videos/task-1', 'GET', { Authorization: 'Bearer mock-user-a' })
    upstreamFetch.mockResolvedValueOnce(new Response('{}'))
    await callProxy('/api-proxy/v1/videos/task-2', 'GET', { Authorization: 'Bearer mock-user-b' })
    expect(upstreamFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization')))
      .toEqual(['Bearer mock-user-a', 'Bearer mock-user-b'])
  })

  it.each(['', 'Bearer', 'Basic mock-user-key'])('rejects missing/invalid authorization (%s) without upstream requests', async (authorization) => {
    const response = await callProxy('/api-proxy/v1/videos', 'POST', authorization ? { Authorization: authorization } : {})
    expect(response.status).toBe(401)
    expect(JSON.parse(response.body.toString()).error).toBe('请先在设置 → API 配置中填写 API Key')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('preserves multipart bytes and the browser boundary', async () => {
    const contentType = 'multipart/form-data; boundary=mock-video-boundary'
    const body = Buffer.from('--mock-video-boundary\r\nContent-Disposition: form-data; name="input_reference"; filename="image.png"\r\nContent-Type: image/png\r\n\r\nmock-image-bytes\r\n--mock-video-boundary--\r\n')
    await callProxy('/api-proxy/v1/videos', 'POST', { Authorization: 'Bearer mock-user-key', 'Content-Type': contentType }, body)
    expect(upstreamFetch.mock.calls[0][1]?.body).toEqual(body)
    expect(new Headers(upstreamFetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe(contentType)
  })

  it('proxies video bytes and range response headers', async () => {
    upstreamFetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2, 255]), {
      status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/100', 'Accept-Ranges': 'bytes' },
    }))
    const response = await callProxy('/api-proxy/v1/videos/task-1/content', 'GET', { Authorization: 'Bearer mock-user-key', Range: 'bytes=0-3' })
    expect(response.status).toBe(206)
    expect(response.headers['content-type']).toBe('video/mp4')
    expect(response.headers['content-range']).toBe('bytes 0-3/100')
    expect(response.body).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(new Headers(upstreamFetch.mock.calls[0][1]?.headers).get('Range')).toBe('bytes=0-3')
  })

  it('preserves upstream authentication errors', async () => {
    upstreamFetch.mockResolvedValueOnce(new Response('{"error":"invalid api key"}', { status: 401 }))
    const response = await callProxy('/api-proxy/v1/videos', 'POST', { Authorization: 'Bearer mock-user-key' })
    expect(response.status).toBe(401)
    expect(JSON.parse(response.body.toString())).toEqual({ error: 'invalid api key' })
  })

  it('allows Authorization in preflight without contacting the upstream', async () => {
    const response = await callProxy('/api-proxy/v1/videos', 'OPTIONS')
    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-headers']).toContain('Authorization')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
})
