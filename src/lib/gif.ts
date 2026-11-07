export interface GifMetadata {
  frameCount: number
  frameDurationsMs: number[]
  durationMs: number
}

// Walk GIF blocks, not compressed image bytes: both payloads and comments may
// contain image-separator bytes that are unrelated to actual frames.
export function readGifMetadata(dataUrl: string): GifMetadata | null {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  try {
    const binary = atob(match[1])
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    if (bytes.length < 13 || !['GIF87a', 'GIF89a'].includes(binary.slice(0, 6))) return null
    if (!(bytes[6] | bytes[7]) || !(bytes[8] | bytes[9])) return null
    let offset = 13
    if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 7) + 1))
    const frameDurationsMs: number[] = []
    let delay = 0
    const skipSubBlocks = () => {
      while (offset < bytes.length) {
        const size = bytes[offset++]
        if (!size) return true
        offset += size
        if (offset > bytes.length) return false
      }
      return false
    }
    while (offset < bytes.length) {
      const marker = bytes[offset++]
      if (marker === 0x3b) {
        return frameDurationsMs.length ? {
          frameCount: frameDurationsMs.length,
          frameDurationsMs,
          durationMs: frameDurationsMs.reduce((sum, value) => sum + value, 0),
        } : null
      }
      if (marker === 0x21) {
        if (offset >= bytes.length) return null
        const label = bytes[offset++]
        if (label === 0xf9) {
          if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset + 5] !== 0) return null
          delay = (bytes[offset + 2] | (bytes[offset + 3] << 8)) * 10
        }
        if (!skipSubBlocks()) return null
      } else if (marker === 0x2c) {
        if (offset + 9 > bytes.length) return null
        if (!(bytes[offset + 4] | bytes[offset + 5]) || !(bytes[offset + 6] | bytes[offset + 7])) return null
        const packed = bytes[offset + 8]
        offset += 9
        if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1))
        if (offset + 1 >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8 || bytes[offset + 1] === 0) return null
        offset++ // LZW minimum code size
        if (!skipSubBlocks()) return null
        frameDurationsMs.push(delay)
        delay = 0
      } else {
        return null
      }
    }
  } catch {
    // Malformed base64 is an invalid GIF too.
  }
  return null
}
