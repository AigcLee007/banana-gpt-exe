import { describe, expect, it } from 'vitest'
import { getVideoFrameRate } from './videoFrameRate'

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function join(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}

function atom(type: string, payload: Uint8Array, extended = false) {
  const name = new TextEncoder().encode(type)
  return extended ? join(u32(1), name, u32(0), u32(payload.length + 16), payload) : join(u32(payload.length + 8), name, payload)
}

function track(type: string, timescale: number, entries: Array<[number, number]>, version = 0) {
  const mdhd = new Uint8Array(version === 1 ? 36 : 24)
  mdhd[0] = version
  new DataView(mdhd.buffer).setUint32(version === 1 ? 20 : 12, timescale)
  const handler = join(new Uint8Array(8), new TextEncoder().encode(type), new Uint8Array(12))
  const timing = join(new Uint8Array(4), u32(entries.length), ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]))
  return atom('trak', atom('mdia', join(atom('mdhd', mdhd), atom('hdlr', handler), atom('minf', atom('stbl', atom('stts', timing))))))
}

describe('getVideoFrameRate', () => {
  it('reads a standard MP4 video track rather than its audio track', async () => {
    const bytes = atom('moov', join(track('soun', 48000, [[240, 1024]]), track('vide', 30000, [[240, 1001]])))
    expect(await getVideoFrameRate(new Blob([bytes]))).toBeCloseTo(29.97003, 5)
  })

  it('reads MOV version-one timescale and extended-size atoms', async () => {
    const bytes = atom('moov', track('vide', 24000, [[96, 1000]], 1), true)
    expect(await getVideoFrameRate(new Blob([bytes], { type: 'video/quicktime' }))).toBe(24)
  })

  it('averages variable sample timing using sample counts', async () => {
    const bytes = atom('moov', track('vide', 60000, [[60, 1000], [30, 2000]]))
    expect(await getVideoFrameRate(new Blob([bytes]))).toBe(45)
  })

  it('supports a top-level atom that extends to the end of the file', async () => {
    const bytes = atom('moov', track('vide', 60000, [[120, 1000]]))
    bytes.set(u32(0), 0)
    expect(await getVideoFrameRate(new Blob([bytes]))).toBe(60)
  })

  it.each([
    new Uint8Array(),
    join(u32(7), new TextEncoder().encode('moov')),
    join(u32(500), new TextEncoder().encode('moov')),
    join(u32(1), new TextEncoder().encode('moov'), u32(0)),
    atom('moov', track('soun', 48000, [[120, 1024]])),
    atom('moov', track('vide', 0, [[120, 1000]])),
    atom('moov', track('vide', 24000, [[120, 0]])),
    atom('moov', track('vide', 24000, [])),
    atom('moov', track('vide', 24000, [[120, 1000]], 2)),
  ])('returns undefined for missing or malformed timing %#', async (bytes) => {
    expect(await getVideoFrameRate(new Blob([bytes]))).toBeUndefined()
  })

  it('rejects truncated stts entries without reading outside atom bounds', async () => {
    const bytes = atom('moov', track('vide', 24000, [[120, 1000]]))
    const text = new TextDecoder().decode(bytes)
    new DataView(bytes.buffer).setUint32(text.indexOf('stts') + 8, 0xffffffff)
    expect(await getVideoFrameRate(new Blob([bytes]))).toBeUndefined()
  })

  it('returns undefined when the blob cannot be read', async () => {
    const blob = new Blob()
    blob.arrayBuffer = async () => { throw new Error('read failed') }
    expect(await getVideoFrameRate(blob)).toBeUndefined()
  })
})
