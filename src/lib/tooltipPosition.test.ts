import { describe, expect, it } from 'vitest'
import { positionTooltip } from './tooltipPosition'

describe('tooltip placement below the shared navigation', () => {
  it('places the tooltip below its button when the space above belongs to the appbar', () => {
    expect(positionTooltip({ left: 1300, top: 62, bottom: 98, width: 36 }, { width: 90, height: 32 }, 1440, 48).placement).toBe('bottom')
  })
  it('still allows top placement when it clears the shared navigation', () => {
    expect(positionTooltip({ left: 200, top: 180, bottom: 216, width: 36 }, { width: 90, height: 32 }, 1440, 48).placement).toBe('top')
  })
  it('keeps standalone tooltips within the right viewport edge', () => {
    const result = positionTooltip({ left: 370, top: 5, bottom: 40, width: 20 }, { width: 90, height: 32 }, 390)
    expect(result.left).toBe(292)
    expect(result.placement).toBe('bottom')
  })
})
