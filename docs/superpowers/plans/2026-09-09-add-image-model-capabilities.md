# Additional Image Model Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, and `seedream-5-pro` as selectable OpenAI Images models, with Seedream constrained to 1K and 2K.

**Architecture:** Keep `BANANA_MODEL_REGISTRY` as the source of truth for model routes and capabilities. Add supported size tiers to model metadata, pass those tiers into the size picker, and enforce the maximum tier in the shared parameter normalization path so Gallery, Agent, retry, restore, and programmatic submissions behave consistently. All three models reuse the existing OpenAI Images generation/edit adapter.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Vite

---

## File Map

- `src/lib/size.ts`: central size tiers, pixel budgets, and model-independent size normalization.
- `src/lib/bananaModels.ts`: model registry, route mapping, and supported-tier lookup.
- `src/lib/paramCompatibility.ts`: submission-time model-aware parameter normalization.
- `src/components/SizePickerModal.tsx`: render only the active model's supported tiers and clamp custom sizes.
- `src/components/InputBar.tsx`: pass active model capabilities to the picker.
- `src/lib/api.test.ts`: registry and OpenAI Images generation/edit dispatch coverage.
- `src/lib/size.test.ts`: size-tier normalization coverage.
- `src/lib/paramCompatibility.test.ts`: Seedream downgrade and legacy behavior coverage.
- `src/lib/apiProfiles.test.ts`: persisted Agent model normalization coverage.
- `package.json`: increment the patch release from `0.4.6-banana.9` to `0.4.6-banana.10`.
- `docs/releases/2026-09-09-v0.4.6-banana.10.md`: record the model additions and Seedream size restriction.

### Task 1: Add capability-aware size primitives and model registry

**Files:**
- Modify: `src/lib/size.ts`
- Modify: `src/lib/bananaModels.ts`
- Modify: `src/lib/api.test.ts`
- Create: `src/lib/size.test.ts`

- [ ] **Step 1: Write failing registry and size-normalization tests**

Add registry assertions for the three IDs, their `openai-images` route, reference-image support, display-name normalization, and supported tiers. Add a size assertion that a `4096x4096` request normalized with `maxTier: '2K'` becomes `2048x2048` while the existing unconstrained normalization remains unchanged.

```ts
expect(getBananaModelByDisplayName('GPT-Image-2.5 Sunburst')?.model).toBe('gpt-image-2.5-sunburst')
expect(getBananaModelRoute('gpt-image-2.5-flare')).toBe('openai-images')
expect(getBananaSupportedSizeTiers('seedream-5-pro')).toEqual(['1K', '2K'])
expect(getBananaSupportedSizeTiers('gpt-image-2.5-sunburst')).toEqual(['1K', '2K', '4K'])
expect(normalizeImageSize('4096x4096', { maxTier: '2K' })).toBe('2048x2048')
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
npm test -- src/lib/api.test.ts src/lib/size.test.ts
```

Expected result: the new imports/helpers are missing and the focused tests fail before implementation.

- [ ] **Step 3: Implement size-tier primitives**

In `src/lib/size.ts`, export the existing tier list as `SIZE_TIERS`, add an optional `{ maxTier?: SizeTier }` argument to `normalizeImageSize`, and pass `TIER_PIXEL_BUDGET[maxTier]` into the existing dimension-normalization loop. Keep the default budget equal to the current 4K budget so all existing one-argument calls retain their output.

```ts
export const SIZE_TIERS = ['1K', '2K', '4K'] as const
export type SizeTier = typeof SIZE_TIERS[number]

export function normalizeImageSize(size: string, options: { maxTier?: SizeTier } = {}) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const maxPixels = options.maxTier ? TIER_PIXEL_BUDGET[options.maxTier] : MAX_PIXELS
  const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]), maxPixels)
  return `${width}x${height}`
}
```

Update `normalizeDimensions` to accept the optional pixel budget without changing its existing edge, aspect-ratio, multiple-of-16, or minimum-pixel rules.

- [ ] **Step 4: Add registry capability metadata and lookup helpers**

Import `SIZE_TIERS` and `SizeTier` into `src/lib/bananaModels.ts`. Add optional `supportedSizeTiers` metadata to `BananaGalleryModel`; register all three new models after `gpt-image-2`, with GPT Image 2.5 entries using `SIZE_TIERS` and Seedream using `['1K', '2K']`. Add:

```ts
export function getBananaSupportedSizeTiers(model: string): readonly SizeTier[] {
  return getBananaModelById(model)?.supportedSizeTiers ?? SIZE_TIERS
}

export function getBananaMaxSizeTier(model: string): SizeTier {
  const tiers = getBananaSupportedSizeTiers(model)
  if (tiers.includes('4K')) return '4K'
  if (tiers.includes('2K')) return '2K'
  return '1K'
}
```

Leave existing model entries without an override so unknown and legacy models keep the full tier fallback.

- [ ] **Step 5: Run registry and size tests**

Run:

```powershell
npm test -- src/lib/api.test.ts src/lib/size.test.ts
```

Expected result: all focused registry and size tests pass.

- [ ] **Step 6: Commit the registry and size primitives**

```powershell
git add src/lib/size.ts src/lib/bananaModels.ts src/lib/api.test.ts src/lib/size.test.ts
git commit -m "feat: register image model size capabilities"
```

### Task 2: Enforce model size limits in normalization and UI

**Files:**
- Modify: `src/lib/paramCompatibility.ts`
- Modify: `src/lib/paramCompatibility.test.ts`
- Modify: `src/components/SizePickerModal.tsx`
- Modify: `src/components/InputBar.tsx`

- [ ] **Step 1: Write failing normalization tests**

