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
