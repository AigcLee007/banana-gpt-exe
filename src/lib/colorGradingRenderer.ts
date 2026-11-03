import type { ColorAdjustments, ColorHistogram } from './colorGrading'

export interface ImageDimensions {
  width: number
  height: number
}

export interface ColorGradingWorkerPort {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
}

interface WorkerResponse {
  id: number
  type: 'loaded' | 'rendered' | 'exported' | 'progress' | 'cancelled' | 'error'
  width?: number
  height?: number
  bitmap?: ImageBitmap
  histogram?: ColorHistogram
  blob?: Blob
  progress?: number
  message?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  onProgress?: (progress: number) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export interface ColorGradingRenderer {
  load(source: Blob): Promise<ImageDimensions>
  renderPreview(adjustments: ColorAdjustments, maxEdge?: number): Promise<{ bitmap: ImageBitmap; histogram: ColorHistogram }>
  exportImage(
    adjustments: ColorAdjustments,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    quality: number,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob>
  dispose(): void
}

const DEFAULT_PREVIEW_EDGE = 1200

export function getPreviewDimensions(width: number, height: number, maxEdge = DEFAULT_PREVIEW_EDGE): ImageDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || maxEdge <= 0) {
    throw new Error('图片尺寸无效')
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function createColorGradingRenderer(workerFactory?: () => ColorGradingWorkerPort): ColorGradingRenderer {
  if (workerFactory) return new WorkerColorGradingRenderer(workerFactory())
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    const worker = new Worker(new URL('./colorGrading.worker.ts', import.meta.url), { type: 'module' })
    return new WorkerColorGradingRenderer(worker)
  }
  return new MainThreadColorGradingRenderer()
}

class WorkerColorGradingRenderer implements ColorGradingRenderer {
  private nextId = 1
  private sourceDimensions: ImageDimensions | null = null
  private pending = new Map<number, PendingRequest>()

  constructor(private worker: ColorGradingWorkerPort) {
    worker.onmessage = (event) => this.handleResponse(event.data as WorkerResponse)
    worker.onerror = (event) => {
      const error = new Error(event.message || '图片处理线程异常')
      for (const [id, request] of this.pending) this.finishRequest(id, request, error)
    }
  }

  load(source: Blob): Promise<ImageDimensions> {
    return this.request('load', { source }).then((value) => {
      this.sourceDimensions = value as ImageDimensions
      return this.sourceDimensions
    })
  }

  renderPreview(adjustments: ColorAdjustments, maxEdge = DEFAULT_PREVIEW_EDGE): Promise<{ bitmap: ImageBitmap; histogram: ColorHistogram }> {
    this.assertLoaded()
    return this.request('render', { adjustments, maxEdge }) as Promise<{ bitmap: ImageBitmap; histogram: ColorHistogram }>
  }

  exportImage(
    adjustments: ColorAdjustments,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    quality: number,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const dimensions = this.assertLoaded()
    return this.request('export', { adjustments, mimeType, quality, ...dimensions }, onProgress, signal) as Promise<Blob>
  }

  dispose() {
    this.worker.terminate()
    const error = new DOMException('图片处理已关闭', 'AbortError')
    for (const [id, request] of this.pending) this.finishRequest(id, request, error)
  }

  private assertLoaded() {
    if (!this.sourceDimensions) throw new Error('请先加载图片')
    return this.sourceDimensions
  }

  private request(type: 'load' | 'render' | 'export', data: Record<string, unknown>, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++
    if (signal?.aborted) return Promise.reject(new DOMException('导出已取消', 'AbortError'))
    return new Promise((resolve, reject) => {
      const request: PendingRequest = { resolve, reject, onProgress, signal }
      if (signal) {
        request.onAbort = () => {
          this.worker.postMessage({ type: 'cancel', id: this.nextId++, targetId: id })
          this.finishRequest(id, request, new DOMException('导出已取消', 'AbortError'))
        }
        signal.addEventListener('abort', request.onAbort, { once: true })
      }
      this.pending.set(id, request)
      this.worker.postMessage({ id, type, ...data })
    })
  }

  private handleResponse(response: WorkerResponse) {
    const request = this.pending.get(response.id)
    if (!request) {
      response.bitmap?.close()
      return
    }
    if (response.type === 'progress') {
      request.onProgress?.(Math.max(0, Math.min(1, response.progress ?? 0)))
      return
    }
    if (response.type === 'error' || response.type === 'cancelled') {
      const error = response.type === 'cancelled'
        ? new DOMException(response.message ?? '导出已取消', 'AbortError')
        : new Error(response.message ?? '图片处理失败')
      this.finishRequest(response.id, request, error)
      return
    }
    if (response.type === 'loaded') {
      this.finishRequest(response.id, request, null, { width: response.width!, height: response.height! })
      return
    }
    if (response.type === 'rendered') {
      this.finishRequest(response.id, request, null, { bitmap: response.bitmap!, histogram: response.histogram! })
      return
    }
    if (response.type === 'exported') this.finishRequest(response.id, request, null, response.blob!)
  }

