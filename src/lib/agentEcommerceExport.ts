import { strFromU8, strToU8, zipSync } from 'fflate'

export interface EcommerceExportImage {
  id: string
  title: string
  group: 'main' | 'secondary' | 'detail'
  width: number
  height: number
  source: Blob
  fit: 'contain' | 'cover'
  syntheticPerson: boolean
}

export interface EcommerceImageTransform {
  sx: number; sy: number; sw: number; sh: number
  dx: number; dy: number; dw: number; dh: number
  width: number; height: number; scale: number
  cropped: boolean; padded: boolean; upscaled: boolean
}

export interface EcommerceDecodedImage {
  width: number
  height: number
  drawable: CanvasImageSource
  close(): void
}

export interface EcommerceExportRuntime {
  decode(source: Blob): Promise<EcommerceDecodedImage>
  encode(decoded: EcommerceDecodedImage, transform: EcommerceImageTransform, quality: number): Promise<Uint8Array>
}

const MAX_PIXELS = 16_000_000
const MAX_BYTES = 160 * 1024 * 1024
const DETAIL_MAX_BYTES = 2_000_000
const JPEG_QUALITIES = [0.94, 0.88, 0.8, 0.72, 0.64, 0.56, 0.48]
const XMP_PREFIX = 'http://ns.adobe.com/xap/1.0/\0'
const SYNTHETIC_KEYWORD = 'contains-synthetic-performer'

export function getEcommerceArchiveFilename(productName: string): string {
  let name = Array.from(productName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '')).slice(0, 60).join('')
  if (!name) name = '商品'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `商品-${name}`
  return `${name}-电商套图.zip`
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > MAX_PIXELS) {
    throw new Error('图片尺寸须为64–4096像素，且总像素不超过1600万')
  }
}

/** drawImage geometry. A contain rendition preserves the whole source on white. */
export function getEcommerceImageTransform(sourceWidth: number, sourceHeight: number, width: number, height: number, fit: 'contain' | 'cover' = 'contain'): EcommerceImageTransform {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 64 || sourceHeight < 64 || sourceWidth > 8192 || sourceHeight > 8192 || sourceWidth * sourceHeight > 32_000_000) {
    throw new Error('原图须为64–8192像素，且总像素不超过3200万')
  }
  validateDimensions(width, height)
  if (fit !== 'contain' && fit !== 'cover') throw new Error('请选择等比留边或中心裁切')
  const scale = fit === 'contain'
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight)
  if (fit === 'cover') {
    const sw = width / scale
    const sh = height / scale
    return {
      sx: (sourceWidth - sw) / 2, sy: (sourceHeight - sh) / 2, sw, sh,
      dx: 0, dy: 0, dw: width, dh: height, width, height, scale,
      cropped: sw < sourceWidth - 1e-6 || sh < sourceHeight - 1e-6,
      padded: false, upscaled: scale > 1 + 1e-6,
    }
  }
  const dw = sourceWidth * scale
  const dh = sourceHeight * scale
  return {
    sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight,
    dx: (width - dw) / 2, dy: (height - dh) / 2, dw, dh, width, height, scale,
    cropped: false, padded: dw < width - 1e-6 || dh < height - 1e-6, upscaled: scale > 1 + 1e-6,
  }
}

function assertJpegBoundary(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('JPEG文件损坏或格式不正确')
  }
}
function jpegHeaderSegments(bytes: Uint8Array): { marker: number; start: number; end: number; payload: Uint8Array }[] {
  assertJpegBoundary(bytes)
  const segments: { marker: number; start: number; end: number; payload: Uint8Array }[] = []
  let offset = 2
  while (offset < bytes.length - 2) {
    const start = offset
    if (bytes[offset] !== 0xff) throw new Error('JPEG文件头损坏')
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0 || marker === 0xd8 || marker === undefined) throw new Error('JPEG文件头损坏')
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) throw new Error('JPEG文件头不完整')
    const length = bytes[offset] * 256 + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG文件头不完整')
    segments.push({ marker, start, end: offset + length, payload: bytes.subarray(offset + 2, offset + length) })
    offset += length
    // Frame dimensions and all preceding metadata are available before compressed scan data.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) break
  }
  return segments
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const segment = jpegHeaderSegments(bytes).find(({ marker }) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
  if (!segment || segment.payload.length < 6) throw new Error('JPEG缺少有效尺寸')
  const height = segment.payload[1] * 256 + segment.payload[2]
  const width = segment.payload[3] * 256 + segment.payload[4]
  validateDimensions(width, height)
  return { width, height }
}

