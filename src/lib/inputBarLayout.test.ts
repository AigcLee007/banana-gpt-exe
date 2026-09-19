import { describe, expect, it } from 'vitest'
import { getInputBarClearance } from './inputBarLayout'

describe('getInputBarClearance', () => {
  it('measures clearance for an expanded input bar', () => {
    expect(getInputBarClearance(900, { top: 690 })).toBe(210)
  })

  it('measures clearance for a collapsed input bar', () => {
    expect(getInputBarClearance(900, { top: 838 })).toBe(62)
  })

  it('clamps clearance when the bar starts below the viewport', () => {
    expect(getInputBarClearance(900, { top: 940 })).toBe(0)
  })

  it('rounds fractional clearance up', () => {
    expect(getInputBarClearance(900, { top: 837.4 })).toBe(63)
  })
})
