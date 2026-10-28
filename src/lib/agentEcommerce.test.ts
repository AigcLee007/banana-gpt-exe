import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ECOMMERCE_BRIEF,
  ECOMMERCE_RULES_CHECKED_AT,
  ECOMMERCE_SOURCES,
  buildEcommercePrompt,
  createEcommercePlan,
  normalizeEcommerceBrief,
  validateEcommerceBrief,
  type EcommerceBrief,
} from './agentEcommerce'

const confirmedBrief = (overrides: Partial<EcommerceBrief> = {}): EcommerceBrief => ({
  ...DEFAULT_ECOMMERCE_BRIEF,
  productName: '蓝色冲锋衣',
  audience: '成人日常通勤与轻徒步',
  facts: '正面实拍可见蓝色、黑色拉链和连帽；面料成分为100%聚酯纤维。没有防水等级资料。',
  factsConfirmed: true,
  ...overrides,
})

describe('ecommerce brief normalization', () => {
  it('starts without invented product facts or implicit confirmation', () => {
    expect(normalizeEcommerceBrief(undefined)).toEqual(DEFAULT_ECOMMERCE_BRIEF)
    expect(DEFAULT_ECOMMERCE_BRIEF).toMatchObject({
      platform: 'amazon-us-apparel', productName: '', facts: '', language: 'English',
      secondaryCount: 6, detailCount: 3, factsConfirmed: false,
    })
  })

  it('trims product data, bounds counts, and preserves multiline facts', () => {
    expect(normalizeEcommerceBrief({
      platform: 'custom', productName: '  外套  ', language: ' 中文 ', facts: '  蓝色\n连帽  ',
      secondaryCount: 99, detailCount: -4, factsConfirmed: true,
    })).toMatchObject({
      platform: 'custom', productName: '外套', language: '中文', facts: '蓝色\n连帽',
      secondaryCount: 8, detailCount: 1, factsConfirmed: true,
    })
    expect(normalizeEcommerceBrief({ secondaryCount: 2.9, detailCount: Number.POSITIVE_INFINITY }))
      .toMatchObject({ secondaryCount: 2, detailCount: 3 })
  })

  it('does not stringify arbitrary objects or accept truthy confirmation values', () => {
    const hostile = { toString() { throw new Error('must not be converted') } }
    expect(normalizeEcommerceBrief({ productName: hostile, facts: hostile, audience: ['adult'],
      language: false, visualNotes: 123, customRequirements: hostile, factsConfirmed: 'true',
      platform: hostile, secondaryCount: hostile, detailCount: NaN,
    })).toEqual(DEFAULT_ECOMMERCE_BRIEF)
    expect(normalizeEcommerceBrief([])).toEqual(DEFAULT_ECOMMERCE_BRIEF)
  })

  it('caps oversized stored fields and returns independent defaults', () => {
    const result = normalizeEcommerceBrief({ productName: 'x'.repeat(1000), facts: 'x'.repeat(20000) })
    expect(result.productName.length).toBeLessThanOrEqual(160)
    expect(result.facts.length).toBeLessThanOrEqual(8000)
    result.productName = 'changed'
    expect(DEFAULT_ECOMMERCE_BRIEF.productName).toBe('')
  })
})

