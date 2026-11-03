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

it('creates the color assistant history store and source image index on upgrade', async () => {
  vi.resetModules()
  const stores = new Map<string, { indexes: Map<string, { keyPath: string; unique: boolean }> }>()
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: vi.fn((name: string) => {
      const store = {
        indexes: new Map<string, { keyPath: string; unique: boolean }>(),
        indexNames: { contains: (index: string) => store.indexes.has(index) },
        createIndex: (index: string, keyPath: string, options: { unique: boolean }) => {
          store.indexes.set(index, { keyPath, unique: options.unique })
        },
      }
      stores.set(name, store)
      return store
    }),
  }
  const request: { result: typeof database; transaction: { objectStore: (name: string) => NonNullable<ReturnType<typeof stores.get>> }; onupgradeneeded?: () => void; onsuccess?: () => void } = {
    result: database,
    transaction: { objectStore: (name) => stores.get(name)! },
  }
  const open = vi.fn((_name: string, _version: number) => request)
  vi.stubGlobal('indexedDB', { open })
  const { openAppDatabase } = await import('./db')
  const opening = openAppDatabase()
  request.onupgradeneeded?.()
  request.onsuccess?.()
  await opening

  expect(open).toHaveBeenCalledWith('gpt-image-playground', 9)
  expect(database.objectStoreNames.contains('colorAssistantHistory')).toBe(true)
  expect(stores.get('colorAssistantHistory')?.indexes.get('sourceImageId')).toEqual({ keyPath: 'sourceImageId', unique: false })
})
