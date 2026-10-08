import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('retries an upgrade after another tab blocked it and closes the abandoned connection', async () => {
  vi.resetModules()
  const requests: { result: { close: ReturnType<typeof vi.fn>; onversionchange?: () => void }; onblocked?: () => void; onsuccess?: () => void }[] = []
  const open = vi.fn(() => {
    const request = { result: { close: vi.fn() } }
    requests.push(request)
    return request
  })
  vi.stubGlobal('indexedDB', { open })
  const { openAppDatabase } = await import('./db')
  const blocked = openAppDatabase()
  const rejection = expect(blocked).rejects.toThrow('数据库升级')
  requests[0].onblocked!()
  await rejection
  const retry = openAppDatabase()
  expect(open).toHaveBeenCalledTimes(2)
  requests[0].onsuccess!()
  expect(requests[0].result.close).toHaveBeenCalledOnce()
  requests[1].onsuccess!()
  await expect(retry).resolves.toBe(requests[1].result)
  expect(openAppDatabase()).toBe(retry)
})
