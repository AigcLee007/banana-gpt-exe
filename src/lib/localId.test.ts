import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalId } from './localId'

afterEach(() => vi.unstubAllGlobals())

describe('local record IDs', () => {
  it('uses native UUIDs when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-uuid' })
    expect(createLocalId()).toBe('native-uuid')
  })

  it('uses random bytes on HTTP pages without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    const ids = Array.from({ length: 100 }, () => createLocalId())
    expect(new Set(ids).size).toBe(100)
    expect(ids.every((id) => /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(id))).toBe(true)
  })

  it('keeps local records distinct even without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined)
    const ids = Array.from({ length: 100 }, () => createLocalId())
    expect(new Set(ids).size).toBe(100)
    expect(ids.every(Boolean)).toBe(true)
  })
})
