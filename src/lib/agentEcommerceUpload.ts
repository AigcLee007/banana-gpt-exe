import { dbTransaction, getImage, hashDataUrl } from './db'
import { claimManagedLocalAsset } from './portalAssetOwnership'
import { notifyNewStudioMedia } from './portalAssetEvents'
import type { InputImage, StoredImage } from '../types'

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('图片读取失败'))
    reader.onerror = () => reject(reader.error ?? Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function imageDimensions(file: File, dataUrl: string, assertContext: () => void): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    try {
      assertContext()
      return { width: bitmap.width, height: bitmap.height }
    } finally { bitmap.close() }
  }
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(Error('图片解码失败，请选择完整的PNG、JPEG或WEBP图片'))
      image.src = dataUrl
    })
    assertContext()
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally { image.src = '' }
}

/** Reads and decodes before persistence, and binds every side effect to the captured context. */
export async function uploadEcommerceReference(file: File, owner: number, assertContext: () => void): Promise<InputImage> {
  const guard = () => {
    assertContext()
    if (!Number.isSafeInteger(owner) || owner <= 0 || (window.__AAP__ as { userId?: number } | undefined)?.userId !== owner) {
      throw Error('账户已变化，请重新打开电商套图。')
    }
  }
  guard()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
    throw Error('请使用20MiB以内的PNG、JPEG或WEBP图片。')
  }
  const dataUrl = await readImage(file)
  guard()
  const id = await hashDataUrl(dataUrl)
  guard()
  const dimensions = await imageDimensions(file, dataUrl, guard)
  guard()
  if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 64_000_000) {
    throw Error('参考图尺寸无效或超过6400万像素，请缩小后重试。')
  }
  const existing = await getImage(id)
  guard()
  const record: StoredImage = existing ?? { id, dataUrl, source: 'upload', createdAt: Date.now(), ...dimensions }
  await dbTransaction('images', 'readwrite', store => {
    guard()
    // Both the owner check and synchronous claim run before issuing any write.
    claimManagedLocalAsset(`image:${id}`)
    try {
      const owners: unknown = JSON.parse(localStorage.getItem(`aap:studio-local-owner:image:${id}`) ?? 'null')
      if (!Array.isArray(owners) || !owners.includes(owner) || owners.some(value => !Number.isSafeInteger(value) || value <= 0)) {
        throw Error('missing owner')
      }
    } catch {
      throw Error('素材归属保存失败，请检查浏览器本机存储后重试。')
    }
    return store.put(record)
  })
  guard()
  notifyNewStudioMedia('image', id, '上传参考图', 'agent')
  return { id, dataUrl }
}
