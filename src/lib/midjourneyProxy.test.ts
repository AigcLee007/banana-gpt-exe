import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { handleMidjourneyProxy, handleDesktopApiProxy } = require('../../electron/midjourney-proxy.cjs')

describe('shared development and Electron Midjourney proxy', () => {
  it.each([
    ['POST', '/midjourney-v82/generations'], ['GET', '/midjourney-v82/tasks/task-1'],
    ['GET', '/v1/tasks/task-1/artifacts'], ['GET', '/v1/tasks/task-1/artifacts/image-1/content'],
  ])('forwards %s %s to the configured root with user auth', async (method, path) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'))
    const response = await handleMidjourneyProxy(new Request(`https://local/api-proxy${path}`, { method, headers: { Authorization: 'Bearer test-user' }, ...(method === 'POST' ? { body: '{"n":1}' } : {}) }), fetchMock, 'https://vip.aittco.com/v1')
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(`https://vip.aittco.com${path}`, expect.objectContaining({ method, redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer test-user' }) }))
  })
  it.each([
    ['GET', '/midjourney-v82/generations'], ['POST', '/midjourney-v82/tasks/task-1'],
    ['POST', '/v1/tasks/task-1/artifacts'], ['GET', '/v1/midjourney-v82/tasks/a'],
    ['GET', '/midjourney-v82/admin'], ['GET', '/v1/tasks/task-1/delete'],
    ['GET', '/midjourney-v82/tasks/task-1?url=https://evil.invalid'],
  ])('rejects unapproved method/path %s %s', async (method, path) => {
    const fetchMock = vi.fn()
    const result = await handleMidjourneyProxy(new Request(`https://local/api-proxy${path}`, { method, headers: { Authorization: 'Bearer test-user' } }), fetchMock)
    expect([403, 405]).toContain(result.status); expect(fetchMock).not.toHaveBeenCalled()
  })
  it('requires authentication and respects custom proxy prefixes', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'))
    expect((await handleMidjourneyProxy(new Request('https://local/custom/midjourney-v82/tasks/a'), fetchMock, 'https://vip.aittco.com/v1', '/custom')).status).toBe(401)
    await handleMidjourneyProxy(new Request('https://local/custom/midjourney-v82/tasks/a', { headers: { Authorization: 'Bearer key' } }), fetchMock, 'https://vip.aittco.com/v1', '/custom')
    expect(fetchMock.mock.calls[0][0]).toBe('https://vip.aittco.com/midjourney-v82/tasks/a')
  })
  it('configures restricted root routes in Nginx, development and packaged Electron', () => {
    const nginx = readFileSync(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8')
    expect(nginx).toContain('location = /api-proxy/midjourney-v82/generations')
    expect(nginx).toContain('^/api-proxy/midjourney-v82/tasks/[A-Za-z0-9_-]+$')
    expect(nginx).toContain('^/api-proxy/v1/tasks/[A-Za-z0-9_-]+/artifacts')
    for (const file of ['../../vite.config.ts', '../../electron/main.cjs']) expect(readFileSync(new URL(file, import.meta.url), 'utf8')).toContain('handleMidjourneyProxy')
    expect(readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8')).toContain("url.pathname === '/desktop-api-proxy'")
  })
})

describe('Electron model API proxy', () => {
  it.each([
    ['POST', 'https://api.example.test/v1/images/generations'],
    ['POST', 'https://api.example.test/v1/images/edits'],
    ['POST', 'https://api.example.test/v1/responses'],
    ['POST', 'https://api.example.test/v1/videos'],
    ['PUT', 'https://api.example.test/v1/videos/task-1/cancel'],
    ['POST', 'https://[2606:4700:4700::1111]/v1/images/generations'],
    ['GET', 'https://api.example.test/v1/videos/task-1'],
    ['GET', 'https://api.example.test/v1/tasks/task-1/artifacts/image-1/content'],
    ['POST', 'https://generativelanguage.example.test/v1beta/models/gemini-image:generateContent?key=private-query-key'],
    ['POST', 'https://custom.example.test/v1/providers/image-maker/render'],
    ['POST', 'https://vip.aittco.com/midjourney-v82/generations'],
    ['GET', 'https://vip.aittco.com/midjourney-v82/tasks/task-1'],
  ])('forwards %s %s and preserves upstream response', async (method, target) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('upstream-body', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    const request = new Request('https://local/desktop-api-proxy', {
      method,
      headers: {
        'X-Desktop-Api-Target': target,
        'X-Desktop-Api-Base': `${new URL(target).origin}${new URL(target).pathname.startsWith('/v1beta/') ? '/v1beta' : '/v1'}`,
        Authorization: 'Bearer user-key', 'Content-Type': 'application/json', 'X-Ignore-Me': 'ignore',
      },
      ...(['POST', 'PUT'].includes(method) ? { body: '{"prompt":"cup"}' } : {}),
    })

    const response = await handleDesktopApiProxy(request, fetchMock, async () => [{ address: '93.184.216.34' }])

    expect(response.status).toBe(201)
    expect(await response.text()).toBe('upstream-body')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const forwarded = fetchMock.mock.calls[0][1] as RequestInit
    expect(forwarded).toMatchObject({ method, redirect: 'error' })
    if (['POST', 'PUT'].includes(method)) expect(forwarded).toMatchObject({ duplex: 'half' })
    expect(new Headers(forwarded.headers).get('Authorization')).toBe('Bearer user-key')
    expect(new Headers(forwarded.headers).get('X-Ignore-Me')).toBeNull()
    if (['POST', 'PUT'].includes(method)) expect(await new Response(forwarded.body).text()).toBe('{"prompt":"cup"}')
  })

  it.each([
    ['POST', 'http://api.example.test/v1/images/generations'],
    ['POST', 'https://user:password@api.example.test/v1/images/generations'],
    ['POST', 'https://127.0.0.1/v1/images/generations'],
    ['POST', 'https://10.0.0.4/v1/images/generations'],
    ['POST', 'https://[::1]/v1/images/generations'],
    ['DELETE', 'https://api.example.test/v1/images/generations'],
    ['POST', 'https://api.example.test/private/admin'],
    ['POST', 'https://api.example.test/v2/images/generations'],
  ])('rejects unsafe destination or route %s %s', async (method, target) => {
    const parsedTarget = new URL(target)
    const fetchMock = vi.fn()
    const request = new Request('https://local/desktop-api-proxy', {
      method,
      headers: { 'X-Desktop-Api-Target': target, 'X-Desktop-Api-Base': `${parsedTarget.origin}/v1`, Authorization: 'Bearer user-key' },
      ...(['POST', 'PUT'].includes(method) ? { body: '{}' } : {}),
    })

    const response = await handleDesktopApiProxy(request, fetchMock, async () => [{ address: '93.184.216.34' }])

    expect([403, 405, 400]).toContain(response.status)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires user authentication and a target URL', async () => {
    const fetchMock = vi.fn()
    const lookup = async () => [{ address: '93.184.216.34' }]
    expect((await handleDesktopApiProxy(new Request('https://local/desktop-api-proxy', { method: 'POST', headers: { 'X-Desktop-Api-Target': 'https://api.example.test/v1/images/generations', 'X-Desktop-Api-Base': 'https://api.example.test/v1' }, body: '{}' }), fetchMock, lookup)).status).toBe(401)
    expect((await handleDesktopApiProxy(new Request('https://local/desktop-api-proxy', { method: 'POST', headers: { Authorization: 'Bearer user-key' }, body: '{}' }), fetchMock, lookup)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the FAL SDK target header when routing through a configured FAL relay', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'))
    const response = await handleDesktopApiProxy(new Request('https://local/desktop-api-proxy', {
      method: 'POST',
      headers: {
        'X-Desktop-Api-Target': 'https://fal-proxy.example.test/api/fal',
        'X-Desktop-Api-Base': 'https://fal-proxy.example.test/api/fal',
        'X-Fal-Target-Url': 'https://queue.fal.run/model/requests/task-1',
        Authorization: 'Key fal-key',
        'Content-Type': 'application/json',
      },
      body: '{}',
    }), fetchMock, async () => [{ address: '93.184.216.34' }])

    expect(response.status).toBe(200)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Fal-Target-Url')).toBe('https://queue.fal.run/model/requests/task-1')
  })

  it('rejects an API host that resolves to a private address or does not match the configured base', async () => {
    const fetchMock = vi.fn()
    const privateDns = async () => [{ address: '192.168.1.10' }]
    const request = (target: string, base: string) => new Request('https://local/desktop-api-proxy', {
      method: 'POST',
      headers: { 'X-Desktop-Api-Target': target, 'X-Desktop-Api-Base': base, Authorization: 'Bearer user-key' },
      body: '{}',
    })

    expect((await handleDesktopApiProxy(request('https://api.example.test/v1/images/generations', 'https://api.example.test/v1'), fetchMock, privateDns)).status).toBe(403)
    expect((await handleDesktopApiProxy(request('https://api.example.test/v1/images/generations', 'https://other.example.test/v1'), fetchMock, async () => [{ address: '93.184.216.34' }])).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not try DNS lookup for a public IPv6 API literal', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'))
    const lookup = vi.fn(async () => [])
    const target = 'https://[2606:4700:4700::1111]/v1/images/generations'
    const base = `${new URL(target).origin}/v1`
    const response = await handleDesktopApiProxy(new Request('https://local/desktop-api-proxy', {
      method: 'POST',
      headers: { 'X-Desktop-Api-Target': target, 'X-Desktop-Api-Base': base, Authorization: 'Bearer key' },
      body: '{}',
    }), fetchMock, lookup)

    expect(response.status).toBe(200)
    expect(lookup).not.toHaveBeenCalled()
  })
})
