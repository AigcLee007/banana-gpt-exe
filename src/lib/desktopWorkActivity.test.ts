import { describe, expect, it, vi } from 'vitest'
import { beginDesktopWork, hasDesktopWork, subscribeDesktopWork, withDesktopWork } from './desktopWorkActivity'

describe('desktop import activity', () => {
  it('stays busy across overlapping imports, with idempotent cleanup', () => {
    const changed = vi.fn(), stop = subscribeDesktopWork(changed)
    const first = beginDesktopWork(), second = beginDesktopWork()
    expect(hasDesktopWork()).toBe(true)
    first(); first()
    expect(hasDesktopWork()).toBe(true)
    second()
    expect(hasDesktopWork()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(4)
    stop()
  })
  it('releases busy protection after success or failure without losing the return value', async () => {
    expect(await withDesktopWork(async () => { expect(hasDesktopWork()).toBe(true); return 7 })).toBe(7)
    expect(hasDesktopWork()).toBe(false)
    await expect(withDesktopWork(async () => { throw new Error('read failed') })).rejects.toThrow('read failed')
    expect(hasDesktopWork()).toBe(false)
  })
})
