import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
  buildEcommerceArchive,
  getEcommerceImageTransform,
  getEcommerceArchiveFilename,
  markSyntheticPerformer,
  type EcommerceExportImage,
  type EcommerceExportRuntime,
} from './agentEcommerceExport'

const png = () => new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0)], { type: 'image/png' })
const jpeg = (width = 970, height = 600) => Uint8Array.of(
  0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255,
  3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9,
)
const image = (overrides: Partial<EcommerceExportImage> = {}): EcommerceExportImage => ({
  id: 'main-01', title: '商品主图', group: 'main', width: 1500, height: 2000,
  source: png(), fit: 'contain', syntheticPerson: false, ...overrides,
})
const runtime = (overrides: Partial<EcommerceExportRuntime> = {}): EcommerceExportRuntime => ({
  decode: async () => ({ width: 1024, height: 1024, drawable: {} as CanvasImageSource, close: vi.fn() }),
  encode: async (_decoded, transform) => jpeg(transform.width, transform.height),
  ...overrides,
})
const archive = (images = [image()], metadata: Record<string, unknown> = {}) => ({
  productName: '冲锋衣', brief: { productName: '冲锋衣', platform: 'amazon-us', language: 'English', ...metadata },
  plan: { items: [{ id: 'main-01', title: '商品主图', group: 'main', width: 1500, height: 2000 }] },
  copy: '# 冲锋衣\n\n经用户确认的商品文案。', images,
})

describe('ecommerce export image geometry', () => {
  it('uses a readable download name without paths, Windows reserved names or control characters', () => {
    expect(getEcommerceArchiveFilename('冲锋衣')).toBe('冲锋衣-电商套图.zip')
    expect(getEcommerceArchiveFilename('../CON:<test>\\wear\u0000')).not.toMatch(/[\\/:<>\u0000]/)
    expect(getEcommerceArchiveFilename('... ')).toBe('商品-电商套图.zip')
    expect(getEcommerceArchiveFilename('CON')).toBe('商品-CON-电商套图.zip')
    expect(getEcommerceArchiveFilename('a'.repeat(200)).length).toBeLessThan(100)
  })

  it('contains the entire square source on a centered white portrait canvas', () => {
    expect(getEcommerceImageTransform(1024, 1024, 1500, 2000, 'contain')).toMatchObject({
      sx: 0, sy: 0, sw: 1024, sh: 1024, dx: 0, dy: 250, dw: 1500, dh: 1500,
      width: 1500, height: 2000, cropped: false, padded: true, upscaled: true,
    })
  })

  it('uses a deliberate center crop only with cover', () => {
    expect(getEcommerceImageTransform(2000, 1000, 1000, 1000, 'cover')).toMatchObject({
      sx: 500, sy: 0, sw: 1000, sh: 1000, dx: 0, dy: 0, dw: 1000, dh: 1000,
      cropped: true, padded: false, upscaled: false,
    })
  })
  it('accepts existing Gemini 4K originals while keeping export pixel limits', () => {
    for (const [width,height] of [[4096,4096],[3392,5056],[6336,2688]]) {
      expect(getEcommerceImageTransform(width,height,2000,2000,'contain')).toMatchObject({width:2000,height:2000,upscaled:false})
    }
    expect(() => getEcommerceImageTransform(8192,8192,2000,2000,'contain')).toThrow()
  })

  it('rejects invalid dimensions, pixel limits and unrecognized fit', () => {
    for (const dimensions of [[0, 1000], [63, 1000], [4097, 1000], [4096, 4096], [1000.2, 1000], [NaN, 1000]]) {
      expect(() => getEcommerceImageTransform(1000, 1000, dimensions[0], dimensions[1], 'contain')).toThrow()
    }
    expect(() => getEcommerceImageTransform(63, 1000, 1000, 1000, 'contain')).toThrow()
    expect(() => getEcommerceImageTransform(1000, 1000, 1000, 1000, 'stretch' as never)).toThrow()
  })
})