  private finishRequest(id: number, request: PendingRequest, error: Error | null, value?: unknown) {
    this.pending.delete(id)
    if (request.signal && request.onAbort) request.signal.removeEventListener('abort', request.onAbort)
    if (error) request.reject(error)
    else request.resolve(value)
  }
}

class MainThreadColorGradingRenderer implements ColorGradingRenderer {
  private source: ImageBitmap | null = null
  private sourceDimensions: ImageDimensions | null = null
  private previewCanvas: HTMLCanvasElement | null = null
  private disposed = false

  async load(blob: Blob): Promise<ImageDimensions> {
    this.disposeSource()
    this.source = await createImageBitmap(blob)
    this.sourceDimensions = { width: this.source.width, height: this.source.height }
    const previewSize = getPreviewDimensions(this.source.width, this.source.height)
    this.previewCanvas = document.createElement('canvas')
    this.previewCanvas.width = previewSize.width
    this.previewCanvas.height = previewSize.height
    return this.sourceDimensions
  }

  async renderPreview(adjustments: ColorAdjustments, maxEdge = DEFAULT_PREVIEW_EDGE): Promise<{ bitmap: ImageBitmap; histogram: ColorHistogram }> {
    const { computeColorHistogram, processColorPixels } = await import('./colorGrading')
    if (!this.source || !this.previewCanvas) throw new Error('请先加载图片')
    const size = getPreviewDimensions(this.source.width, this.source.height, Math.min(DEFAULT_PREVIEW_EDGE, maxEdge))
    const canvas = size.width === this.previewCanvas.width && size.height === this.previewCanvas.height
      ? this.previewCanvas
      : document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器不支持图片处理')
    const image = this.source
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const source = context.getImageData(0, 0, canvas.width, canvas.height)
    const output = processColorPixels(source.data, canvas.width, canvas.height, adjustments)
    const result = new ImageData(new Uint8ClampedArray(output), canvas.width, canvas.height)
    context.putImageData(result, 0, 0)
    return { bitmap: await createImageBitmap(canvas), histogram: computeColorHistogram(output, canvas.width, canvas.height) }
  }

  async exportImage(
    adjustments: ColorAdjustments,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    quality: number,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (!this.source || !this.sourceDimensions) throw new Error('请先加载图片')
    if (this.source.width * this.source.height > 80_000_000 || Math.max(this.source.width, this.source.height) > 16_384) {
      throw new Error('图片尺寸超过当前浏览器的导出能力')
    }
    const { processColorPixels } = await import('./colorGrading')
    const output = document.createElement('canvas')
    output.width = this.source.width
    output.height = this.source.height
    const context = output.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器不支持图片处理')
    const tileHeight = Math.max(1, Math.min(256, Math.floor(4_194_304 / output.width)))
    const tiles = Math.ceil(output.height / tileHeight)
    for (let tile = 0; tile < tiles; tile++) {
      if (signal?.aborted || this.disposed) throw new DOMException('导出已取消', 'AbortError')
      const y = tile * tileHeight
      const height = Math.min(tileHeight, output.height - y)
      if (mimeType === 'image/jpeg') {
        context.fillStyle = '#fff'
        context.fillRect(0, y, output.width, height)
      }
      context.drawImage(this.source, 0, y, output.width, height, 0, y, output.width, height)
      const source = context.getImageData(0, y, output.width, height)
      context.putImageData(new ImageData(new Uint8ClampedArray(processColorPixels(source.data, output.width, height, adjustments)), output.width, height), 0, y)
      onProgress?.((tile + 1) / tiles)
      await yieldToMainThread()
    }
    return canvasToBlob(output, mimeType, quality)
  }

  dispose() {
    this.disposed = true
    this.disposeSource()
  }

  private disposeSource() {
    this.source?.close()
    this.source = null
    this.sourceDimensions = null
    this.previewCanvas = null
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片导出失败'))
      } else if (blob.type !== mimeType) {
        reject(new Error(`当前浏览器不支持 ${mimeType} 格式导出`))
      } else {
        resolve(blob)
      }
    }, mimeType, quality)
  })
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}