/** Adds the Amazon synthetic performer keyword to a Canvas JPEG. Does not alter pixels. */
export function markSyntheticPerformer(jpegBytes: Uint8Array): Uint8Array {
  jpegDimensions(jpegBytes)
  const segments = jpegHeaderSegments(jpegBytes)
  if (segments.some(({ marker, payload }) => marker === 0xe1 && strFromU8(payload).startsWith(XMP_PREFIX) && strFromU8(payload).includes(`<rdf:li>${SYNTHETIC_KEYWORD}</rdf:li>`))) {
    return jpegBytes.slice()
  }
  const xml = `${XMP_PREFIX}<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>${SYNTHETIC_KEYWORD}</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`
  const payload = strToU8(xml)
  const segmentLength = payload.length + 2
  const result = new Uint8Array(jpegBytes.length + payload.length + 4)
  result.set(jpegBytes.subarray(0, 2))
  result.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 255], 2)
  result.set(payload, 6)
  result.set(jpegBytes.subarray(2), 6 + payload.length)
  return result
}

function mimeExtension(bytes: Uint8Array, mime: string): 'png' | 'jpg' | 'webp' {
  if (mime === 'image/png' && bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png'
  if (mime === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (mime === 'image/webp' && bytes.length >= 12 && strFromU8(bytes.subarray(0, 4)) === 'RIFF' && strFromU8(bytes.subarray(8, 12)) === 'WEBP') return 'webp'
  throw new Error('仅支持内容有效的PNG、JPEG或WEBP图片')
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanText(value: unknown, limit = 10_000): string | undefined {
  return typeof value === 'string' ? value.slice(0, limit) : undefined
}

function sanitizeBrief(value: unknown): Record<string, unknown> {
  const record = plainObject(value)
  const result: Record<string, unknown> = {}
  for (const key of ['platform', 'productName', 'language', 'audience', 'facts', 'visualNotes', 'customRequirements']) {
    const text = cleanText(record[key])
    if (text !== undefined) result[key] = text
  }
  for (const key of ['secondaryCount', 'detailCount']) {
    const count = record[key]
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 20) result[key] = count
  }
  if (typeof record.factsConfirmed === 'boolean') result.factsConfirmed = record.factsConfirmed
  return result
}

function sanitizePlan(value: unknown): unknown {
  const originalIsArray = Array.isArray(value)
  const rawItems = originalIsArray ? value : plainObject(value).items
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 20).map((item) => {
    const record = plainObject(item)
    const clean: Record<string, unknown> = {}
    for (const key of ['id', 'group', 'title', 'description', 'generationSize']) {
      const text = cleanText(record[key], key === 'description' ? 10_000 : 300)
      if (text !== undefined) clean[key] = text
    }
    for (const key of ['width', 'height']) {
      if (typeof record[key] === 'number' && Number.isInteger(record[key]) && record[key] >= 64 && record[key] <= 4096) clean[key] = record[key]
    }
    return clean
  })
  return originalIsArray ? items : { items }
}

const browserRuntime: EcommerceExportRuntime = {
  async decode(source) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(source)
      return { width: bitmap.width, height: bitmap.height, drawable: bitmap, close: () => bitmap.close() }
    }
    const url = URL.createObjectURL(source)
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('图片解码失败，请重新选择完整图片'))
        image.src = url
      })
      return { width: image.naturalWidth, height: image.naturalHeight, drawable: image, close: () => { image.src = ''; URL.revokeObjectURL(url) } }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  },
  async encode(decoded, transform, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = transform.width
    canvas.height = transform.height
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器不支持图片导出')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(decoded.drawable, transform.sx, transform.sy, transform.sw, transform.sh, transform.dx, transform.dy, transform.dw, transform.dh)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value?.type === 'image/jpeg' ? resolve(value) : reject(new Error('JPEG图片导出失败')), 'image/jpeg', quality)
      })
      return new Uint8Array(await blob.arrayBuffer())
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  },
}

