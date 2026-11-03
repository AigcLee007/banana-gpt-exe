import { computeColorHistogram, processColorPixels, type ColorAdjustments } from './colorGrading'
import { getPreviewDimensions } from './colorGradingRenderer'

interface WorkerRequest {
  id: number
  type: 'load' | 'render' | 'export' | 'cancel'
  source?: Blob
  adjustments?: ColorAdjustments
  maxEdge?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  targetId?: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

interface LoadedImage {
  bitmap: ImageBitmap
  preview: ImageData
  draftPreview: ImageData
  width: number
  height: number
}

const scope = self as unknown as WorkerScope
const MAX_EXPORT_PIXELS = 80_000_000
const MAX_EXPORT_EDGE = 16_384
const EXPORT_TILE_PIXELS = 4_194_304
const DRAFT_PREVIEW_EDGE = 640
let loadedImage: LoadedImage | null = null
const cancelledExports = new Set<number>()
let latestPreviewId = 0

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (request.targetId !== undefined) cancelledExports.add(request.targetId)
    return
  }
  if (request.type === 'load') {
    void loadImage(request)
    return
  }
  if (request.type === 'render') {
    latestPreviewId = request.id
    void renderPreview(request)
    return
  }
  if (request.type === 'export') void exportImage(request)
}

async function loadImage(request: WorkerRequest) {
  try {
    if (!request.source) throw new Error('图片文件为空')
    const bitmap = await createImageBitmap(request.source)
    if (bitmap.width < 1 || bitmap.height < 1) {
      bitmap.close()
      throw new Error('图片尺寸无效')
    }
    const previewSize = getPreviewDimensions(bitmap.width, bitmap.height)
    const previewCanvas = new OffscreenCanvas(previewSize.width, previewSize.height)
    const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true })
    if (!previewContext) {
      bitmap.close()
      throw new Error('当前浏览器不支持图片处理')
    }
    previewContext.drawImage(bitmap, 0, 0, previewSize.width, previewSize.height)
    const preview = previewContext.getImageData(0, 0, previewSize.width, previewSize.height)
    const draftSize = getPreviewDimensions(bitmap.width, bitmap.height, DRAFT_PREVIEW_EDGE)
    const draftCanvas = new OffscreenCanvas(draftSize.width, draftSize.height)
    const draftContext = draftCanvas.getContext('2d', { willReadFrequently: true })
    if (!draftContext) {
      bitmap.close()
      throw new Error('当前浏览器不支持图片处理')
    }
    draftContext.drawImage(bitmap, 0, 0, draftSize.width, draftSize.height)
    const draftPreview = draftContext.getImageData(0, 0, draftSize.width, draftSize.height)
    loadedImage?.bitmap.close()
    loadedImage = { bitmap, preview, draftPreview, width: bitmap.width, height: bitmap.height }
    scope.postMessage({ id: request.id, type: 'loaded', width: bitmap.width, height: bitmap.height })
  } catch (error) {
    postError(request.id, error)
  }
}

function renderPreview(request: WorkerRequest) {
  try {
    if (!loadedImage || !request.adjustments) throw new Error('请先加载图片')
    const { preview: fullPreview, draftPreview } = loadedImage
    const preview = request.maxEdge !== undefined && request.maxEdge <= DRAFT_PREVIEW_EDGE ? draftPreview : fullPreview
    const pixels = new Uint8ClampedArray(processColorPixels(preview.data, preview.width, preview.height, request.adjustments))
    if (request.id !== latestPreviewId) {
      scope.postMessage({ id: request.id, type: 'cancelled', message: '预览已被较新的调整替换' })
      return
    }
    const previewCanvas = new OffscreenCanvas(preview.width, preview.height)
    const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true })
    if (!previewContext) throw new Error('当前浏览器不支持图片处理')
    previewContext.putImageData(new ImageData(pixels, preview.width, preview.height), 0, 0)
    const bitmap = previewCanvas.transferToImageBitmap()
    const histogram = computeColorHistogram(pixels, preview.width, preview.height)
    scope.postMessage({ id: request.id, type: 'rendered', bitmap, histogram }, [bitmap])
  } catch (error) {
    postError(request.id, error)
  }
}

async function exportImage(request: WorkerRequest) {
  try {
    if (!loadedImage || !request.adjustments || !request.mimeType) throw new Error('请先加载图片')
    const { bitmap, width, height } = loadedImage
    if (width * height > MAX_EXPORT_PIXELS || Math.max(width, height) > MAX_EXPORT_EDGE) {
      throw new Error('图片尺寸超过当前浏览器的导出能力')
    }
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器不支持图片处理')
    const tileHeight = Math.max(1, Math.min(512, Math.floor(EXPORT_TILE_PIXELS / width)))
    const tileCount = Math.ceil(height / tileHeight)
    for (let tile = 0; tile < tileCount; tile++) {
      if (cancelledExports.delete(request.id)) throw new DOMException('导出已取消', 'AbortError')
      const y = tile * tileHeight
      const currentHeight = Math.min(tileHeight, height - y)
      if (request.mimeType === 'image/jpeg') {
        context.fillStyle = '#fff'
        context.fillRect(0, y, width, currentHeight)
      }
      context.drawImage(bitmap, 0, y, width, currentHeight, 0, y, width, currentHeight)
      const source = context.getImageData(0, y, width, currentHeight)
      const pixels = processColorPixels(source.data, width, currentHeight, request.adjustments)
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, currentHeight), 0, y)
      scope.postMessage({ id: request.id, type: 'progress', progress: (tile + 1) / tileCount })
      await yieldToWorker()
    }
    if (cancelledExports.delete(request.id)) throw new DOMException('导出已取消', 'AbortError')
    const blob = await canvas.convertToBlob({ type: request.mimeType, quality: request.quality })
    if (blob.type !== request.mimeType) throw new Error(`当前浏览器不支持 ${request.mimeType} 格式导出`)
    scope.postMessage({ id: request.id, type: 'exported', blob })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      scope.postMessage({ id: request.id, type: 'cancelled', message: error.message })
    } else {
      postError(request.id, error)
    }
  }
}

function postError(id: number, error: unknown) {
  scope.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : '图片处理失败' })
}

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
