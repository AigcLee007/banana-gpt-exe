import { BANANA_GALLERY_MODELS, normalizeBananaModelId, type BananaGalleryModel } from './bananaModels'

export interface ImageModelLine {
  model: string
  label: string
  shortLabel: string
  isBackup: boolean
  capabilities: readonly string[]
}

export interface ImageModelFamily {
  id: string
  label: string
  lines: ImageModelLine[]
}

export type ImageModelLineMemory = Record<string, string>

export const IMAGE_MODEL_FAMILIES = BANANA_GALLERY_MODELS.reduce<ImageModelFamily[]>((families, entry: BananaGalleryModel) => {
  const id = entry.familyId ?? entry.model
  let family = families.find(item => item.id === id)
  if (!family) {
    family = { id, label: entry.familyLabel ?? entry.displayName, lines: [] }
    families.push(family)
  }
  family.lines.push({
    model: entry.model, label: entry.lineLabel ?? '标准线路',
    shortLabel: entry.lineShortLabel ?? '标准', isBackup: entry.isBackupLine ?? false,
    capabilities: entry.capabilities ?? [],
  })
  return families
}, [])

export function getImageModelFamily(model: string) {
  const id = normalizeBananaModelId(model)
  return IMAGE_MODEL_FAMILIES.find(family => family.lines.some(line => line.model === id))
}

export function getImageModelSelectionLabel(model: string) {
  const family = getImageModelFamily(model)
  if (!family) return model
  const line = family.lines.find(item => item.model === normalizeBananaModelId(model))!
  return family.lines.length > 1 ? family.label + ' · ' + line.shortLabel : family.label
}

export function getPreferredImageModel(family: ImageModelFamily, memory: ImageModelLineMemory) {
  return family.lines.find(line => line.model === memory[family.id])?.model ?? family.lines[0].model
}

export function rememberImageModelLine(memory: ImageModelLineMemory, model: string): ImageModelLineMemory {
  const family = getImageModelFamily(model)
  return family ? { ...memory, [family.id]: normalizeBananaModelId(model) } : memory
}

export function parseImageModelLineMemory(raw: string | null): ImageModelLineMemory {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const result: ImageModelLineMemory = {}
    for (const family of IMAGE_MODEL_FAMILIES) {
      const saved = (value as Record<string, unknown>)[family.id]
      if (family.lines.some(line => line.model === saved)) result[family.id] = saved as string
    }
    return result
  } catch {
    return {}
  }
}

export function getVisibleImageModelLines(family: ImageModelFamily, expanded: boolean, preferredModel?: string) {
  return family.lines.filter(line => expanded || !line.isBackup || line.model === preferredModel)
}

export function positionImageModelPicker(
  anchor: { left: number; top: number; bottom: number }, viewportWidth: number, viewportHeight: number,
) {
  const margin = 8, gap = 8
  const width = Math.min(560, Math.max(0, viewportWidth - margin * 2))
  const above = Math.max(0, anchor.top - margin - gap)
  const below = Math.max(0, viewportHeight - anchor.bottom - margin - gap)
  const placement = below >= 400 || below >= above ? 'bottom' as const : 'top' as const
  const height = Math.min(400, placement === 'top' ? above : below)
  const left = Math.max(margin, Math.min(anchor.left, viewportWidth - width - margin))
  const top = placement === 'top' ? anchor.top - gap - height : anchor.bottom + gap
  return { left, top: Math.max(margin, Math.min(top, viewportHeight - height - margin)), width, height, placement }
}
