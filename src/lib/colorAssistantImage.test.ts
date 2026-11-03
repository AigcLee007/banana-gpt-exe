import { afterEach, describe, expect, it, vi } from 'vitest'
import { createColorAssistantImagePayload, createColorAssistantPreviewDataUrl } from './colorAssistantImage'

let imageSize = { width: 1600, height: 900 }
let imageLoadError: Error | null = null
let context: {
  clearRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  fillRect: ReturnType<typeof vi.fn>
  getImageData: ReturnType<typeof vi.fn>
  fillStyle: string
} | null = null
let canvas: {
  width: number
  height: number
  getContext: ReturnType<typeof vi.fn>
  toBlob: ReturnType<typeof vi.fn>
} | null = null
let imageInstance: { onload: null | (() => void); onerror: null | ((error: Error) => void); src: string } | null = null

class MockImage {
  naturalWidth = imageSize.width
  naturalHeight = imageSize.height
  onload: null | (() => void) = null
  onerror: null | ((error: Error) => void) = null
  private source = ''

  set src(value: string) {
    this.source = value
    imageInstance = this
    queueMicrotask(() => {
      if (imageLoadError) this.onerror?.(imageLoadError)
      else this.onload?.()
    })
  }

  get src() {
    return this.source
  }
}

class MockFileReader {
  result: string | ArrayBuffer | null = null
  error: Error | null = null
  onload: null | (() => void) = null
  onerror: null | (() => void) = null

  readAsDataURL(blob: Blob) {
    if (blob.type !== 'image/jpeg') {
      this.error = new Error('Expected JPEG blob')
      this.onerror?.()
      return
    }
    this.result = 'data:image/jpeg;base64,anBlZw=='
    queueMicrotask(() => this.onload?.())
  }
}

function installCanvas(options: { contextAvailable?: boolean; blob?: Blob | null; pixelData?: Uint8ClampedArray } = {}) {
  context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: options.pixelData ?? makeNeutralPixelData(width, height),
    })),
    fillStyle: '',
  }
  canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => options.contextAvailable === false ? null : context),
    toBlob: vi.fn((callback: BlobCallback) => callback(options.blob === undefined
      ? new Blob(['jpeg'], { type: 'image/jpeg' })
      : options.blob)),
  }
  vi.stubGlobal('Image', MockImage)
  vi.stubGlobal('FileReader', MockFileReader)
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

function makeNeutralPixelData(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 128
    data[offset + 1] = 128
    data[offset + 2] = 128
    data[offset + 3] = 255
  }
  return data
}

describe('createColorAssistantPreviewDataUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    imageSize = { width: 1600, height: 900 }
    imageLoadError = null
    imageInstance = null
    context = null
    canvas = null
  })

  it.each([
    ['landscape', { width: 1600, height: 900 }, 768, 432],
    ['portrait', { width: 900, height: 1600 }, 432, 768],
    ['already-small', { width: 320, height: 200 }, 320, 200],
  ])('bounds %s previews to a 768px maximum edge', async (_name, dimensions, width, height) => {
    imageSize = dimensions
    installCanvas()

    const result = await createColorAssistantPreviewDataUrl('blob:editor-preview')

    expect(result).toBe('data:image/jpeg;base64,anBlZw==')
    expect(canvas?.width).toBe(width)
    expect(canvas?.height).toBe(height)
    expect(canvas?.getContext).toHaveBeenCalledWith('2d')
    expect(context?.fillStyle).toBe('#808080')
    expect(context?.fillRect).toHaveBeenCalledWith(0, 0, width, height)
    expect(context?.drawImage).toHaveBeenCalledWith(imageInstance, 0, 0, width, height)
    expect(canvas?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.82)
    expect(imageInstance?.onload).toBeNull()
    expect(imageInstance?.onerror).toBeNull()
  })

  it('rejects when the preview image fails to load', async () => {
    imageLoadError = new Error('preview unavailable')
    installCanvas()

    await expect(createColorAssistantPreviewDataUrl('blob:missing-preview')).rejects.toThrow('无法读取当前调色预览')
  })

  it('rejects when the browser cannot create a canvas context', async () => {
    installCanvas({ contextAvailable: false })

    await expect(createColorAssistantPreviewDataUrl('blob:editor-preview')).rejects.toThrow()
    expect(canvas?.toBlob).not.toHaveBeenCalled()
  })

  it('rejects when JPEG encoding returns no blob', async () => {
    installCanvas({ blob: null })

    await expect(createColorAssistantPreviewDataUrl('blob:editor-preview')).rejects.toThrow()
  })
})

describe('createColorAssistantImagePayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    imageSize = { width: 1600, height: 900 }
    imageLoadError = null
    imageInstance = null
    context = null
    canvas = null
  })

  it('returns image statistics from the same bounded preview canvas', async () => {
    imageSize = { width: 4, height: 4 }
    const pixelData = new Uint8ClampedArray(4 * 4 * 4)
    for (let offset = 0; offset < pixelData.length; offset += 4) {
      pixelData[offset] = 192
      pixelData[offset + 1] = 160
      pixelData[offset + 2] = 160
      pixelData[offset + 3] = 255
    }
    installCanvas({ pixelData })

    const result = await createColorAssistantImagePayload('blob:editor-preview')

    expect(result.previewImageDataUrl).toBe('data:image/jpeg;base64,anBlZw==')
    expect(result.analysis.width).toBe(4)
    expect(result.analysis.height).toBe(4)
    expect(result.analysis.sampledPixels).toBe(16)
    expect(result.analysis.lowChromaCandidates.medianLab?.a).toBeGreaterThan(0)
    expect(context?.getImageData).toHaveBeenCalledWith(0, 0, 4, 4)
  })

  it('reads source alpha before flattening transparent pixels into the JPEG preview', async () => {
    imageSize = { width: 2, height: 1 }
    installCanvas({ pixelData: new Uint8ClampedArray([255, 0, 0, 0, 128, 128, 128, 255]) })

    const result = await createColorAssistantImagePayload('blob:transparent-preview')

    expect(result.analysis.sampledPixels).toBe(1)
    expect(result.analysis.ignoredTransparentSamples).toBe(1)
    expect(result.analysis.channels.red.mean).toBe(128)
    expect(context?.fillRect).toHaveBeenCalledWith(0, 0, 2, 1)
  })
})