describe('ecommerce image plan', () => {
  it('creates stable IDs and separate target and generation dimensions for each group', () => {
    const plan = createEcommercePlan(DEFAULT_ECOMMERCE_BRIEF)
    expect(plan).toHaveLength(10)
    expect(plan.map(item => item.id)).toEqual([
      'MAIN-01', 'SECONDARY-01', 'SECONDARY-02', 'SECONDARY-03', 'SECONDARY-04',
      'SECONDARY-05', 'SECONDARY-06', 'DETAIL-01', 'DETAIL-02', 'DETAIL-03',
    ])
    expect(plan[0]).toMatchObject({ group: 'main', width: 1500, height: 2000, generationSize: '1536x2048' })
    expect(plan.filter(item => item.group === 'secondary').every(item =>
      item.width === 2000 && item.height === 2000 && item.generationSize === '2048x2048')).toBe(true)
    expect(plan.filter(item => item.group === 'detail').every(item =>
      item.width === 970 && item.height === 600 && item.generationSize === '1552x960')).toBe(true)
  })

  it('normalizes persisted counts and supports the full configured range without duplicate IDs', () => {
    const plan = createEcommercePlan(confirmedBrief({ secondaryCount: 20, detailCount: 20 }))
    expect(plan.filter(item => item.group === 'secondary')).toHaveLength(8)
    expect(plan.filter(item => item.group === 'detail')).toHaveLength(5)
    expect(new Set(plan.map(item => item.id)).size).toBe(plan.length)
    expect(plan.every(item => item.title.trim() && item.description.trim())).toBe(true)
  })

  it('labels custom platform sizes as editable presets and does not mutate the brief', () => {
    const brief = confirmedBrief({ platform: 'custom', customRequirements: '独立站，使用商家提供的尺寸要求' })
    const before = structuredClone(brief)
    const plan = createEcommercePlan(brief)
    expect(plan.every(item => item.description.includes('导出预设'))).toBe(true)
    expect(plan.filter(item => item.group === 'secondary').map(item => item.title)).not.toContain('穿着与搭配')
    expect(plan.find(item => item.id === 'SECONDARY-05')?.title).toBe('规格与选购信息')
    expect(brief).toEqual(before)
  })
})

describe('ecommerce phase validation', () => {
  it('requires a named product while allowing a planning conversation with missing facts', () => {
    expect(validateEcommerceBrief(DEFAULT_ECOMMERCE_BRIEF)).toContain('请填写产品名称。')
    expect(validateEcommerceBrief(confirmedBrief({ facts: '', factsConfirmed: false }), 'plan')).toEqual([])
  })

  it.each(['sample', 'main', 'secondary', 'detail'] as const)('requires real confirmed facts for %s', phase => {
    const errors = validateEcommerceBrief(confirmedBrief({ facts: '', factsConfirmed: false }), phase)
    expect(errors).toContain('请补充已核实的产品参数与可见细节。')
    expect(errors).toContain('请先确认填写的产品资料真实准确。')
    expect(validateEcommerceBrief(confirmedBrief(), phase)).toEqual([])
  })

  it('requires custom platform requirements before generation but allows discussing them first', () => {
    const brief = confirmedBrief({ platform: 'custom', customRequirements: '' })
    expect(validateEcommerceBrief(brief, 'plan')).toEqual([])
    expect(validateEcommerceBrief(brief, 'sample')).toContain('请填写目标平台、站点、类目与具体图片要求。')
    expect(validateEcommerceBrief({ ...brief, customRequirements: '独立站商品页，白底主图' }, 'sample')).toEqual([])
  })
})

