import { describe, expect, it } from 'vitest'
import { getInputBarExpandFocusTarget, getInputBarPresentation } from './inputBarPresentation'

describe('getInputBarPresentation', () => {
  it('keeps the composer interactive and the capsule out of the tab order when expanded', () => {
    expect(getInputBarPresentation(false)).toEqual({
      composerAriaHidden: false,
      composerInert: undefined,
      capsuleTabIndex: -1,
      collapseAriaExpanded: true,
      expandAriaExpanded: true,
    })
  })

  it('makes only the expand capsule interactive when collapsed', () => {
    expect(getInputBarPresentation(true)).toEqual({
      composerAriaHidden: true,
      composerInert: true,
      capsuleTabIndex: 0,
      collapseAriaExpanded: false,
      expandAriaExpanded: false,
    })
  })
})

describe('getInputBarExpandFocusTarget', () => {
  it('selects the visible mobile collapse control on mobile', () => {
    expect(getInputBarExpandFocusTarget(true)).toBe('mobile')
  })

  it('selects the desktop collapse control on desktop', () => {
    expect(getInputBarExpandFocusTarget(false)).toBe('desktop')
  })
})
