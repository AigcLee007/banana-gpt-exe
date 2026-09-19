# Model Credit Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each image model's fixed per-image credit price beside its name in both model selectors, including the size-specific Official T3 price.

**Architecture:** Keep RMB prices and the existing model metadata together in `bananaModels.ts`; derive credits with a single `¥1 = 12.5 💎` helper. Move the existing Official T3 size-to-upstream-model mapping into that shared registry module so API dispatch and UI pricing consume the exact same mapping. `InputBar` builds both Gallery and Agent options from one formatted-label helper.

**Tech Stack:** TypeScript, React 19, Vitest, Vite, Tailwind CSS.

---

## File structure

- Modify: `src/lib/bananaModels.ts` — registry RMB values, canonical Official-T3 per-size model/price map, credit conversion and selector-label helpers.
- Modify: `src/lib/openaiCompatibleImageApi.ts` — replace its private Official-T3 model-ID template with the shared resolver, leaving request shape and route unchanged.
- Modify: `src/lib/api.test.ts` — test all pricing/formatting mappings and retain the existing size-specific T3 request assertions.
- Modify: `src/components/InputBar.tsx` — use one price-bearing option list and matching active-label titles in Gallery and Agent selectors.

### Task 1: Add canonical model-price metadata and shared T3 mapping

**Files:**
- Modify: `src/lib/bananaModels.ts:1-107`
- Test: `src/lib/api.test.ts:1-8,1738-1911`

