// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile } from '../lib/apiProfiles'
import ImageOutputOptions from './ImageOutputOptions'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('advanced output controls', () => {
  const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-sunburst-1k' })
  it('emits format and complexity changes', () => {
    const onChange = vi.fn()
    act(() => root.render(<ImageOutputOptions profile={profile} params={DEFAULT_PARAMS} onChange={onChange} />))
    const format = container.querySelector<HTMLSelectElement>('[aria-label="输出格式"]')!
    act(() => { format.value = 'gif'; format.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onChange).toHaveBeenLastCalledWith({ output_format: 'gif', output_compression: null })
    const complexity = container.querySelector<HTMLSelectElement>('[aria-label="复杂度"]')!
    act(() => { complexity.value = 'high'; complexity.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onChange).toHaveBeenLastCalledWith({ complexity: 'high' })
  })

  it.each(['gpt-image-2.5-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'])('hides format and complexity on %s', model => {
    act(() => root.render(<ImageOutputOptions profile={{ ...profile, model }} params={DEFAULT_PARAMS} onChange={vi.fn()} />))
    expect(container.innerHTML).toBe('')
  })

  it('hides output options on other fal.ai lines', () => {
    act(() => root.render(<ImageOutputOptions profile={{ ...profile, provider: 'fal', model: 'openai/gpt-image-2.6-flare' }} params={DEFAULT_PARAMS} onChange={vi.fn()} />))
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['GIF 帧数', '1', { frame_count: 2 }],
    ['GIF 帧数', '99', { frame_count: 16 }],
    ['GIF 每帧时长（毫秒）', '10', { frame_duration_ms: 20 }],
    ['GIF 每帧时长（毫秒）', '3000', { frame_duration_ms: 2000 }],
    ['GIF 每帧时长（毫秒）', '', { frame_duration_ms: 200 }],
  ])('clamps %s draft %s on blur', (label, value, patch) => {
    const onChange = vi.fn()
    act(() => root.render(<ImageOutputOptions profile={profile} params={{ ...DEFAULT_PARAMS, output_format: 'gif' }} onChange={onChange} />))
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    act(() => {
      input.value = value as string
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(patch)
  })
})