describe('synthetic performer metadata', () => {
  it('writes an XMP APP1 dc:subject keyword while preserving every original JPEG byte', () => {
    const source = jpeg()
    const result = markSyntheticPerformer(source)
    expect([...result.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe1])
    const length = result[4] * 256 + result[5]
    const metadata = strFromU8(result.slice(6, 4 + length))
    expect(metadata).toContain('http://ns.adobe.com/xap/1.0/\0')
    expect(metadata).toContain('<dc:subject>')
    expect(metadata).toContain('<rdf:li>contains-synthetic-performer</rdf:li>')
    expect(result.slice(4 + length)).toEqual(source.slice(2))
    expect(source).toEqual(jpeg())
  })

  it('is idempotent for an already marked JPEG', () => {
    const marked = markSyntheticPerformer(jpeg())
    expect(markSyntheticPerformer(marked)).toEqual(marked)
  })

  it('rejects missing or malformed JPEG boundaries', () => {
    expect(() => markSyntheticPerformer(Uint8Array.of(1, 2, 3))).toThrow()
    expect(() => markSyntheticPerformer(Uint8Array.of(0xff, 0xd8, 1, 2))).toThrow()
  })
})

describe('ecommerce archive', () => {
  it('contains original bytes, exact JPEG outputs, editable documents and a factual check report', async () => {
    const { bytes, report } = await buildEcommerceArchive(archive([image(), image({
      id: 'detail-01', group: 'detail', width: 970, height: 600, syntheticPerson: true,
    })]), runtime())
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual([
      'README.md', 'brief.json', 'checks.json', 'images/detail-01.jpg', 'images/main-01.jpg',
      'listing-copy.md', 'originals/detail-01.png', 'originals/main-01.png', 'plan.json',
    ])
    expect(files['originals/main-01.png']).toEqual(new Uint8Array(await png().arrayBuffer()))
    expect(strFromU8(files['images/detail-01.jpg'])).toContain('contains-synthetic-performer')
    expect(strFromU8(files['images/main-01.jpg'])).not.toContain('contains-synthetic-performer')
    expect(strFromU8(files['listing-copy.md'])).toContain('经用户确认的商品文案')
    expect(JSON.parse(strFromU8(files['checks.json']))).toEqual(report)
    expect(report).toMatchObject({
      version: 1, automatedComplianceApproval: false,
      images: [
        { id: 'main-01', source: { width: 1024, height: 1024 }, output: { width: 1500, height: 2000 }, padded: true, upscaled: true, cropped: false, syntheticPerformerMetadata: false },
        { id: 'detail-01', output: { width: 970, height: 600 }, syntheticPerformerMetadata: true },
      ],
    })
    expect(strFromU8(files['README.md'])).toContain('https://sellercentral.amazon.com/')
  })

  it('whitelists brief and plan data instead of serializing credentials, account IDs or unrelated URLs', async () => {
    const input = archive([image()], { apiKey: 'PRIVATE', accountId: 'PRIVATE', imageUrl: 'https://PRIVATE', facts: '尼龙面料' })
    input.plan.items[0] = { ...input.plan.items[0], apiKey: 'PRIVATE', sourceUrl: 'https://PRIVATE' } as never
    const { bytes } = await buildEcommerceArchive(input, runtime())
    const files = unzipSync(bytes)
    const metadata = strFromU8(files['brief.json']) + strFromU8(files['plan.json'])
    expect(metadata).not.toContain('PRIVATE')
    expect(metadata).toContain('尼龙面料')
    expect(metadata).toContain('main-01')
  })

  it('rejects unsafe and duplicate names before decoding anything', async () => {
    const decode = vi.fn()
    for (const id of ['../escape', 'bad/name', '', '名字', 'a.b', 'a'.repeat(81)]) {
      await expect(buildEcommerceArchive(archive([image({ id })]), runtime({ decode }))).rejects.toThrow()
    }
    await expect(buildEcommerceArchive(archive([image(), image()]), runtime({ decode }))).rejects.toThrow()
    expect(decode).not.toHaveBeenCalled()
  })

  it('enforces count, dimensions, group, fit and source byte budgets before decoding', async () => {
    const decode = vi.fn()
    const invalid = [
      [], Array.from({ length: 21 }, (_, index) => image({ id: `image-${index}` })),
      [image({ width: 4097 })], [image({ width: 4096, height: 4096 })],
      [image({ group: 'other' as never })], [image({ fit: 'stretch' as never })],
    ]
    for (const images of invalid) {
      await expect(buildEcommerceArchive(archive(images), runtime({ decode }))).rejects.toThrow()
    }
    const huge = png()
    Object.defineProperty(huge, 'size', { value: 160 * 1024 * 1024 + 1 })
    await expect(buildEcommerceArchive(archive([image({ source: huge })]), runtime({ decode }))).rejects.toThrow()
    expect(decode).not.toHaveBeenCalled()
  })

  it('requires both an allowed MIME and its actual signature', async () => {
    const decode = vi.fn()
    const bad = [new Blob(['<svg/>'], { type: 'image/svg+xml' }), new Blob(['<svg/>'], { type: 'image/png' }), new Blob([jpeg()], { type: 'image/png' })]
    for (const source of bad) {
      await expect(buildEcommerceArchive(archive([image({ source })]), runtime({ decode }))).rejects.toThrow()
    }
    expect(decode).not.toHaveBeenCalled()
  })

  it('closes decoded resources on encode failures and rejects corrupt decoded dimensions', async () => {
    const close = vi.fn()
    const decoded = { width: 1024, height: 1024, drawable: {} as CanvasImageSource, close }
    await expect(buildEcommerceArchive(archive(), runtime({ decode: async () => decoded, encode: async () => { throw new Error('encode failed') } }))).rejects.toThrow('encode failed')
    expect(close).toHaveBeenCalledTimes(1)
    close.mockClear()
    await expect(buildEcommerceArchive(archive(), runtime({ decode: async () => ({ ...decoded, width: 0 }) }))).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('fails on a decoder error instead of packing the original as a successful rendition', async () => {
    await expect(buildEcommerceArchive(archive(), runtime({ decode: async () => { throw new Error('corrupt image') } }))).rejects.toThrow('corrupt image')
  })

  it('checks actual JPEG dimensions instead of trusting requested dimensions', async () => {
    await expect(buildEcommerceArchive(archive(), runtime({ encode: async () => jpeg(100, 100) }))).rejects.toThrow(/尺寸/)
  })

  it('reduces detail JPEG quality within a bounded list and includes metadata in the 2MB budget', async () => {
    const qualities: number[] = []
    const { report } = await buildEcommerceArchive(archive([image({ id: 'detail', group: 'detail', width: 970, height: 600, syntheticPerson: true })]), runtime({
      encode: async (_decoded, transform, quality) => {
        qualities.push(quality)
        if (quality > 0.8) {
          const bytes = new Uint8Array(2_000_000)
          bytes.set(jpeg(transform.width, transform.height).slice(0, -2))
          bytes.set([0xff, 0xd9], bytes.length - 2)
          return bytes
        }
        return jpeg(transform.width, transform.height)
      },
    }))
    expect(qualities.length).toBeGreaterThan(1)
    expect(qualities.length).toBeLessThanOrEqual(8)
    expect(report).toMatchObject({ images: [{ output: { bytes: expect.any(Number), quality: expect.any(Number) } }] })
  })

  it('fails after bounded detail optimization when the JPEG remains too large', async () => {
    const encode = vi.fn(async (_decoded, transform) => {
      const bytes = new Uint8Array(2_000_001)
      bytes.set(jpeg(transform.width, transform.height).slice(0, -2))
      bytes.set([0xff, 0xd9], bytes.length - 2)
      return bytes
    })
    await expect(buildEcommerceArchive(archive([image({ group: 'detail' })]), runtime({ encode }))).rejects.toThrow(/2MB/)
    expect(encode.mock.calls.length).toBeLessThanOrEqual(8)
  })
})
