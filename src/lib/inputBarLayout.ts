export type InputBarRect = Pick<DOMRectReadOnly, 'top'>

export function getInputBarClearance(viewportHeight: number, visibleRect: InputBarRect) {
  return Math.max(0, Math.ceil(viewportHeight - visibleRect.top))
}
