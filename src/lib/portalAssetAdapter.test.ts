import { describe, expect, it } from 'vitest'
import { validateAssetSelection, createArchiveQueue, localAssetRows } from './portalAssetAdapter'

const image = { asset: { id: 'i', kind: 'image', title: 'Image', mime: 'image/png' }, blob: new Blob(['image'], { type: 'image/png' }) }
describe('Portal asset adapter', () => {
  it('validates the whole selection before a native draft is touched', () => {
    expect(() => validateAssetSelection([image, { ...image, asset: { ...image.asset, kind: 'video' } }], { image: 16, text: 1 })).toThrow('类型')
    expect(() => validateAssetSelection([image], { image: 0, text: 1 })).toThrow('数量')
    expect(() => validateAssetSelection([image], { image: 1, text: 1 })).not.toThrow()
  })
  it('rejects mismatched bytes and MIME', () => {
    expect(() => validateAssetSelection([{ ...image, blob: new Blob(['bad'], { type: 'text/html' }) }], { image: 16 })).toThrow('类型')
  })
  it('lists only safe local metadata and reads bytes only after selection', async () => {
    let loads = 0
    const rows = localAssetRows([{ id: 'x', title: 'Local', kind: 'image', apiProfile: { apiKey: 'secret' }, load: async () => { loads++; return { blob: image.blob } } }])
    expect(loads).toBe(0)
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'kind', 'load', 'title'])
    await rows[0].load()
    expect(loads).toBe(1)
  })
  it('persists pure retry records, isolates owners and recovers an upload failure', async () => {
    let owner = 1
    let fail = true
    const persisted: string[] = []
    const saves: string[] = []
    const queue = createArchiveQueue({ owner: () => owner, persist: value => persisted.push(value), load: async () => ({ blob: image.blob }), save: async input => { if (fail) throw Error('offline'); saves.push(input.sourceRef!); return { id: 'ready' } } })
    await queue.add({ id: 'new', title: 'New upload', source: 'gallery', sourceRef: 'image:new' })
    expect(queue.records()[0].status).toBe('failed')
    expect(JSON.stringify(queue.records())).not.toMatch(/blob|secret|apiKey/)
    owner = 2
    await queue.retry()
    expect(saves).toEqual([])
    owner = 1; fail = false
    await queue.retry()
    expect(queue.records()).toEqual([])
    expect(saves).toEqual(['image:new'])
    expect(persisted.length).toBeGreaterThan(1)
  })
  it('never scans or replays local records on creation', () => {
    let loaded = false
    const queue = createArchiveQueue({ owner: () => 1, persist: () => {}, load: async () => { loaded = true; return {} }, save: async () => ({ id: 'x' }) })
    expect(queue.records()).toEqual([])
    expect(loaded).toBe(false)
  })
  it('shows interrupted pending records as retryable without replaying on startup', () => {
    const queue = createArchiveQueue({ owner: () => 1, persist: () => {}, load: async () => ({}), save: async () => ({ id: 'x' }) }, [{ id: 'interrupted', owner: 1, title: 'Interrupted', source: 'gallery', sourceRef: 'image:interrupted', status: 'pending' }])
    expect(queue.records()[0].status).toBe('failed')
  })
  it('normalizes generated prompt titles before persisting and retrying', async () => {
    const titles: string[] = []
    const queue = createArchiveQueue({ owner: () => 1, persist: () => {}, load: async () => ({}), save: async input => { titles.push(input.title); return { id: 'x' } } }, [{ id: 'old', owner: 1, title: 'Old\nvideo\u0000', source: 'canvas', sourceRef: 'generated:old', status: 'failed' }])
    expect(queue.records()[0].title).toBe('Old video')
    await queue.retry()
    await queue.add({ id: 'new', title: '  A\n\tvideo\u0000\u0085 title  ', source: 'canvas', sourceRef: 'generated:new' })
    await queue.add({ id: 'long', title: '🎨'.repeat(201), source: 'gallery', sourceRef: 'image:long' })
    expect(titles).toEqual(['Old video', 'A video title', '🎨'.repeat(200)])
  })
})
