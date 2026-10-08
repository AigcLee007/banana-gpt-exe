import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaRecord } from './videoTypes'

const saved = vi.hoisted(() => new Map<string, MediaRecord>())
vi.mock('./db', () => ({
  dbTransaction: async (_store: string, _mode: string, operation: (store: unknown) => unknown) =>
    operation({ put: (media: MediaRecord) => { saved.set(media.id, media); return media.id } }),
}))

import { uploadMediaFile } from './videoDb'

afterEach(() => {
  vi.unstubAllGlobals()
  saved.clear()
})

describe('video media uploads on LAN HTTP', () => {
  it('saves an image when crypto.randomUUID and subtle are unavailable', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    vi.stubGlobal('Image', class {
      naturalWidth = 64
      naturalHeight = 32
      onload?: () => void
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    })
    const file = new File(['mock PNG content'], 'frame.png', { type: 'image/png' })
    const id = await uploadMediaFile(file, 'upload')
    expect(saved.get(id)).toMatchObject({ id, filename: 'frame.png', mime: 'image/png', width: 64, height: 32 })
    expect(await saved.get(id)!.blob.text()).toBe('mock PNG content')
    expect(await uploadMediaFile(file, 'upload')).not.toBe(id)
  })
})
