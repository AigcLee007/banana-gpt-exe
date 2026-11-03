import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultColorAdjustments } from './colorGrading'
import { createColorAssistantHistoryRecord } from './colorAssistantHistory'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function createIndexedDbMock() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>()
  const indexes = new Map<string, Set<string>>()
  const objectStore = (name: string, transaction?: any) => {
    if (!stores.has(name)) stores.set(name, new Map())
    if (!indexes.has(name)) indexes.set(name, new Set())
    const rows = stores.get(name)!
    const makeRequest = (operation: () => unknown) => {
      const request: any = {}
      queueMicrotask(() => {
        request.result = operation()
        request.onsuccess?.()
        queueMicrotask(() => transaction?.oncomplete?.())
      })
      return request
    }
    const store: any = {
      indexNames: { contains: (index: string) => indexes.get(name)!.has(index) },
      createIndex: (index: string) => indexes.get(name)!.add(index),
      get: (id: string) => makeRequest(() => rows.get(id)),
      getAll: () => makeRequest(() => [...rows.values()]),
      put: (record: Record<string, unknown>) => makeRequest(() => { rows.set(String(record.id), structuredClone(record)); return record.id }),
      delete: (id: string) => { rows.delete(String(id)) },
      clear: () => { rows.clear(); queueMicrotask(() => transaction?.oncomplete?.()) },
      index: (index: string) => ({
        getAll: (value: string) => makeRequest(() => [...rows.values()].filter((record) => record[index] === value)),
        openCursor: (value: string) => {
          const matching = [...rows.entries()].filter(([, record]) => record[index] === value)
          const request: any = {}
          let cursorIndex = 0
          const advance = () => {
            const entry = matching[cursorIndex]
            request.result = entry ? {
              value: entry[1],
              delete: () => rows.delete(entry[0]),
              continue: () => { cursorIndex += 1; queueMicrotask(advance) },
            } : null
            request.onsuccess?.()
            if (!entry) queueMicrotask(() => transaction?.oncomplete?.())
          }
          queueMicrotask(advance)
          return request
        },
      }),
    }
    return store
  }
  const database: any = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => objectStore(name),
    transaction: (_names: string | string[], _mode: IDBTransactionMode) => {
      const transaction: any = { objectStore: (name: string) => objectStore(name, transaction) }
      return transaction
    },
  }
  const open = vi.fn((_name: string, _version: number) => {
    const request: any = { result: database, transaction: { objectStore: (name: string) => objectStore(name) } }
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.() })
    return request
  })
  return { indexedDB: { open }, open }
}

function history(id: string, sourceImageId: string, createdAt: number) {
  return createColorAssistantHistoryRecord({
    id,
    sourceImageId,
    activeImageId: sourceImageId,
    instruction: '调整色彩',
    baseAdjustments: createDefaultColorAdjustments(),
    proposal: { explanation: '微调白平衡。', changes: [], curves: [], clarification: null },
    createdAt,
  })
}

describe('color assistant history database', () => {
  it('stores records, lists newest first, and persists an outcome update', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', createIndexedDbMock().indexedDB)
    const db = await import('./db')
    const older = history('older', 'source-a', 100)
    const newer = history('newer', 'source-a', 200)
    await db.putColorAssistantHistoryRecord(older)
    await db.putColorAssistantHistoryRecord(newer)

    expect(await db.getColorAssistantHistory('source-a')).toEqual([newer, older])
    await db.updateColorAssistantHistoryOutcome('older', 'applied', 300)
    expect(await db.getColorAssistantHistoryRecord('older')).toMatchObject({ outcome: 'applied', decidedAt: 300 })
  })

  it('deletes history with a removed source and clears all history with gallery images', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', createIndexedDbMock().indexedDB)
    const db = await import('./db')
    await db.putColorAssistantHistoryRecord(history('from-a', 'source-a', 100))
    await db.putColorAssistantHistoryRecord(history('from-b', 'source-b', 200))

    await db.deleteImage('source-a')
    expect(await db.getColorAssistantHistory('source-a')).toEqual([])
    expect(await db.getColorAssistantHistory('source-b')).toHaveLength(1)

    await db.clearImages()
    expect(await db.getColorAssistantHistory('source-b')).toEqual([])
  })
})
