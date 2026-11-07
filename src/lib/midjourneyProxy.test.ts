import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { handleMidjourneyProxy } = require('../../electron/midjourney-proxy.cjs')

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
  })
})
