import { afterEach, describe, expect, it } from 'vitest'
import type { AgentConversation } from '../types'
import { getManagedAgentRenameKeyAction, getManagedAgentRenameTitle, groupManagedAgentConversations } from './managedAgentHistory'

const originalTimezone = process.env.TZ
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
})

function conversation(id: string, date: Date, title = id): AgentConversation {
  return { id, title, createdAt: date.getTime(), updatedAt: date.getTime(), rounds: [], messages: [] }
}

const ids = (groups: ReturnType<typeof groupManagedAgentConversations>) => groups.map(group => [group.label, group.conversations.map(item => item.id)])

describe('managed Agent history dates', () => {
  it('groups using local midnight boundaries across a month and year change', () => {
    process.env.TZ = 'Asia/Shanghai'
    const groups = groupManagedAgentConversations([
      conversation('earlier', new Date(2025, 11, 30, 23, 59)),
      conversation('yesterday', new Date(2025, 11, 31, 23, 59)),
      conversation('today', new Date(2026, 0, 1, 0, 0)),
    ], new Date(2026, 0, 1, 0, 1))
    expect(ids(groups)).toEqual([['今天', ['today']], ['昨天', ['yesterday']], ['更早', ['earlier']]])
  })

  it('does not treat the previous two calendar days as yesterday on the spring DST transition', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date(2026, 2, 9, 0, 5)
    expect(new Date(2026, 2, 7, 23, 59).getTimezoneOffset()).not.toBe(now.getTimezoneOffset())
    const groups = groupManagedAgentConversations([
      conversation('earlier', new Date(2026, 2, 7, 23, 59)),
      conversation('yesterday', new Date(2026, 2, 8, 0, 1)),
    ], now)
    expect(ids(groups)).toEqual([['昨天', ['yesterday']], ['更早', ['earlier']]])
  })

  it('keeps the full 25-hour yesterday together on the autumn DST transition', () => {
    process.env.TZ = 'America/New_York'
    expect(new Date(2026, 10, 1, 0, 1).getTimezoneOffset()).not.toBe(new Date(2026, 10, 2, 0, 5).getTimezoneOffset())
    const groups = groupManagedAgentConversations([
      conversation('early', new Date(2026, 10, 1, 0, 1)),
      conversation('late', new Date(2026, 10, 1, 23, 59)),
    ], new Date(2026, 10, 2, 0, 5))
    expect(ids(groups)).toEqual([['昨天', ['late', 'early']]])
  })

  it('sorts each group by latest update without mutating source order or breaking equal-time ties', () => {
    const now = new Date(2026, 9, 16, 12)
    const first = conversation('first', new Date(2026, 9, 16, 9))
    const second = conversation('second', new Date(2026, 9, 16, 9))
    const latest = conversation('latest', new Date(2026, 9, 16, 11))
    const source = [first, second, latest]
    expect(ids(groupManagedAgentConversations(source, now))).toEqual([['今天', ['latest', 'first', 'second']]])
    expect(source.map(item => item.id)).toEqual(['first', 'second', 'latest'])
  })

  it('omits empty date groups', () => {
    expect(groupManagedAgentConversations([], new Date())).toEqual([])
  })
})

describe('managed Agent inline rename', () => {
  const item = conversation('a', new Date(2026, 9, 16), '原标题')

  it('blocks commits while the same conversation title is generating', () => {
    expect(getManagedAgentRenameTitle(item, '新标题', { a: true })).toBeNull()
  })

  it('allows a trimmed rename while another conversation title is generating', () => {
    expect(getManagedAgentRenameTitle(item, '  新标题  ', { other: true })).toBe('新标题')
  })

  it('does not commit blank or unchanged titles', () => {
    expect(getManagedAgentRenameTitle(item, '  ', {})).toBeNull()
    expect(getManagedAgentRenameTitle(item, '  原标题 ', {})).toBeNull()
  })

  it('leaves Escape and Enter to the input method while composing a title', () => {
    expect(getManagedAgentRenameKeyAction('Escape', true)).toBeNull()
    expect(getManagedAgentRenameKeyAction('Enter', true)).toBeNull()
    expect(getManagedAgentRenameKeyAction('Escape', false)).toBe('cancel')
    expect(getManagedAgentRenameKeyAction('Enter', false)).toBe('commit')
    expect(getManagedAgentRenameKeyAction('ArrowLeft', false)).toBeNull()
  })
})
