import { assertUsableMaskCoverage, classifyMaskAlpha, type MaskCoverage } from './mask'

export interface ImageDimensions {
  width: number
  height: number
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const src = await withSvgIntrinsicSize(dataUrl)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

/** Give responsive SVGs their viewBox dimensions before drawing them to a canvas. */
async function withSvgIntrinsicSize(dataUrl: string): Promise<string> {
  if (!/^data:image\/svg\+xml[;,]/i.test(dataUrl)) return dataUrl
  const svg = new DOMParser().parseFromString(await (await fetch(dataUrl)).text(), 'image/svg+xml').documentElement
  const hasSize = (name: string) => !/^(|auto|.*%)$/i.test(svg.getAttribute(name)?.trim() ?? '')
  if (hasSize('width') && hasSize('height')) return dataUrl
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (!box || box.length !== 4 || !(box[2] > 0) || !(box[3] > 0)) return dataUrl
  svg.setAttribute('width', String(box[2]))
  svg.setAttribute('height', String(box[3]))
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
}

export async function getImageDimensions(dataUrl: string): Promise<ImageDimensions> {
  const image = await loadImage(dataUrl)
  return { width: image.naturalWidth, height: image.naturalHeight }
}

export async function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png'): Promise<Blob> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: fallbackType })
}

export async function imageDataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

/** API references accept raster images; GIF inputs use the frame available at load. */
export async function toApiInputImageDataUrl(dataUrl: string): Promise<string> {
  if (!/^data:image\/(svg\+xml|gif)[;,]/i.test(dataUrl)) return dataUrl
  const blob = await imageDataUrlToPngBlob(dataUrl)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

export async function maskDataUrlToPngBlob(maskDataUrl: string): Promise<Blob> {
  const blob = await dataUrlToBlob(maskDataUrl, 'image/png')
  if (blob.type !== 'image/png') {
    return imageDataUrlToPngBlob(maskDataUrl)
  }
  return blob
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('图片导出失败'))
      else resolve(blob)
    }, type, quality)
  })
}

export async function validateMaskMatchesImage(maskDataUrl: string, imageDataUrl: string): Promise<MaskCoverage> {
  const [maskImage, sourceImage] = await Promise.all([loadImage(maskDataUrl), loadImage(imageDataUrl)])
  if (maskImage.naturalWidth !== sourceImage.naturalWidth || maskImage.naturalHeight !== sourceImage.naturalHeight) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = maskImage.naturalWidth
  canvas.height = maskImage.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(maskImage, 0, 0)
  const coverage = classifyMaskAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height))
  assertUsableMaskCoverage(coverage)
  return coverage
}

export async function createMaskPreviewDataUrl(imageDataUrl: string, maskDataUrl: string): Promise<string> {
  const [image, mask] = await Promise.all([loadImage(imageDataUrl), loadImage(maskDataUrl)])
  if (image.naturalWidth !== mask.naturalWidth || image.naturalHeight !== mask.naturalHeight) {
    throw new Error('遮罩尺寸与遮罩主图不一致，请重新绘制遮罩')
  }

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  ctx.drawImage(image, 0, 0)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = mask.naturalWidth
  maskCanvas.height = mask.naturalHeight
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) throw new Error('当前浏览器不支持 Canvas')
  maskCtx.drawImage(mask, 0, 0)
  const maskPixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

  const overlay = ctx.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < maskPixels.data.length; i += 4) {
    const editStrength = 255 - maskPixels.data[i + 3]
    overlay.data[i] = 59
    overlay.data[i + 1] = 130
    overlay.data[i + 2] = 246
    overlay.data[i + 3] = Math.round(editStrength * 0.58)
  }

  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.width = canvas.width
  overlayCanvas.height = canvas.height
  const overlayCtx = overlayCanvas.getContext('2d')
  if (!overlayCtx) throw new Error('当前浏览器不支持 Canvas')
  overlayCtx.putImageData(overlay, 0, 0)
  ctx.drawImage(overlayCanvas, 0, 0)
  return canvas.toDataURL('image/png')
}