export interface EcommerceExportImageCheck {
  id: string
  title: string
  group: EcommerceExportImage['group']
  source: { width: number; height: number; bytes: number; mime: string }
  output: { width: number; height: number; bytes: number; mime: 'image/jpeg'; quality: number }
  fit: 'contain' | 'cover'
  padded: boolean
  cropped: boolean
  upscaled: boolean
  resized: boolean
  syntheticPerformerMetadata: boolean
}

export interface EcommerceExportReport {
  version: 1
  productName: string
  createdAt: string
  automatedComplianceApproval: false
  images: EcommerceExportImageCheck[]
  manualReviewRequired: string[]
}

const readme = `# 电商套图交付包

images/ 是导出的精确像素JPEG；originals/ 保留所选原文件，不修改原图。
默认白底等比留边；明确选择中心裁切时会裁去边缘。放大和留边只满足文件尺寸，不会补回真实细节。
主图1500×2000、副图2000×2000为本工作台预设，不代表平台唯一或强制尺寸。
详情图970×600对应所选标准A+模块的最低尺寸，最终请按卖家后台实际槽位核对。
详情JPEG控制在2MB以下。标记为含拟真AI人物的成品写入XMP dc:subject关键词 contains-synthetic-performer。
该人物标记为用户逐图选择，系统不会自行判定图片是否包含AI人物；原图副本保持不变。

listing-copy.md 可继续编辑；brief.json、plan.json 是本次需求与规划；checks.json 只记录尺寸、文件大小和处理结果。
请逐图核对商品颜色、结构、Logo、材质/性能参数、文案真实性、模特姿态、白底和图片用途。
文件检测不等于商品真实性核验，也不代表亚马逊或其他平台已经审核通过。

规则核对日期：2026-10-16。上线前请再次核对对应平台、站点、类目与模块的最新规则。

官方来源：
- 商品图片要求：https://sellercentral.amazon.com/help/hub/reference/external/G1881?locale=en_us
- 商品图片与AI内容：https://sellercentral.amazon.com/help/hub/reference/external/G200498950?language=en_US
- A+内容介绍与使用条件：https://sell.amazon.com/tools/a-content
`

