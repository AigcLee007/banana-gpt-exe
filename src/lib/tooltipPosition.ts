export function positionTooltip(
  anchor: { left: number; top: number; bottom: number; width: number },
  tooltip: { width: number; height: number },
  viewportWidth: number,
  reservedTop = 0,
) {
  const margin = 8, gap = 8
  const center = anchor.left + anchor.width / 2
  const left = Math.min(Math.max(center - tooltip.width / 2, margin), Math.max(margin, viewportWidth - tooltip.width - margin))
  const above = anchor.top - tooltip.height - gap
  const placement = above >= reservedTop + margin ? 'top' as const : 'bottom' as const
  return { left, top: placement === 'top' ? above : anchor.bottom + gap, arrowLeft: center - left, placement }
}
