import { describe, expect, it } from 'vitest'
import type { InputImage } from '../types'
import {
  getAtImageQuery,
  getSelectedImageMentionLabel,
  insertImageMentionAtVisibleRange,
  remapImageMentionsForOrder,
  replaceImageMentionsForApi,
} from './promptImageMentions'

const images: InputImage[] = [
  { id: 'image-a', dataUrl: 'data:image/png;base64,a' },
  { id: 'image-b', dataUrl: 'data:image/png;base64,b' },
]

describe('prompt image mentions', () => {
  it('detects @ query before the cursor', () => {
    expect(getAtImageQuery('参考 @图', 5, images)).toEqual({ start: 3, query: '图' })
  })

  it('ignores @ query when there are no current reference images', () => {
    expect(getAtImageQuery('参考 @图', 5, [])).toBeNull()
  })

  it('inserts a selected image mention with hidden markers', () => {
    expect(insertImageMentionAtVisibleRange('参考@生成', 2, 3, 1)).toEqual({
      prompt: `参考${getSelectedImageMentionLabel(1)}生成`,
      cursor: 5,
    })
  })

  it('keeps mentions attached to the same image after reordering', () => {
    expect(remapImageMentionsForOrder(
      `用 ${getSelectedImageMentionLabel(1)} 参考 ${getSelectedImageMentionLabel(0)}`,
      images,
      [images[1], images[0]],
    )).toBe(`用 ${getSelectedImageMentionLabel(0)} 参考 ${getSelectedImageMentionLabel(1)}`)
  })

  it('marks removed image mentions as unavailable', () => {
    expect(remapImageMentionsForOrder(`用 ${getSelectedImageMentionLabel(1)}`, images, [images[0]])).toBe('用 @已移除图片')
  })

  it('replaces selected mentions for API prompts', () => {
    expect(replaceImageMentionsForApi(`把 ${getSelectedImageMentionLabel(0)} 变蓝`)).toBe('把 [image 1] 变蓝')
  })

  it('does not replace manually typed mentions', () => {
    expect(replaceImageMentionsForApi('把 @图1 变蓝')).toBe('把 @图1 变蓝')
  })
})
