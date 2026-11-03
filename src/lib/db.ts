import type { AgentConversation, ColorAssistantHistoryOutcome, ColorAssistantHistoryRecord, ColorEditRecord, TaskRecord, StoredImage, StoredImageThumbnail } from '../types'
import type { ColorAdjustments } from './colorGrading'
import { normalizeColorEditMetadata } from './colorEditVersions'
import { decideColorAssistantHistoryRecord } from './colorAssistantHistory'
import { createLocalId } from './localId'
import { notifyNewStudioMedia } from './portalAssetEvents'
import { claimManagedLocalAsset } from './portalAssetOwnership'

const DB_NAME = 'gpt-image-playground'
const DB_VERSION = 9
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_COLOR_EDITS = 'colorEdits'
const STORE_COLOR_ASSISTANT_HISTORY = 'colorAssistantHistory'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_VIDEO_TASKS = 'videoTasks'
const STORE_MEDIA = 'media'
const STORE_MEDIA_POSTERS = 'mediaPosters'
const STORE_VIDEO_ASSETS = 'videoAssets'
const STORE_VIDEO_ASSET_CATEGORIES = 'videoAssetCategories'
const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

let dbPromise: Promise<IDBDatabase> | null = null

function ensureObjectStores(db: IDBDatabase, upgradeTransaction?: IDBTransaction | null) {
  const stores: Array<[string, IDBObjectStoreParameters]> = [
    [STORE_TASKS, { keyPath: 'id' }],
    [STORE_IMAGES, { keyPath: 'id' }],
    [STORE_THUMBNAILS, { keyPath: 'id' }],
    [STORE_AGENT_CONVERSATIONS, { keyPath: 'id' }],
    [STORE_COLOR_ASSISTANT_HISTORY, { keyPath: 'id' }],
    [STORE_VIDEO_TASKS, { keyPath: 'id' }],
    [STORE_MEDIA, { keyPath: 'id' }],
    [STORE_MEDIA_POSTERS, { keyPath: 'id' }],
    [STORE_VIDEO_ASSETS, { keyPath: 'id' }],
    [STORE_VIDEO_ASSET_CATEGORIES, { keyPath: 'id' }],
  ]
  for (const [name, options] of stores) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options)
  }
  const colorEdits = db.objectStoreNames.contains(STORE_COLOR_EDITS)
    ? upgradeTransaction?.objectStore(STORE_COLOR_EDITS)
    : db.createObjectStore(STORE_COLOR_EDITS, { keyPath: 'id' })
  if (colorEdits && !colorEdits.indexNames.contains('sourceImageId')) {
    colorEdits.createIndex('sourceImageId', 'sourceImageId', { unique: false })
  }
  const colorAssistantHistory = db.objectStoreNames.contains(STORE_COLOR_ASSISTANT_HISTORY)
    ? upgradeTransaction?.objectStore(STORE_COLOR_ASSISTANT_HISTORY)
    : db.createObjectStore(STORE_COLOR_ASSISTANT_HISTORY, { keyPath: 'id' })
  if (colorAssistantHistory && !colorAssistantHistory.indexNames.contains('sourceImageId')) {
    colorAssistantHistory.createIndex('sourceImageId', 'sourceImageId', { unique: false })
  }
}

export function openAppDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let abandoned = false
    req.onupgradeneeded = () => ensureObjectStores(req.result, req.transaction)
    req.onblocked = () => {
      abandoned = true
      dbPromise = null
      reject(new Error('数据库升级被已有连接阻塞，请刷新页面后重试'))
    }
    req.onsuccess = () => {
      const db = req.result
      if (abandoned) {
        db.close()
        return
      }
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

export function resetAppDatabaseConnection() {
  dbPromise = null
}

function openDB(): Promise<IDBDatabase> {
  return openAppDatabase()
}

export function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T>
export function dbTransaction<T>(
  storeName: string[],
  mode: IDBTransactionMode,
  fn: (stores: IDBObjectStore[]) => IDBRequest<T> | void,
): Promise<T>
export function dbTransaction<T>(
  storeName: string | string[],
  mode: IDBTransactionMode,
  fn: ((store: IDBObjectStore) => IDBRequest<T>) | ((stores: IDBObjectStore[]) => IDBRequest<T> | void),
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(storeName, mode)
          const stores = Array.isArray(storeName)
            ? storeName.map((name) => tx.objectStore(name))
            : tx.objectStore(storeName)
          const request = Array.isArray(storeName)
            ? (fn as (stores: IDBObjectStore[]) => IDBRequest<T> | void)(stores as IDBObjectStore[])
            : (fn as (store: IDBObjectStore) => IDBRequest<T>)(stores as IDBObjectStore)
          let requestResult: T
          let requestDone = !request
          if (request) {
            request.onsuccess = () => {
              requestResult = request.result
              requestDone = true
            }
            request.onerror = () => reject(request.error)
          }
          tx.oncomplete = () => {
            if (requestDone) resolve(request ? requestResult : undefined as T)
          }
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error ?? new Error('数据库事务已中止'))
        } catch (error) {
          reject(error)
        }
      }),
  )
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== Agent conversations =====

export function getAllAgentConversations(): Promise<AgentConversation[]> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.put(conversation))
}

export function deleteAgentConversation(id: string): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.delete(id))
}

export function clearAgentConversations(): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.clear())
}

