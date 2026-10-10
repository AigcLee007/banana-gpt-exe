import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uguuUploadMiddleware } from './uguuProxy'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

afterEach(() => vi.unstubAllGlobals())

async function callProxy(method: string, headers: Record<string, string> = {}, body = '') {
  const server = createServer((req, res) => uguuUploadMiddleware(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${(server.address() as AddressInfo).port}/media-upload/uguu`, { method, headers }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.end(body)
    })
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

describe('fixed Uguu upload transports', () => {
  it('forwards multipart to Uguu with neither API credentials nor cookies', async () => {
    const upstream = vi.fn(async () => new Response('{"success":true,"files":[{"url":"https://n.uguu.se/a.png"}]}'))
    vi.stubGlobal('fetch', upstream)
    const boundary = 'multipart/form-data; boundary=uguu-test'
    const response = await callProxy('POST', { 'Content-Type': boundary, Authorization: 'Bearer private-key', Cookie: 'secret=1' }, 'multipart-bytes')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).success).toBe(true)
    expect(upstream.mock.calls[0][0]).toBe('https://uguu.se/upload')
    const init = upstream.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Content-Type')).toBe(boundary)
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
    expect(new Headers(init.headers).get('Cookie')).toBeNull()
    expect(Buffer.from(init.body as Buffer).toString()).toBe('multipart-bytes')
  })
  it.each(['GET', 'PUT', 'DELETE'])('rejects %s without contacting Uguu', async method => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await callProxy(method)).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('rejects non-file bodies and oversized uploads locally', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect((await callProxy('POST', { 'Content-Type': 'application/json' }, '{}')).status).toBe(400)
    expect((await callProxy('POST', { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(52 * 1024 * 1024) })).status).toBe(413)
  })
  it('reports safe upload failure text on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('internal error with secret')))
    const response = await callProxy('POST', { 'Content-Type': 'multipart/form-data; boundary=x' }, 'bytes')
    expect(response.status).toBe(502)
    expect(response.body).not.toContain('secret')
  })
  it('desktop handler uses the same fixed target without weakening browser security', async () => {
    const { handleUguuUpload } = require('../electron/uguu-upload.cjs')
    const upstream = vi.fn(async () => new Response('{"success":true}'))
    const response = await handleUguuUpload(new Request('app://local/media-upload/uguu', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', Authorization: 'private', Cookie: 'secret' }, body: 'bytes',
    }), upstream)
    expect(response.status).toBe(200)
    expect(upstream.mock.calls[0][0]).toBe('https://uguu.se/upload')
    expect(new Headers(upstream.mock.calls[0][1].headers).get('Authorization')).toBeNull()
    expect(new Headers(upstream.mock.calls[0][1].headers).get('Cookie')).toBeNull()
  })
})
