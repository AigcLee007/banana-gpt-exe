export const INPUT_BAR_EXPAND_EVENT = 'app:expand-input-composer'

export function requestInputBarExpansion() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INPUT_BAR_EXPAND_EVENT))
}

export function getInputBarPresentation(isComposerCollapsed: boolean) {
  const ariaExpanded = !isComposerCollapsed

  return {
    composerAriaHidden: isComposerCollapsed,
    composerInert: isComposerCollapsed ? true as const : undefined,
    capsuleTabIndex: isComposerCollapsed ? 0 : -1,
    collapseAriaExpanded: ariaExpanded,
    expandAriaExpanded: ariaExpanded,
  }
}

export function getInputBarExpandFocusTarget(isMobile: boolean) {
  return isMobile ? 'mobile' : 'desktop'
}
