import { describe, expect, it } from 'vitest'
import { formatBalanceCredits } from './balanceCredits'

describe('formatBalanceCredits', () => {
  it.each([
    [5, '5.0 💎'],
    [1.25, '1.2 💎'],
    [8.75, '8.7 💎'],
    [1249997524, '1249997524.0 💎'],
  ])('formats %s credits with the diamond unit', (credits, expected) => {
    expect(formatBalanceCredits(credits)).toBe(expected)
  })
})
