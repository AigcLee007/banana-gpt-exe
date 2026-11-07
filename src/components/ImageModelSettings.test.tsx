// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createDefaultOpenAIProfile } from '../lib/apiProfiles'
import ImageModelSettings from './ImageModelSettings'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('image model settings', () => {
  const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-sunburst' })
  it('uses and commits the default SVG model when the field is cleared', () => {
    const onCommit = vi.fn()
    act(() => root.render(<ImageModelSettings profile={profile} onChange={vi.fn()} onCommit={onCommit} />))
    const input = container.querySelector<HTMLInputElement>('[aria-label="SVG 模型 ID"]')!
    expect(input.value).toBe('gpt-6.1-sol')
    act(() => { input.value = ''; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(onCommit).toHaveBeenCalledWith({ svgModel: 'gpt-6.1-sol' })
  })

  it('preserves the configured SVG model', () => {
    act(() => root.render(<ImageModelSettings profile={{ ...profile, svgModel: 'custom-svg-model' }} onChange={vi.fn()} onCommit={vi.fn()} />))
    expect(container.querySelector<HTMLInputElement>('[aria-label="SVG 模型 ID"]')?.value).toBe('custom-svg-model')
  })

  it('explains why SVG model configuration is disabled on fal.ai', () => {
    act(() => root.render(<ImageModelSettings profile={{ ...profile, provider: 'fal' }} onChange={vi.fn()} onCommit={vi.fn()} />))
    expect(container.querySelector<HTMLInputElement>('[aria-label="SVG 模型 ID"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('fal.ai 不支持 SVG')
  })

  it('exposes an optional image tool model for Responses while preserving its text model', () => {
    const onCommit = vi.fn()
    act(() => root.render(<ImageModelSettings profile={{ ...profile, apiMode: 'responses', model: 'gpt-6.1-sol' }} onChange={vi.fn()} onCommit={onCommit} />))
    const input = container.querySelector<HTMLInputElement>('[aria-label="图像模型 ID"]')!
    expect(input.placeholder).toBe('gpt-image-2.6-sunburst-1k')
    act(() => { input.value = ' gpt-image-2.6-flare '; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(onCommit).toHaveBeenCalledWith({ imageGenerationModel: 'gpt-image-2.6-flare' })
  })
})
