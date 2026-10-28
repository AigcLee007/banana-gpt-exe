import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ImageModelPicker, { ImageModelPickerContent } from './ImageModelPicker'

function renderPanel(model = 'gemini-3-pro-image-preview', imageSize: '1K' | '2K' | '4K' = '2K') {
  return renderToStaticMarkup(<ImageModelPickerContent
    value={model} familyId="nano-banana-pro" imageSize={imageSize}
    onFamilyChange={vi.fn()} onChange={vi.fn()}
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
    expect(html.match(/data-line-model=/g)).toHaveLength(3)
    expect(html).toContain('优惠线路')
    expect(html).toContain('官方 T3')
    expect(html).toContain('5.0 💎')
    expect(html).toContain('7.5 💎')
    expect(html).toContain('1K / 2K / 4K')
    expect(html).not.toContain('更多线路')
    expect(html).not.toContain('收起备用线路')
    expect(html).not.toContain('data-line-model="gpt-image-2"')
    expect(html).toContain('data-line-model="nano-banana-pro"')
  })

  it.each([
    ['nano-banana-pro', 'gemini-3-pro-image-preview', 'nano-banana-pro'],
    ['gpt-image-2', 'gpt-image-2', 'gpt-image-2-svip'],
  ])('shows the backup alongside the primary routes for %s before it is selected', (familyId, value, backup) => {
    const html = renderToStaticMarkup(<ImageModelPickerContent
      value={value} familyId={familyId} imageSize="2K" onFamilyChange={vi.fn()} onChange={vi.fn()}
    />)
    expect(html.match(/data-line-model=/g)).toHaveLength(3)
    expect(html).toContain('data-line-model="' + backup + '"')
    expect(html).toContain('备用线路')
    expect(html).not.toContain('更多线路')
    expect(html).not.toContain('收起备用线路')
  })

  it('preserves the current backup selection', () => {
    const html = renderPanel('nano-banana-pro')
    expect(html).toContain('data-line-model="nano-banana-pro"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('备用线路')
  })

  it('updates size-dependent prices without adding unsupported claims', () => {
    expect(renderPanel('gemini-3-pro-image-preview', '1K')).toContain('6.2 💎')
    expect(renderPanel('gemini-3-pro-image-preview', '4K')).toContain('8.7 💎')
    expect(renderPanel()).not.toMatch(/更稳定|最快|最高画质/)
  })

  it('only marks a previously selected line as last used, not a default preview', () => {
    const props = {
      value: 'gpt-image-2', familyId: 'nano-banana-pro',
      imageSize: '2K' as const, onFamilyChange: vi.fn(), onChange: vi.fn(),
    }
    expect(renderToStaticMarkup(<ImageModelPickerContent {...props} />)).not.toContain('上次使用')
    expect(renderToStaticMarkup(<ImageModelPickerContent {...props} rememberedModel="gemini-3-pro-image-preview" />)).toContain('上次使用')
  })
})