/** Pure local export: accepts explicit blobs only, has no store, account or network access. */
export async function buildEcommerceArchive(input: { productName: string; brief: unknown; plan: unknown; copy: string; images: EcommerceExportImage[] }, runtime: EcommerceExportRuntime = browserRuntime): Promise<{ bytes: Uint8Array; report: EcommerceExportReport }> {
  if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 20) throw new Error('请选择1–20张交付图片')
  if (typeof input.productName !== 'string' || typeof input.copy !== 'string' || input.copy.length > 200_000) throw new Error('商品名称或文案格式不正确')
  const names = new Set<string>()
  let totalSourceBytes = 0
  for (const image of input.images) {
    if (!image || typeof image.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(image.id) || names.has(image.id.toLowerCase())) throw new Error('图片编号须为不重复的英文字母、数字、下划线或短横线')
    names.add(image.id.toLowerCase())
    validateDimensions(image.width, image.height)
    if (!['main', 'secondary', 'detail'].includes(image.group)) throw new Error('图片分组不正确')
    if (image.fit !== undefined && image.fit !== 'contain' && image.fit !== 'cover') throw new Error('请选择等比留边或中心裁切')
    if (!(image.source instanceof Blob) || image.source.size < 1 || !['image/jpeg', 'image/png', 'image/webp'].includes(image.source.type)) throw new Error('仅支持PNG、JPEG或WEBP原图')
    if (typeof image.syntheticPerson !== 'boolean' || typeof image.title !== 'string') throw new Error('请确认图片标题和AI人物标记')
    totalSourceBytes += image.source.size
  }
  if (totalSourceBytes > MAX_BYTES) throw new Error('所选原图合计超过160MiB，请分批导出')
  const files: Record<string, Uint8Array> = {}
  const checks: EcommerceExportImageCheck[] = []
  let totalBytes = totalSourceBytes
  for (const image of input.images) {
    const original = new Uint8Array(await image.source.arrayBuffer())
    const extension = mimeExtension(original, image.source.type)
    const decoded = await runtime.decode(image.source)
    try {
      const fit = image.fit ?? 'contain'
      const transform = getEcommerceImageTransform(decoded.width, decoded.height, image.width, image.height, fit)
      let output: Uint8Array | undefined
      let quality = JPEG_QUALITIES[0]
      for (const candidateQuality of image.group === 'detail' ? JPEG_QUALITIES : JPEG_QUALITIES.slice(0, 1)) {
        const encoded = await runtime.encode(decoded, transform, candidateQuality)
        const dimensions = jpegDimensions(encoded)
        if (dimensions.width !== image.width || dimensions.height !== image.height) throw new Error('JPEG成品尺寸与规划尺寸不一致')
        const marked = image.syntheticPerson ? markSyntheticPerformer(encoded) : encoded
        if (image.group === 'detail' && marked.byteLength >= DETAIL_MAX_BYTES) continue
        output = marked
        quality = candidateQuality
        break
      }
      if (!output) throw new Error('详情图片压缩后仍超过2MB，请换用更简洁的图片或分组导出')
      totalBytes += output.byteLength
      if (totalBytes > MAX_BYTES) throw new Error('原图及成品合计超过160MiB，请分批导出')
      files[`originals/${image.id}.${extension}`] = original
      files[`images/${image.id}.jpg`] = output
      checks.push({
        id: image.id, title: image.title.slice(0, 300), group: image.group,
        source: { width: decoded.width, height: decoded.height, bytes: original.byteLength, mime: image.source.type },
        output: { width: image.width, height: image.height, bytes: output.byteLength, mime: 'image/jpeg', quality },
        fit, padded: transform.padded, cropped: transform.cropped, upscaled: transform.upscaled,
        resized: decoded.width !== image.width || decoded.height !== image.height,
        syntheticPerformerMetadata: image.syntheticPerson,
      })
    } finally {
      decoded.close()
    }
  }
  const report: EcommerceExportReport = {
    version: 1, productName: input.productName.slice(0, 300), createdAt: new Date().toISOString(), automatedComplianceApproval: false,
    images: checks,
    manualReviewRequired: ['商品外观与真实参数', '平台、站点、类目及模块要求', '主图背景、模特姿态、文案和水印', '拟真AI人物逐图标记', '图片中的文字及所有配套文案'],
  }
  files['brief.json'] = strToU8(JSON.stringify(sanitizeBrief(input.brief), null, 2))
  files['plan.json'] = strToU8(JSON.stringify(sanitizePlan(input.plan), null, 2))
  files['checks.json'] = strToU8(JSON.stringify(report, null, 2))
  files['listing-copy.md'] = strToU8(input.copy)
  files['README.md'] = strToU8(readme)
  const uncompressedSize = Object.values(files).reduce((total, file) => total + file.byteLength, 0)
  if (uncompressedSize > MAX_BYTES) throw new Error('交付包合计超过160MiB，请分批导出')
  return { bytes: zipSync(files, { level: 6 }), report }
}
