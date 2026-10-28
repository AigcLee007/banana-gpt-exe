import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ImageModelPicker, { ImageModelPickerContent } from './ImageModelPicker'

function renderPanel(model = 'gemini-3-pro-image-preview', expanded = false, imageSize: '1K' | '2K' | '4K' = '2K') {
  return renderToStaticMarkup(<ImageModelPickerContent
    value={model} familyId="nano-banana-pro" preferredModel={model} imageSize={imageSize}
    expanded={expanded} onFamilyChange={vi.fn()} onExpandedChange={vi.fn()} onChange={vi.fn()}
  />)
}

describe('image model picker', () => {
  it('renders one accessible compact trigger with the model, line and price in its title', () => {
    const html = renderToStaticMarkup(<ImageModelPicker value="nano-banana-pro-official-t3" imageSize="2K" onChange={vi.fn()} />)
    expect(html).toContain('Nano Banana Pro · 官方 T3')
    expect(html).toContain('7.5 💎')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-current-line="官方 T3"')
    expect(html).not.toContain('role="dialog"')
  })

  it('renders each model once and only the browsed family routes with right-aligned prices', () => {
    const html = renderPanel()
    expect(html.match(/data-family-id=/g)).toHaveLength(7)
    expect(html.match(/data-line-model=/g)).toHaveLength(2)
    expect(html).toContain('优惠线路')
    expect(html).toContain('官方 T3')
    expect(html).toContain('5.0 💎')
    expect(html).toContain('7.5 💎')
    expect(html).toContain('1K / 2K / 4K')
    expect(html).toContain('更多线路')
    expect(html).not.toContain('data-line-model="gpt-image-2"')
    expect(html).not.toContain('data-line-model="nano-banana-pro"')
  })

  it('reveals backups on demand and preserves the current backup selection', () => {
    expect(renderPanel('gemini-3-pro-image-preview', true)).toContain('data-line-model="nano-banana-pro"')
    const html = renderPanel('nano-banana-pro')
    expect(html).toContain('data-line-model="nano-banana-pro"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('备用线路')
  })

  it('updates size-dependent prices without adding unsupported claims', () => {
    expect(renderPanel('gemini-3-pro-image-preview', false, '1K')).toContain('6.2 💎')
    expect(renderPanel('gemini-3-pro-image-preview', false, '4K')).toContain('8.7 💎')
    expect(renderPanel()).not.toMatch(/更稳定|最快|最高画质/)
  })

  it('only marks a previously selected line as last used, not a default preview', () => {
    const props = {
      value: 'gpt-image-2', familyId: 'nano-banana-pro', preferredModel: 'gemini-3-pro-image-preview',
      imageSize: '2K' as const, expanded: false, onFamilyChange: vi.fn(), onExpandedChange: vi.fn(), onChange: vi.fn(),
    }
    expect(renderToStaticMarkup(<ImageModelPickerContent {...props} />)).not.toContain('上次使用')
    expect(renderToStaticMarkup(<ImageModelPickerContent {...props} rememberedModel="gemini-3-pro-image-preview" />)).toContain('上次使用')
  })
})
