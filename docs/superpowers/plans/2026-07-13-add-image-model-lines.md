# Additional Image Model Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Nano Banana 2 and add two image models that reuse existing Gemini Native and OpenAI Images request routes.

**Architecture:** Extend `BANANA_MODEL_REGISTRY`, which is already the source of truth for selector labels, normalized IDs, parameter behavior, and route dispatch. Remove only Nano Banana 2 from the visibility filter; retain the legacy Agent-line exclusion.

**Tech Stack:** TypeScript, Vitest, Vite

---

### Task 1: Define visible model metadata and routes

**Files:**
- Modify: `src/lib/api.test.ts:1635`
- Modify: `src/lib/bananaModels.ts:12`

- [ ] **Step 1: Add failing registry tests**

Add assertions that `Nano Banana 2`, `Nano Banana 2 Lite`, and `GPT-Image-2(官转线路，支持高质量4K）` resolve to their requested IDs, are visible, and return `gemini-native`, `gemini-native`, and `openai-images` respectively.

- [ ] **Step 2: Verify the registry tests fail**

Run: `npm test -- src/lib/api.test.ts -t "shows Nano Banana 2 and the new image model lines"`

Expected: FAIL because Nano Banana 2 is hidden and the two new registry entries do not exist.

- [ ] **Step 3: Extend the registry and visibility filter**

Add these entries with `supportsReferenceImages: true`:

```ts
{
  displayName: 'Nano Banana 2 Lite',
  model: 'gemini-3.1-flash-lite-image',
  providerRoute: 'gemini-native',
  supportsReferenceImages: true,
},
{
  displayName: 'GPT-Image-2(官转线路，支持高质量4K）',
  model: 'gpt-image-2-official',
  providerRoute: 'openai-images',
  supportsReferenceImages: true,
},
```

Change `BANANA_GALLERY_MODELS` to exclude only `gpt-5.5`.

- [ ] **Step 4: Verify registry tests pass**

Run: `npm test -- src/lib/api.test.ts -t "shows Nano Banana 2 and the new image model lines"`

Expected: PASS.

### Task 2: Verify inherited request dispatch

**Files:**
- Modify: `src/lib/api.test.ts`

- [ ] **Step 1: Add request-routing tests**

Call `callImageApi` using `gemini-3.1-flash-lite-image` and assert the URL contains `/v1beta/models/gemini-3.1-flash-lite-image:generateContent`. Call it using `gpt-image-2-official` and assert the URL contains `/v1/images/generations` and the JSON body contains `model: 'gpt-image-2-official'`.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- src/lib/api.test.ts`

Expected: all API tests pass.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build exits successfully.
