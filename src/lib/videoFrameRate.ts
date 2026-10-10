interface Atom { type: string; start: number; end: number }

/** Returns complete child atoms only; malformed lengths never escape their parent. */
function atoms(view: DataView, start: number, end: number): Atom[] | undefined {
  const result: Atom[] = []
  let offset = start
  while (offset < end) {
    if (end - offset < 8) return undefined
    let size = view.getUint32(offset)
    const type = String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(offset + 4 + index)))
    let header = 8
    if (size === 1) {
      if (end - offset < 16) return undefined
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12)
      header = 16
    } else if (size === 0) size = end - offset
    if (!Number.isSafeInteger(size) || size < header || size > end - offset) return undefined
    result.push({ type, start: offset + header, end: offset + size })
    offset += size
  }
  return result
}

function children(view: DataView, atom: Atom, type: string): Atom[] {
  return atoms(view, atom.start, atom.end)?.filter((child) => child.type === type) ?? []
}

function readTrackRate(view: DataView, track: Atom): number | undefined {
  for (const mdia of children(view, track, 'mdia')) {
    const handler = children(view, mdia, 'hdlr')[0]
    if (!handler || handler.end - handler.start < 12) continue
    const type = String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(handler.start + 8 + index)))
    if (type !== 'vide') continue
    const header = children(view, mdia, 'mdhd')[0]
    if (!header || header.end - header.start < 4) continue
    const version = view.getUint8(header.start)
    const timescaleOffset = version === 0 ? 12 : version === 1 ? 20 : -1
    if (timescaleOffset < 0 || header.end - header.start < timescaleOffset + 4) continue
    const timescale = view.getUint32(header.start + timescaleOffset)
    if (!timescale) continue
    for (const minf of children(view, mdia, 'minf')) {
      for (const stbl of children(view, minf, 'stbl')) {
        const timing = children(view, stbl, 'stts')[0]
        if (!timing || timing.end - timing.start < 8 || view.getUint8(timing.start) !== 0) continue
        const entryCount = view.getUint32(timing.start + 4)
        if (!entryCount || entryCount > Math.floor((timing.end - timing.start - 8) / 8)) continue
        let samples = 0
        let ticks = 0
        let valid = true
        for (let index = 0; index < entryCount; index++) {
          const offset = timing.start + 8 + index * 8
          const count = view.getUint32(offset)
          const delta = view.getUint32(offset + 4)
          samples += count
          ticks += count * delta
          if (!count || !delta || !Number.isSafeInteger(samples) || !Number.isSafeInteger(ticks)) { valid = false; break }
        }
        const rate = samples / ticks * timescale
        if (valid && Number.isFinite(rate) && rate > 0) return rate
      }
    }
  }
  return undefined
}

/** MP4/MOV average frame rate from the video track's media timescale and sample timing. */
export async function getVideoFrameRate(blob: Blob): Promise<number | undefined> {
  try {
    const buffer = await blob.arrayBuffer()
    const view = new DataView(buffer)
    for (const movie of atoms(view, 0, buffer.byteLength)?.filter((atom) => atom.type === 'moov') ?? []) {
      for (const track of children(view, movie, 'trak')) {
        const rate = readTrackRate(view, track)
        if (rate !== undefined) return rate
      }
    }
  } catch { /* Unreadable or malformed metadata cannot establish a valid frame rate. */ }
  return undefined
}
