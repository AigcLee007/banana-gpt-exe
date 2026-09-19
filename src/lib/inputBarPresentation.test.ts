import { describe, expect, it } from 'vitest'
import { getInputBarPresentation } from './inputBarPresentation'

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