describe('ecommerce staged prompts', () => {
  it('plans in text only, lists every item and asks about uncertain product information', () => {
    const prompt = buildEcommercePrompt(confirmedBrief({ language: 'Deutsch', factsConfirmed: false }), 'plan')
    expect(prompt).toContain('仅输出文字')
    expect(prompt).toContain('不要调用任何图片生成工具')
    expect(prompt).toContain('MAIN-01')
    expect(prompt).toContain('SECONDARY-06')
    expect(prompt).toContain('DETAIL-03')
    expect(prompt).toContain('Deutsch')
    expect(prompt).toContain('尚未确认')
    expect(prompt).toContain('背面结构')
    expect(prompt).toContain('防水等级')
  })

  it('generates only one main-image sample and preserves uploaded product identity', () => {
    const prompt = buildEcommercePrompt(confirmedBrief(), 'sample')
    expect(prompt).toContain('恰好 1 张')
    expect(prompt).toContain('MAIN-01')
    expect(prompt).toContain('1536x2048')
    expect(prompt).not.toContain('SECONDARY-01')
    expect(prompt).not.toContain('DETAIL-01')
    for (const term of ['真实参考图', '颜色', 'Logo', '拉链', '版型', 'RGB 255,255,255', '站立', '正面', '单一', '无叠加文字']) {
      expect(prompt).toContain(term)
    }
    expect(prompt).toContain('AI 生成的人物')
    expect(prompt).toContain('XMP')
  })

  it.each(['main', 'secondary', 'detail'] as const)('limits %s generation to one group after explicit sample confirmation', phase => {
    const brief = confirmedBrief({ secondaryCount: 2, detailCount: 2 })
    const plan = createEcommercePlan(brief)
    const prompt = buildEcommercePrompt(brief, phase, plan)
    expect(prompt).toContain('用户明确确认的主图样稿')
    expect(prompt).toContain('尚未明确确认时，先询问并停止生图')
    expect(prompt).toContain('每张图的工具提示词')
    for (const item of plan) {
      if (item.group === phase) expect(prompt).toContain(item.id)
      else expect(prompt).not.toContain(item.id)
    }
  })

  it('keeps A+ image modules separate from listing copy and records the chosen module scope', () => {
    const prompt = buildEcommercePrompt(confirmedBrief(), 'detail')
    expect(prompt).toContain('StandardHeaderImageTextModule')
    expect(prompt).toContain('970×600')
    expect(prompt).toContain('最低尺寸')
    expect(prompt).toContain('商家后台')
    expect(prompt).toContain('Amazon 徽章')
    expect(prompt).toContain('外部联系方式')
  })

  it('produces separate editable listing copy without image tool calls or invented evidence', () => {
    const prompt = buildEcommercePrompt(confirmedBrief(), 'copy')
    expect(prompt).toContain('仅输出文字')
    expect(prompt).toContain('不要调用任何图片生成工具')
    expect(prompt).toContain('五点描述')
    expect(prompt).toContain('可编辑')
    expect(prompt).toContain('评价')
    expect(prompt).toContain('认证')
  })

  it('turns incomplete generation requests into missing-information questions only', () => {
    const prompt = buildEcommercePrompt(confirmedBrief({ factsConfirmed: false }), 'sample')
    expect(prompt).toContain('不要调用任何图片生成工具')
    expect(prompt).toContain('请先确认填写的产品资料真实准确。')
    expect(prompt).not.toContain('恰好 1 张')
  })

  it('does not apply Amazon apparel requirements to a custom platform', () => {
    const prompt = buildEcommercePrompt(confirmedBrief({ platform: 'custom', customRequirements: '独立站横向主图，不使用人物' }), 'sample')
    expect(prompt).toContain('独立站横向主图，不使用人物')
    expect(prompt).toContain('通用导出预设')
    expect(prompt).not.toContain('站立模特')
    expect(prompt).not.toContain('RGB 255,255,255')
  })

  it('asks for a plan instead of generating zero images when the supplied plan omits the requested group', () => {
    const mainOnly = createEcommercePlan(confirmedBrief()).filter(item => item.group === 'main')
    const prompt = buildEcommercePrompt(confirmedBrief(), 'detail', mainOnly)
    expect(prompt).toContain('当前规划缺少本轮分组')
    expect(prompt).toContain('不要调用任何图片生成工具')
    expect(prompt).not.toContain('共 0 张')
  })

  it('uses the current official source URLs and the reviewed date without claiming global platform coverage', () => {
    expect(ECOMMERCE_RULES_CHECKED_AT).toBe('2026-10-16')
    expect(ECOMMERCE_SOURCES.some(item => item.url === 'https://developer-docs.amazon/sp-api/docs/a-plus-content-examples')).toBe(true)
    expect(ECOMMERCE_SOURCES.every(item => item.title && item.url.startsWith('https://'))).toBe(true)
    expect(buildEcommercePrompt(confirmedBrief(), 'plan')).toContain('美国站成人服装')
  })
})