export function replaceAgentConversations(conversations: AgentConversation[]): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AGENT_CONVERSATIONS, 'readwrite')
        const store = tx.objectStore(STORE_AGENT_CONVERSATIONS)
        store.clear()
        for (const conversation of conversations) store.put(conversation)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  const metadata = await safeCreateImageThumbnail(image.dataUrl)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  )
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export function getColorEditRecord(id: string): Promise<ColorEditRecord | undefined> {
  return dbTransaction(STORE_COLOR_EDITS, 'readonly', (store) => store.get(id))
}

export function getAllColorEditRecords(): Promise<ColorEditRecord[]> {
  return dbTransaction(STORE_COLOR_EDITS, 'readonly', (store) => store.getAll())
}

export function putColorEditRecord(record: ColorEditRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_COLOR_EDITS, 'readwrite', (store) => store.put(record))
}

export function getColorAssistantHistoryRecord(id: string): Promise<ColorAssistantHistoryRecord | undefined> {
  return dbTransaction(STORE_COLOR_ASSISTANT_HISTORY, 'readonly', (store) => store.get(id))
}

export function getColorAssistantHistory(sourceImageId: string): Promise<ColorAssistantHistoryRecord[]> {
  return dbTransaction(STORE_COLOR_ASSISTANT_HISTORY, 'readonly', (store) => store.index('sourceImageId').getAll(sourceImageId))
    .then((records) => records.sort((a, b) => b.createdAt - a.createdAt))
}

export function putColorAssistantHistoryRecord(record: ColorAssistantHistoryRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_COLOR_ASSISTANT_HISTORY, 'readwrite', (store) => store.put(record))
}

export async function updateColorAssistantHistoryOutcome(
  id: string,
  outcome: Exclude<ColorAssistantHistoryOutcome, 'pending'>,
  decidedAt = Date.now(),
): Promise<ColorAssistantHistoryRecord> {
  const record = await getColorAssistantHistoryRecord(id)
  if (!record) throw new Error('调色历史记录已不存在')
  const decided = decideColorAssistantHistoryRecord(record, outcome, decidedAt)
  await putColorAssistantHistoryRecord(decided)
  return decided
}

export async function getColorEditVersions(sourceImageId: string): Promise<ColorEditRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_COLOR_EDITS, 'readonly').objectStore(STORE_COLOR_EDITS).index('sourceImageId').getAll(sourceImageId)
    request.onsuccess = () => resolve((request.result as ColorEditRecord[]).sort((a, b) => b.createdAt - a.createdAt))
    request.onerror = () => reject(request.error)
  })
}

export function deleteImage(id: string): Promise<undefined> {
  return getAllColorEditRecords().then(async (edits) => {
    if (edits.some((edit) => edit.id === id || edit.sourceImageId === id || edit.parentImageId === id)) return undefined
    return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_COLOR_EDITS, STORE_COLOR_ASSISTANT_HISTORY], 'readwrite')
        tx.objectStore(STORE_IMAGES).delete(id)
        tx.objectStore(STORE_THUMBNAILS).delete(id)
        tx.objectStore(STORE_COLOR_EDITS).delete(id)
        const history = tx.objectStore(STORE_COLOR_ASSISTANT_HISTORY)
        const request = history.index('sourceImageId').openCursor(id)
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          cursor.delete()
          cursor.continue()
        }
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('数据库事务已中止'))
      }),
    )
  })
}

export function clearImages(): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_COLOR_EDITS, STORE_COLOR_ASSISTANT_HISTORY], 'readwrite')
        tx.objectStore(STORE_IMAGES).clear()
        tx.objectStore(STORE_THUMBNAILS).clear()
        tx.objectStore(STORE_COLOR_EDITS).clear()
        tx.objectStore(STORE_COLOR_ASSISTANT_HISTORY).clear()
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('数据库事务已中止'))
      }),
  )
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  const id = await hashDataUrl(dataUrl)
  claimManagedLocalAsset(`image:${id}`)
  const existing = await getImage(id)
  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  } else if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION) {
    const thumbnail = await safeCreateImageThumbnail(existing.dataUrl)
    if (thumbnail.width && thumbnail.height && (existing.width !== thumbnail.width || existing.height !== thumbnail.height)) {
      await putImage({ ...existing, width: thumbnail.width, height: thumbnail.height })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  }
  if (source !== 'mask') notifyNewStudioMedia('image', id, source === 'generated' ? '生成图片' : '上传参考图')
  return id
}

export async function storeColorEditedImage(
  dataUrl: string,
  sourceImageId: string,
  parentImageId: string,
  adjustments: ColorAdjustments,
): Promise<string> {
  if (!await getImage(sourceImageId) || !await getImage(parentImageId)) throw new Error('调色版本的来源图片已不存在')
  const id = `color-edit-${createLocalId()}`
  const createdAt = Date.now()
  const colorEdit = normalizeColorEditMetadata({ id, sourceImageId, parentImageId, adjustments, createdAt }, id)
  const thumbnail = await safeCreateImageThumbnail(dataUrl)
  claimManagedLocalAsset(`image:${id}`)
  await dbTransaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_COLOR_EDITS], 'readwrite', (stores) => {
    stores[0].put({
      id,
      dataUrl,
      createdAt,
      source: 'edited',
      width: thumbnail.width,
      height: thumbnail.height,
    } satisfies StoredImage)
    stores[2].put(colorEdit)
    if (thumbnail.thumbnailDataUrl) stores[1].put({
      id,
      thumbnailDataUrl: thumbnail.thumbnailDataUrl,
      width: thumbnail.width,
      height: thumbnail.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    } satisfies StoredImageThumbnail)
  })
  notifyNewStudioMedia('image', id, '调色版本')
  return id
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
