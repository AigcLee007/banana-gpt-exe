# Model Credit One Decimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every configured image-model credit price with exactly one decimal place, truncating toward zero rather than rounding.

**Architecture:** Keep `getBananaModelCreditsPerImage` unchanged so request pricing remains numerically exact. Add a small shared formatter in `bananaModels.ts`, and have `getBananaModelCreditLabel` use it only for presentation; all existing Gallery and Agent selectors inherit the change through that label function.

**Tech Stack:** TypeScript, Vitest, Vite.

---

### Task 1: Truncated one-decimal credit labels

**Files:**
- Modify: `src/lib/api.test.ts:5,1738-1775`
- Modify: `src/lib/bananaModels.ts:179-182`
- Test: `src/lib/api.test.ts`

- [ ] **Step 1: Write the failing label expectations**

  In the existing `describe('bananaModels')` suite, replace the interpolated label assertion in the static-credit table with the following expected-label table so whole numbers, fractional values, and a three-decimal value all define the display contract:

  ```ts
  it.each([
    ['gemini-3-pro-image-preview', 5, '5.0 💎'],
    ['gpt-image-2.5-sunburst', 3.75, '3.7 💎'],
    ['gpt-image-2.5-sunburst-官渠（支持max）', 8.75, '8.7 💎'],
    ['gpt-image-2.5-flare', 3.75, '3.7 💎'],
    ['gpt-image-2', 3.75, '3.7 💎'],
    ['gemini-3.1-flash-lite-image', 1.25, '1.2 💎'],
    ['gpt-image-2-official', 10, '10.0 💎'],
    ['nano-banana-pro', 5, '5.0 💎'],
    ['gpt-image-2-svip', 3.75, '3.7 💎'],
  ] as const)('calculates %s static image-model credits', (model, credits, label) => {
    expect(getBananaModelCreditsPerImage(model)).toBe(credits)
    expect(getBananaModelCreditLabel(model)).toBe(label)
  })
  ```

  Change the Seedream assertion to `expect(getBananaModelCreditLabel('seedream-5-pro')).toBe('3.1 💎')`. In the T3 size table, add the expected label argument (`'6.2 💎'`, `'7.5 💎'`, `'8.7 💎'` for 1K, 2K, 4K) and assert against it. Keep the unknown-model assertions unchanged.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: FAIL because `getBananaModelCreditLabel` still returns unformatted values such as `5 💎`, `1.25 💎`, `8.75 💎`, and `3.125 💎`.

- [ ] **Step 3: Add the presentation-only truncating formatter**

  Directly above `getBananaModelCreditLabel` in `src/lib/bananaModels.ts`, add this helper and make the label function call it:

  ```ts
  export function formatBananaModelCredits(credits: number): string {
    return (Math.trunc(credits * 10) / 10).toFixed(1)
  }

  export function getBananaModelCreditLabel(model: string, imageSize: SizeTier = '2K'): string {
    const credits = getBananaModelCreditsPerImage(model, imageSize)
    return credits === undefined ? '价格待配置' : `${formatBananaModelCredits(credits)} 💎`
  }
  ```

  Do not alter `getBananaModelCreditsPerImage`, `CREDITS_PER_YUAN`, model metadata, or request IDs. `Math.trunc` preserves the requested toward-zero behavior; `toFixed(1)` is used only after truncation to retain the trailing zero.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: PASS, including the one-decimal static labels, the three T3 size labels, and `价格待配置` fallbacks.

- [ ] **Step 5: Run the full verification suite**

  Run: `npm test && npm run build`

  Expected: all Vitest files/tests pass and `tsc -b && vite build` completes successfully.

- [ ] **Step 6: Commit the completed behavior**

  ```bash
  git add src/lib/bananaModels.ts src/lib/api.test.ts
  git commit -m "fix: truncate model credit labels"
  ```

  Do not stage unrelated workspace files such as `package-lock.json`, `.playwright-cli/`, `.tmp-upstream/`, or local log files.
