# Model Credit Right Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-align every model credit-and-diamond suffix in the open model dropdown without changing other selects.

**Architecture:** Add optional `secondaryLabel` metadata to `Select` options. When it is present, `Select` renders a flexible, truncatable primary label on the left and a non-shrinking secondary label on the right. `InputBar` supplies the existing credit text as this metadata only for model options.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Vitest, Vite.

---

### Task 1: Support right-aligned secondary option labels

**Files:**
- Modify: `src/components/Select.tsx:7-17,350-381`
- Test: `src/lib/api.test.ts:1738-1777`

- [ ] **Step 1: Write a failing pure label-contract test**

  In the existing `describe('bananaModels', ...)` block, add:

  ```ts
  it('keeps the model name and credit suffix as separate selector values', () => {
    expect(getBananaModelCreditLabel('gemini-3-pro-image-preview', '2K')).toBe('5 💎')
    expect(getBananaModelCreditLabel('seedream-5-pro', '2K')).toBe('3.125 💎')
    expect(getBananaModelCreditLabel('not-configured', '2K')).toBe('价格待配置')
  })
  ```

- [ ] **Step 2: Run the focused test to establish the label contract**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: PASS; it records the exact secondary strings that the model selector must render without wrapping.

- [ ] **Step 3: Extend `Select` with opt-in secondary-label rendering**

  Add `secondaryLabel?: ReactNode` to `Option`. In the option-row body, replace the primary-label span with:

  ```tsx
  <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
    <span className="min-w-0 flex-1 truncate">{option.label}</span>
    {option.secondaryLabel && (
      <span className="ml-auto shrink-0 whitespace-nowrap text-[color:var(--app-text-subtle)]">
        {option.secondaryLabel}
      </span>
    )}
  </div>
  ```

  Preserve draggable handles by keeping them immediately before this block. Do not change the closed-trigger rendering, action buttons, or options that lack `secondaryLabel`.

- [ ] **Step 4: Run the focused tests and production build**

  Run: `npm test -- src/lib/api.test.ts && npm run build`

  Expected: both commands exit 0.

### Task 2: Supply credits as the model option secondary label

**Files:**
- Modify: `src/components/InputBar.tsx:711-720`
- Test: `src/lib/api.test.ts:1738-1777`

- [ ] **Step 1: Change model options to pass independent primary and secondary values**

  Replace `imageModelOptions` with:

  ```ts
  const imageModelOptions = BANANA_GALLERY_MODELS.map((item) => ({
    label: item.displayName,
    secondaryLabel: getBananaModelCreditLabel(item.model, geminiImageSize),
    value: item.model,
  }))
  ```

  Keep `getImageModelOptionLabel` unchanged so the closed control still shows `模型名 · 积分 💎`.

- [ ] **Step 2: Verify Gallery and Agent model options**

  Run: `npm test && npm run build`

  Expected: both commands exit 0.

- [ ] **Step 3: Manually inspect the open selectors**

  Run: `npm run dev`

  Verify that Gallery and Agent options align `5 💎`, `3.75 💎`, `3.125 💎`, and `价格待配置` to the same right edge; long names truncate first; and the closed selector remains unchanged.

- [ ] **Step 4: Commit the feature**

  ```bash
  git add src/components/Select.tsx src/components/InputBar.tsx src/lib/api.test.ts
  git commit -m "style: align model credit labels"
  ```
