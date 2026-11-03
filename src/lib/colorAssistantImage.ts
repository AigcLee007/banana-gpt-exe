import { analyzeImageColors, type ColorImageAnalysis } from './colorImageAnalysis'

const COLOR_ASSISTANT_PREVIEW_MAX_EDGE = 768
const COLOR_ASSISTANT_PREVIEW_JPEG_QUALITY = 0.82
const TRANSPARENCY_PREVIEW_BACKGROUND = '#808080'

export async function createColorAssistantPreviewDataUrl(previewUrl: string): Promise<string> {
  const payload = await createColorAssistantImagePayload(previewUrl)
  return payload.previewImageDataUrl
}

export async function createColorAssistantImagePayload(previewUrl: string): Promise<{
  previewImageDataUrl: string
  analysis: ColorImageAnalysis
}> {
  const image = new Image()

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('无法读取当前调色预览'))
      image.src = previewUrl
    })

    const sourceWidth = image.naturalWidth
    const sourceHeight = image.naturalHeight
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
      throw new Error('当前调色预览尺寸无效')
    }

    const scale = Math.min(1, COLOR_ASSISTANT_PREVIEW_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建调色预览画布')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)
    const sourcePixels = context.getImageData(0, 0, width, height)
    const analysis = analyzeImageColors(sourcePixels.data, width, height)

    context.fillStyle = TRANSPARENCY_PREVIEW_BACKGROUND
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('无法压缩调色预览'))
          return
        }
        if (blob.type !== 'image/jpeg') {
          reject(new Error('调色预览压缩格式无效'))
          return
        }
        resolve(blob)
      }, 'image/jpeg', COLOR_ASSISTANT_PREVIEW_JPEG_QUALITY)
    })

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== 'string' || !result.startsWith('data:image/jpeg;base64,')) {
          reject(new Error('调色预览数据格式无效'))
          return
        }
        resolve(result)
      }
      reader.onerror = () => reject(reader.error ?? new Error('读取压缩预览失败'))
      reader.onabort = () => reject(new Error('读取压缩预览已取消'))
      reader.readAsDataURL(jpegBlob)
    })

    return { previewImageDataUrl: dataUrl, analysis }
  } finally {
    image.onload = null
    image.onerror = null
  }
}
