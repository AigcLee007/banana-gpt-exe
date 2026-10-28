type AgentScrollPosition = { scrollTop: number; scrollHeight: number; viewportHeight: number }

/** Includes the composer's reserved space, so a covered reply is not mistaken for the bottom. */
export function isAgentScrollAtBottom({ scrollTop, scrollHeight, viewportHeight }: AgentScrollPosition) {
  return scrollHeight - scrollTop - viewportHeight <= 48
}

/** Content can grow before a queued scroll event runs. Only moving upward cancels an existing follow. */
export function shouldFollowAgentScroll(following: boolean, previousScrollTop: number, position: AgentScrollPosition) {
  if (isAgentScrollAtBottom(position)) return true
  if (position.scrollTop < previousScrollTop - 1) return false
  return following
}
