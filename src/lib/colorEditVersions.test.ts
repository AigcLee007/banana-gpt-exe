import { describe, expect, it } from 'vitest'
import { createDefaultColorAdjustments } from './colorGrading'
import { expandColorEditLineage, normalizeColorEditMetadata, resolveColorEditSession } from './colorEditVersions'

describe('color edit versions', () => {
  it('includes source, parent, and sibling versions when preserving a saved edit', () => {
    const recipe = createDefaultColorAdjustments()
    const images = [
      { id: 'version-a', sourceImageId: 'source', parentImageId: 'source', adjustments: recipe, createdAt: 1 },
      { id: 'version-b', sourceImageId: 'source', parentImageId: 'version-a', adjustments: recipe, createdAt: 2 },
      { id: 'version-c', sourceImageId: 'source', parentImageId: 'source', adjustments: recipe, createdAt: 3 },
    ]

    const lineage = expandColorEditLineage(images, ['version-b'])

    expect([...lineage].sort()).toEqual(['source', 'version-a', 'version-b', 'version-c'])
  })

  it('validates persisted edit metadata and normalizes its adjustment recipe', () => {
    const recipe = createDefaultColorAdjustments()
    recipe.basic.exposure = 1.25

    expect(normalizeColorEditMetadata({
      id: 'edited',
      sourceImageId: 'source',
      parentImageId: 'source',
      adjustments: recipe,
      createdAt: 123,
    }, 'edited')).toMatchObject({
      id: 'edited',
      sourceImageId: 'source',
      parentImageId: 'source',
      adjustments: { basic: { exposure: 1.25 } },
      createdAt: 123,
    })
  })

  it('rejects broken lineage, unsafe recipes, and self references', () => {
    const recipe = createDefaultColorAdjustments()
    recipe.lut = { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: [0, 0, 0] }

    expect(() => normalizeColorEditMetadata({ id: 'edited', sourceImageId: 'edited', parentImageId: 'source', adjustments: createDefaultColorAdjustments(), createdAt: 1 }, 'edited')).toThrow('版本')
    expect(normalizeColorEditMetadata({ id: 'edited', sourceImageId: 'source', parentImageId: 'parent', adjustments: createDefaultColorAdjustments(), createdAt: 1 }, 'edited').parentImageId).toBe('parent')
    expect(() => normalizeColorEditMetadata({ id: 'edited', sourceImageId: 'source', parentImageId: 'source', adjustments: recipe, createdAt: 1 }, 'edited')).toThrow('LUT')
  })

  it('reopens an edited child from its root image and saved recipe without mutating the record', () => {
    const adjustments = createDefaultColorAdjustments()
    adjustments.basic.exposure = 1.5
    const record = { id: 'edited', sourceImageId: 'original', parentImageId: 'original', adjustments, createdAt: 123 }
    const original = structuredClone(record)

    expect(resolveColorEditSession('edited', record)).toEqual({
      sourceImageId: 'original',
      parentImageId: 'edited',
      adjustments,
    })
    expect(record).toEqual(original)
  })

  it('starts a new source image with identity adjustments', () => {
    const session = resolveColorEditSession('original')

    expect(session).toMatchObject({ sourceImageId: 'original', parentImageId: 'original' })
    expect(session.adjustments.basic.exposure).toBe(0)
    expect(session.adjustments.whiteBalance.neutralGains).toEqual([1, 1, 1])
  })
})