- [ ] **Step 1: Add failing price and Official-T3 mapping tests to `src/lib/api.test.ts`**

  Extend the `bananaModels` imports with `getBananaModelCreditsPerImage`, `getBananaModelCreditLabel`, and `getBananaT3RequestModelForSize`. Add this test in the existing `describe('bananaModels', ...)` block:

  ```ts
  it.each([
    ['gemini-3-pro-image-preview', '2K', 5, '5 💎'],
    ['gpt-image-2.5-sunburst', '2K', 3.75, '3.75 💎'],
    ['gpt-image-2.5-sunburst-官渠（支持max）', '2K', 8.75, '8.75 💎'],
    ['gpt-image-2.5-flare', '2K', 3.75, '3.75 💎'],
    ['gpt-image-2', '2K', 3.75, '3.75 💎'],
    ['seedream-5-pro', '2K', 3.125, '3.125 💎'],
    ['gemini-3.1-flash-image-preview', '2K', 2.5, '2.5 💎'],
    ['gemini-3.1-flash-lite-image', '2K', 1.25, '1.25 💎'],
    ['gpt-image-2-official', '2K', 10, '10 💎'],
    ['nano-banana-pro', '2K', 5, '5 💎'],
    ['gpt-image-2-svip', '2K', 3.75, '3.75 💎'],
  ] as const)('formats %s as its configured per-image credit price', (model, imageSize, credits, label) => {
    expect(getBananaModelCreditsPerImage(model, imageSize)).toBe(credits)
    expect(getBananaModelCreditLabel(model, imageSize)).toBe(label)
  })

  it.each([
    ['1K', 'Nano-banana-pro-1K', 6.25, '6.25 💎'],
    ['2K', 'Nano-banana-pro-2K', 7.5, '7.5 💎'],
    ['4K', 'Nano-banana-pro-4K', 8.75, '8.75 💎'],
  ] as const)('maps Official T3 %s to its upstream model and price', (imageSize, requestModel, credits, label) => {
    expect(getBananaT3RequestModelForSize(imageSize)).toBe(requestModel)
    expect(getBananaModelCreditsPerImage('nano-banana-pro-official-t3', imageSize)).toBe(credits)
    expect(getBananaModelCreditLabel('nano-banana-pro-official-t3', imageSize)).toBe(label)
  })

  it('marks an unpriced model as unavailable instead of zero credits', () => {
    expect(getBananaModelCreditsPerImage('not-configured', '2K')).toBeUndefined()
    expect(getBananaModelCreditLabel('not-configured', '2K')).toBe('价格待配置')
  })
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: FAIL because the three pricing helpers are not exported by `bananaModels.ts`.

- [ ] **Step 3: Add price metadata and pure helpers in `src/lib/bananaModels.ts`**

  Add the following public types/constants immediately after the existing `BananaQuality` type:

  ```ts
  export const CREDITS_PER_YUAN = 12.5
  export const OFFICIAL_T3_MODEL = 'nano-banana-pro-official-t3'

  const BANANA_T3_BY_SIZE = {
    '1K': { requestModel: 'Nano-banana-pro-1K', pricePerImageYuan: 0.5 },
    '2K': { requestModel: 'Nano-banana-pro-2K', pricePerImageYuan: 0.6 },
    '4K': { requestModel: 'Nano-banana-pro-4K', pricePerImageYuan: 0.7 },
  } as const satisfies Record<SizeTier, { requestModel: string, pricePerImageYuan: number }>
  ```

  Extend `BananaGalleryModel` with `pricePerImageYuan?: number`. Add `pricePerImageYuan` to the registry entries as follows:

  ```ts
  // gemini-3-pro-image-preview: 0.4
  // gpt-image-2.5-sunburst: 0.3
  // gpt-image-2.5-sunburst-官渠（支持max）: 0.7
  // gpt-image-2.5-flare: 0.3
  // gpt-image-2: 0.3
  // seedream-5-pro: 0.25
  // gemini-3.1-flash-image-preview: 0.2
  // gemini-3.1-flash-lite-image: 0.1
  // gpt-image-2-official: 0.8
  // nano-banana-pro: 0.4
  // gpt-image-2-svip: 0.3
  ```

  Keep the T3 sentinel registry value as `OFFICIAL_T3_MODEL`; do not assign it one fixed price because its price is size-specific. Keep `gpt-5.5` unpriced.

  Add these helpers after `getBananaModelById`:

  ```ts
  export function getBananaT3RequestModelForSize(imageSize: SizeTier): string {
    return BANANA_T3_BY_SIZE[imageSize].requestModel
  }

  export function getBananaModelCreditsPerImage(model: string, imageSize: SizeTier = '2K'): number | undefined {
    const normalized = normalizeBananaModelId(model)
    const yuan = normalized === OFFICIAL_T3_MODEL
      ? BANANA_T3_BY_SIZE[imageSize].pricePerImageYuan
      : getBananaModelById(normalized)?.pricePerImageYuan
    return yuan === undefined ? undefined : Number((yuan * CREDITS_PER_YUAN).toFixed(3))
  }

  export function getBananaModelCreditLabel(model: string, imageSize: SizeTier = '2K'): string {
    const credits = getBananaModelCreditsPerImage(model, imageSize)
    return credits === undefined ? '价格待配置' : `${credits} 💎`
  }
  ```

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: PASS, including exact `3.125 💎` formatting and all three T3 request-ID/price pairs.

- [ ] **Step 5: Commit the shared pricing data**

  ```bash
  git add src/lib/bananaModels.ts src/lib/api.test.ts
  git commit -m "feat: define image model credit prices"
  ```

### Task 2: Reuse the canonical Official-T3 resolver in API dispatch

**Files:**
- Modify: `src/lib/openaiCompatibleImageApi.ts:3,266-280,336-344`
- Test: `src/lib/api.test.ts:181-215,300-334`

- [ ] **Step 1: Confirm the existing dispatch tests cover all T3 sizes**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: PASS for the parameterized test named `routes official T3 %s text-to-image through images generations with compatible payload`, covering 1K, 2K, and 4K.

- [ ] **Step 2: Replace the private T3 resolver with the shared resolver**

  Change the `bananaModels` import to include `getBananaT3RequestModelForSize`. Delete the private function:

  ```ts
  function getBananaT3ModelForImageSize(imageSize: ReturnType<typeof normalizeGeminiImageSize>): string {
    return `Nano-banana-pro-${imageSize}`
  }
  ```

  Replace its two usages with the shared function:

  ```ts
  model: getBananaT3RequestModelForSize(requestSpec.imageSize),
  ```

  and:

  ```ts
  const requestModel = getBananaT3RequestModelForSize(requestSpec.imageSize)
  ```

  Do not change URLs, payload fields, reference-image conversion, concurrency, or the `nano-banana-pro-official-t3` sentinel used to select the `banana-t3-images` route.

- [ ] **Step 3: Run the focused API test to verify behavior remains unchanged**

  Run: `npm test -- src/lib/api.test.ts`

  Expected: PASS; the JSON request body still contains `Nano-banana-pro-1K`, `Nano-banana-pro-2K`, or `Nano-banana-pro-4K` for the corresponding tier.

- [ ] **Step 4: Commit the shared resolver adoption**

  ```bash
  git add src/lib/openaiCompatibleImageApi.ts src/lib/api.test.ts
  git commit -m "refactor: share official T3 model mapping"
  ```

### Task 3: Render the diamond credit price in both model selectors

**Files:**
- Modify: `src/components/InputBar.tsx:14,700-712,1833-1879`
- Test: `src/lib/api.test.ts:1738-1911`

- [ ] **Step 1: Build shared selector options in `src/components/InputBar.tsx`**

  Import `getBananaModelCreditLabel` from `../lib/bananaModels`. After `geminiImageSize` is calculated, add:

  ```ts
  const imageModelOptions = BANANA_GALLERY_MODELS.map((item) => ({
    label: `${item.displayName} · ${getBananaModelCreditLabel(item.model, geminiImageSize)}`,
    value: item.model,
  }))
  const getImageModelOptionLabel = (model: string) => {
    const item = BANANA_GALLERY_MODELS.find((candidate) => candidate.model === model)
    return item
      ? `${item.displayName} · ${getBananaModelCreditLabel(item.model, geminiImageSize)}`
      : String(model)
  }
  ```

  In both Gallery and Agent `Select` calls, replace their duplicated `BANANA_GALLERY_MODELS.map(...)` expressions with `options={imageModelOptions}`. Replace each `triggerTitle` expression with the relevant `getImageModelOptionLabel(galleryModel)` or `getImageModelOptionLabel(agentImageModel)` call. Keep `truncateOptionLabel={false}` so the full name and diamond amount remain visible.

- [ ] **Step 2: Run the focused tests and production type/build check**

  Run: `npm test -- src/lib/api.test.ts && npm run build`

  Expected: both commands exit 0. The TypeScript build confirms the shared option labels satisfy the existing `Select` `ReactNode` label type.

- [ ] **Step 3: Manually verify Gallery, Agent, and Official T3 interaction**

  Run: `npm run dev`

  In the local app, verify:

  1. Gallery and Agent dropdown entries display `模型名 · 积分 💎`, including `Nano Banana Pro（优惠线路） · 5 💎`.
  2. The closed control preserves the same text after selection.
  3. Choosing Official T3 and switching image size 1K → 2K → 4K updates its displayed suffix to `6.25 💎` → `7.5 💎` → `8.75 💎`.
  4. The existing generation request still sends the matching `Nano-banana-pro-{size}` model ID.

- [ ] **Step 4: Run the full suite and commit the UI**

  Run: `npm test && npm run build`

  Expected: both commands exit 0.

  ```bash
  git add src/components/InputBar.tsx src/lib/api.test.ts
  git commit -m "feat: show image model credit prices"
  ```

### Task 4: Review the completed feature before integration

**Files:**
- Review: `src/lib/bananaModels.ts`
- Review: `src/lib/openaiCompatibleImageApi.ts`
- Review: `src/components/InputBar.tsx`

- [ ] **Step 1: Inspect the final diff for scope and price correctness**

  Run: `git diff main~3..HEAD -- src/lib/bananaModels.ts src/lib/openaiCompatibleImageApi.ts src/components/InputBar.tsx src/lib/api.test.ts`

  Expected: only static model pricing, shared T3 resolver extraction, selector-label presentation, and tests are present; no balance deduction or remote-pricing changes appear.

- [ ] **Step 2: Check the worktree before handoff**

  Run: `git status --short`

  Expected: no tracked source or test changes remain after commits. Preserve existing unrelated untracked development files.
