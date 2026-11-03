import { createDefaultColorAdjustments, normalizeColorAdjustments, type ColorAdjustments } from './colorGrading'
import type { ColorEditRecord } from '../types'

export type ColorEditMetadata = ColorEditRecord

export interface ColorEditSession {
  sourceImageId: string
  parentImageId: string
  adjustments: ColorAdjustments
}

export function resolveColorEditSession(selectedImageId: string, record?: ColorEditRecord): ColorEditSession {
  if (!record) {
    return {
      sourceImageId: selectedImageId,
      parentImageId: selectedImageId,
      adjustments: createDefaultColorAdjustments(),
    }
  }
  if (record.id !== selectedImageId || record.sourceImageId === selectedImageId) throw new Error('调色版本引用无效')
  return {
    sourceImageId: record.sourceImageId,
    parentImageId: selectedImageId,
    adjustments: normalizeColorAdjustments(record.adjustments),
  }
}

export function normalizeColorEditMetadata(value: unknown, imageId: string): ColorEditMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('调色版本记录无效')
  const metadata = value as Record<string, unknown>
  const id = metadata.id
  const sourceImageId = metadata.sourceImageId
  const parentImageId = metadata.parentImageId
  const createdAt = metadata.createdAt
  if (typeof id !== 'string' || id !== imageId
    || typeof sourceImageId !== 'string' || !sourceImageId || sourceImageId === imageId
    || typeof parentImageId !== 'string' || !parentImageId || parentImageId === imageId
    || typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error('调色版本引用无效')
  }
  return {
    id,
    sourceImageId,
    parentImageId,
    adjustments: normalizeColorAdjustments(metadata.adjustments),
    createdAt,
  }
}

export function expandColorEditLineage(edits: ColorEditMetadata[], imageIds: Iterable<string>): Set<string> {
  const result = new Set(imageIds)
  let changed = true
  while (changed) {
    changed = false
    for (const edit of edits) {
      if (!result.has(edit.id) && !result.has(edit.sourceImageId) && !result.has(edit.parentImageId)) continue
      for (const id of [edit.id, edit.sourceImageId, edit.parentImageId]) {
        if (!result.has(id)) {
          result.add(id)
          changed = true
        }
      }
    }
  }
  return result
}
