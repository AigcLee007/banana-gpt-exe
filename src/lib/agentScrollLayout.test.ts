import { describe, expect, it } from 'vitest'
import { isAgentScrollAtBottom, shouldFollowAgentScroll } from './agentScrollLayout'

describe('Agent bottom following', () => {
  it('follows the actual page bottom including reserved composer space', () => {
    expect(isAgentScrollAtBottom({ scrollTop: 1000, scrollHeight: 1900, viewportHeight: 900 })).toBe(true)
    expect(isAgentScrollAtBottom({ scrollTop: 970, scrollHeight: 1900, viewportHeight: 900 })).toBe(true)
  })
  it('does not consider a reply hidden behind the composer to be the page bottom', () => {
    expect(isAgentScrollAtBottom({ scrollTop: 700, scrollHeight: 1900, viewportHeight: 900 })).toBe(false)
  })
  it('keeps historical reading positions independent of later content growth', () => {
    expect(isAgentScrollAtBottom({ scrollTop: 1200, scrollHeight: 4000, viewportHeight: 900 })).toBe(false)
  })
  it('tolerates fractional browser geometry, short conversations and overscroll', () => {
    expect(isAgentScrollAtBottom({ scrollTop: 1000.1, scrollHeight: 1900.5, viewportHeight: 900 })).toBe(true)
    expect(isAgentScrollAtBottom({ scrollTop: 0, scrollHeight: 600, viewportHeight: 900 })).toBe(true)
    expect(isAgentScrollAtBottom({ scrollTop: 1020, scrollHeight: 1900, viewportHeight: 900 })).toBe(true)
  })
  it('keeps following when a delayed scroll event sees newly grown content', () => {
    expect(shouldFollowAgentScroll(true, 1000, { scrollTop: 1000, scrollHeight: 1965, viewportHeight: 900 })).toBe(true)
    expect(shouldFollowAgentScroll(true, 1000, { scrollTop: 1065, scrollHeight: 2030, viewportHeight: 900 })).toBe(true)
  })
  it('stops following when the reader actually moves upward', () => {
    expect(shouldFollowAgentScroll(true, 1000, { scrollTop: 900, scrollHeight: 1965, viewportHeight: 900 })).toBe(false)
  })
  it('resumes only after the reader reaches the bottom', () => {
    expect(shouldFollowAgentScroll(false, 800, { scrollTop: 900, scrollHeight: 1965, viewportHeight: 900 })).toBe(false)
    expect(shouldFollowAgentScroll(false, 900, { scrollTop: 1065, scrollHeight: 1965, viewportHeight: 900 })).toBe(true)
  })
})
