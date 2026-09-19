# Balance Credit Unit Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display API Key remaining, total, and used balances with one truncated decimal place and the `💎` unit.

**Architecture:** Keep the balance API and numeric state unchanged. Add a small pure balance-display formatter that receives a number and returns its truncated one-decimal credit text; the two existing SettingsModal balance cards call it for each of their three values.

**Tech Stack:** TypeScript, React, Vitest, Vite.

---

### Task 1: Format balance values with the diamond unit

**Files:**
- Create: `src/lib/balanceCredits.ts`
- Create: `src/lib/balanceCredits.test.ts`
- Modify: `src/components/SettingsModal.tsx:27,1475-1484,1815-1824`

- [ ] **Step 1: Write the failing formatter test**

  Create `src/lib/balanceCredits.test.ts` with this complete test:

  ```ts
  import { describe, expect, it } from 'vitest'
  import { formatBalanceCredits } from './balanceCredits'

  describe('formatBalanceCredits', () => {
    it.each([
      [5, '5.0 💎'],
      [1.25, '1.2 💎'],
      [8.75, '8.7 💎'],
      [1249997524, '1249997524.0 💎'],
    ])('formats %s as %s', (credits, expected) => {
      expect(formatBalanceCredits(credits)).toBe(expected)
    })
  })
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- src/lib/balanceCredits.test.ts`

  Expected: FAIL because `./balanceCredits` does not yet exist.

- [ ] **Step 3: Add the presentation-only formatter**

  Create `src/lib/balanceCredits.ts` with this exact implementation:

  ```ts
  export function formatBalanceCredits(credits: number): string {
    return `${(Math.trunc(credits * 10) / 10).toFixed(1)} 💎`
  }
  ```

  This must not change API payloads, `ApiKeyBalanceInfo`, or any balance calculation.

- [ ] **Step 4: Render all three formatted values in both cards**

  In `src/components/SettingsModal.tsx`, import `formatBalanceCredits` from `../lib/balanceCredits`. Replace each raw `balanceInfo.remaining_points`, `balanceInfo.total_points`, and `balanceInfo.used_points` interpolation at both existing card locations with `formatBalanceCredits(...)`.

  The resulting JSX must retain the existing labels and layout:

  ```tsx
  <div className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-100">{formatBalanceCredits(balanceInfo.remaining_points)}</div>
  <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">总积分：{formatBalanceCredits(balanceInfo.total_points)}</div>
  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">已用积分：{formatBalanceCredits(balanceInfo.used_points)}</div>
  ```

- [ ] **Step 5: Run the focused test to verify it passes**

  Run: `npm test -- src/lib/balanceCredits.test.ts`

  Expected: PASS with four assertions, including whole numbers, truncation cases, and the screenshot-scale remaining balance.

- [ ] **Step 6: Run full verification**

  Run: `npm test && npm run build`

  Expected: the full Vitest suite passes and `tsc -b && vite build` exits successfully.

- [ ] **Step 7: Commit the feature**

  ```bash
  git add src/lib/balanceCredits.ts src/lib/balanceCredits.test.ts src/components/SettingsModal.tsx
  git commit -m "feat: format balance credits with diamond unit"
  ```

  Do not stage the unrelated `package-lock.json`, temporary directories, or local logs.
