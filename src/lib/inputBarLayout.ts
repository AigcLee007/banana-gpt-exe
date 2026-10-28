export type InputBarRect = Pick<DOMRectReadOnly, 'top'> & Partial<Pick<DOMRectReadOnly, 'bottom'>>
export const INPUT_BAR_LAYOUT_EVENT = 'app:input-composer-layout'

export function getInputBarClearance(viewportHeight: number, layoutRect: InputBarRect, collapsedHeight?: number) {
  const top = collapsedHeight != null && layoutRect.bottom != null
    ? layoutRect.bottom - collapsedHeight
    : layoutRect.top
  return Math.max(0, Math.ceil(viewportHeight - top))
}
