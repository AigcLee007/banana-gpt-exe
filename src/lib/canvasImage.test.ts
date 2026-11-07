// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadImage, toApiInputImageDataUrl } from './canvasImage'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function installImageCanvas() {
  const sources: string[] = []
  vi.stubGlobal('Image', class {
    naturalWidth = 800
    naturalHeight = 600
    onload?: () => void
    set src(value: string) { sources.push(value); queueMicrotask(() => this.onload?.()) }
  })
  const drawImage = vi.fn()
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (callback: BlobCallback) => callback(new Blob(['rasterized-first-frame'], { type: 'image/png' })) }
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
  return { sources, canvas, drawImage }
}

describe('API input image conversion', () => {
  it('passes ordinary raster inputs through without loading them', async () => {
    expect(await toApiInputImageDataUrl('data:image/webp;base64,YQ==')).toBe('data:image/webp;base64,YQ==')
  })

  it.each(['gif', 'svg+xml'])('rasterizes %s reference input as PNG with original dimensions', async (mime) => {
    const { canvas, drawImage } = installImageCanvas()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg width="800" height="600"/>')))
    const result = await toApiInputImageDataUrl(`data:image/${mime};base64,YQ==`)
    expect(result).toBe(`data:image/png;base64,${btoa('rasterized-first-frame')}`)
    expect(canvas).toMatchObject({ width: 800, height: 600 })
    expect(drawImage).toHaveBeenCalledTimes(1)
  })

  it('uses SVG viewBox dimensions for missing or percentage intrinsic sizes', async () => {
    const { sources } = installImageCanvas()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 1600 900"/>')))
    await loadImage('data:image/svg+xml;base64,YQ==')
    const source = decodeURIComponent(sources[0].split(',')[1])
    expect(source).toContain('width="1600"')
    expect(source).toContain('height="900"')
  })

  it('preserves explicitly sized SVG source', async () => {
    const { sources } = installImageCanvas()
    const original = 'data:image/svg+xml;base64,YQ=='
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg width="12mm" height="8mm" viewBox="0 0 1600 900"/>')))
    await loadImage(original)
    expect(sources).toEqual([original])
  })
})
