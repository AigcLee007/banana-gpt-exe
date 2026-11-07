import { describe, expect, it } from 'vitest'
import { readGifMetadata } from './gif'

const staticGif = 'R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgACAAAIBgABCAQQEAA7'
const animatedGif = 'R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBFAABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7'

describe('GIF animation metadata', () => {
  it('distinguishes a single-frame GIF from an animation', () => {
    expect(readGifMetadata(`data:image/gif;base64,${staticGif}`)).toEqual({ frameCount: 1, frameDurationsMs: [200], durationMs: 200 })
    expect(readGifMetadata(`data:image/gif;base64,${animatedGif}`)).toEqual({ frameCount: 2, frameDurationsMs: [200, 200], durationMs: 400 })
  })

  it('skips image markers inside extension data rather than counting bytes', () => {
    const binary = atob(staticGif)
    const comment = '\x21\xfe\x03\x2c\x2c\x2c\x00'
    const withComment = binary.slice(0, -1) + comment + binary.slice(-1)
    expect(readGifMetadata(`data:image/gif;base64,${btoa(withComment)}`)?.frameCount).toBe(1)
  })

  it('rejects malformed files, non-GIF bytes and unavailable remote bytes', () => {
    for (const source of ['data:image/gif;base64,R0lGODlh', 'data:image/gif;base64,cG5n', 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAACACwAAAAAAQABAAACADs=', 'https://example.com/a.gif', `data:image/gif;base64,${animatedGif.slice(0, -8)}`]) {
      expect(readGifMetadata(source)).toBeNull()
    }
  })
})