Create normalized OpenAI settings for `seedream-5-pro` and assert that an explicit 4K square is downgraded to `2048x2048`, an explicit 2K size remains unchanged, and `auto` remains `auto`. Add a ratio case that asserts the downgraded width/height ratio remains within the existing legal-size tolerance. Assert that GPT Image 2.5 and an unknown OpenAI model retain the existing 4K normalization.

```ts
expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '4096x4096' }, seedreamSettings).size).toBe('2048x2048')
expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, seedreamSettings).size).toBe('2048x2048')
expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, seedreamSettings).size).toBe('auto')
```

- [ ] **Step 2: Run the parameter tests and confirm failure**

Run:

```powershell
npm test -- src/lib/paramCompatibility.test.ts
```

Expected result: Seedream still accepts the current 4K-normalized size because normalization is not model-aware.

- [ ] **Step 3: Apply the active model's maximum tier during normalization**

Import `getBananaMaxSizeTier` and change the initial `size` normalization in `normalizeParamsForSettings` to:

```ts
size: normalizeImageSize(params.size, {
  maxTier: getBananaMaxSizeTier(activeProfile.model),
}) || DEFAULT_PARAMS.size,
```

Keep the Gemini branch, fal.ai handling, transparent-output handling, quality handling, and output-count limits unchanged. The 4K fallback keeps current behavior for custom models.

- [ ] **Step 4: Make the size picker model-aware**

Add `supportedTiers?: readonly SizeTier[]` to `SizePickerModal` props. Replace the module-level fixed tier use with `supportedTiers` or `SIZE_TIERS`, use the filtered list in preset detection and the tier buttons, and normalize custom width/height with the maximum supported tier. Keep `allowAuto` behavior unchanged.

```tsx
<SizePickerModal
  currentSize={isFalTextToImage && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
  supportedTiers={supportedSizeTiers}
  onSelect={(size) => setParams({ size })}
  onClose={() => setShowSizePicker(false)}
  allowAuto={!isFalTextToImage}
/>
```

In `InputBar`, derive `activeImageModel` with `getActiveBananaModelForMode` and pass `getBananaSupportedSizeTiers(activeImageModel)` to the picker. Model changes continue to call `normalizeParamsForSettings`, which applies the downgrade immediately.

- [ ] **Step 5: Run UI-adjacent and store regression tests**

Run:

```powershell
npm test -- src/lib/paramCompatibility.test.ts src/lib/apiProfiles.test.ts src/store.test.ts
```

Expected result: parameter normalization, persisted Agent model settings, retry, restore, and existing Agent image flows pass.

- [ ] **Step 6: Commit capability-aware normalization and UI wiring**

```powershell
git add src/lib/paramCompatibility.ts src/lib/paramCompatibility.test.ts src/components/SizePickerModal.tsx src/components/InputBar.tsx src/lib/apiProfiles.test.ts src/store.test.ts
git commit -m "feat: enforce model-specific image size limits"
```

### Task 3: Verify OpenAI Images routing for all new models

**Files:**
- Modify: `src/lib/api.test.ts`

- [ ] **Step 1: Add failing generation and edit dispatch tests**

Parameterize generation tests over `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, and `seedream-5-pro`; assert `/v1/images/generations`, exact `body.model`, and the existing `size`, `quality`, `output_format`, `moderation`, and `n` fields. Add a corresponding reference-image test over all three IDs; assert `/v1/images/edits`, multipart `model`, `size`, and `quality` fields.

- [ ] **Step 2: Run the focused API tests and confirm failure if dispatch is incomplete**

Run:

```powershell
npm test -- src/lib/api.test.ts
```

Expected result: the tests pass once the registry route is present; if a model is missing or mapped to another route, the URL or model assertions fail.

- [ ] **Step 3: Keep the existing adapter route-based**

Do not add per-model request branches. `getBananaModelRoute` must resolve each new ID to `openai-images`; the existing `callOpenAICompatibleImageApi` fallback will use the existing Images API adapter, and the existing route-based streaming guard will keep these requests non-streaming like `gpt-image-2`.

- [ ] **Step 4: Run API and build verification**

```powershell
npm test -- src/lib/api.test.ts
npm run build
```

Expected result: focused API tests and the production build pass.

- [ ] **Step 5: Commit routing regression coverage**

```powershell
git add src/lib/api.test.ts
git commit -m "test: cover new image model request routing"
```

### Task 4: Version and release documentation

**Files:**
- Modify: `package.json`
- Create: `docs/releases/2026-09-09-v0.4.6-banana.10.md`

- [ ] **Step 1: Update the patch version**

Change the package version from `0.4.6-banana.9` to `0.4.6-banana.10` without changing dependencies or build configuration.

- [ ] **Step 2: Add the release record**

Document the three model IDs, the shared OpenAI Images interface, the Gallery/Agent availability, and the fact that Seedream exposes only 1K/2K and automatically downgrades explicit 4K state.

- [ ] **Step 3: Run the complete verification suite**

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected result: all tests pass, the build succeeds, the diff has no whitespace errors, and only the intended implementation/release files plus pre-existing untracked files remain.

- [ ] **Step 4: Commit release metadata**

```powershell
git add package.json docs/releases/2026-09-09-v0.4.6-banana.10.md
git commit -m "chore: release image model capability upgrade"
```

## Plan Self-Review

- Registry, route, reference-image, and selector requirements are covered by Tasks 1 and 3.
- Seedream's 1K/2K restriction is enforced in both the picker and shared normalization, covering UI, Agent, retry, restore, and programmatic entry points in Task 2.
- Existing models, custom models, `auto`, output parameters, and OpenAI Images routing retain their current fallback behavior.
- No step uses placeholders or leaves a required implementation boundary unspecified.
