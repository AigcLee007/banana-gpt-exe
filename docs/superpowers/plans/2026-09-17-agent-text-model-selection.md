# Agent Text Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Agent text-model setting with `gpt-5.6-sol` as the default and `gpt-6-astra` as the selectable alternative.

**Architecture:** Define a typed Agent text-model registry and normalize the new setting with existing `AppSettings` persistence. Reuse the existing Agent settings `Select` and pass the normalized setting to the main conversation, title, and batch-image Responses API request builders without changing image-model or API-profile behavior.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Vite

---

### Task 1: Add model registry and normalized settings

**Files:**
- Modify: `src/lib/bananaModels.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Test: `src/lib/apiProfiles.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Add assertions covering the default, `gpt-6-astra`, blank, and unsupported values:

```ts
it('defaults and normalizes the Agent text model', () => {
  expect(DEFAULT_SETTINGS.agentTextModel).toBe('gpt-5.6-sol')
  expect(normalizeSettings({ agentTextModel: 'gpt-6-astra' }).agentTextModel).toBe('gpt-6-astra')
  expect(normalizeSettings({ agentTextModel: '' }).agentTextModel).toBe('gpt-5.6-sol')
  expect(normalizeSettings({ agentTextModel: 'unknown-model' }).agentTextModel).toBe('gpt-5.6-sol')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/lib/apiProfiles.test.ts -t "defaults and normalizes the Agent text model"`

Expected: FAIL because `AppSettings` and `normalizeSettings` do not yet expose `agentTextModel`.

- [ ] **Step 3: Implement the registry and normalization**

In `src/lib/bananaModels.ts`, add a readonly registry with labels and derive `AgentTextModel`; keep `AGENT_FIXED_MODEL` as the first/default model ID. Add `agentTextModel: AgentTextModel` to `AppSettings`. In `src/lib/apiProfiles.ts`, normalize only registry model IDs, include the field in the normalized return value, and set `DEFAULT_SETTINGS.agentTextModel` to `AGENT_FIXED_MODEL`.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npm test -- src/lib/apiProfiles.test.ts`

Expected: PASS with existing API profile tests unchanged.

- [ ] **Step 5: Commit the settings foundation**

Run: `git add src/lib/bananaModels.ts src/types.ts src/lib/apiProfiles.ts src/lib/apiProfiles.test.ts && git commit -m "feat: add Agent text model setting"`

### Task 2: Route the selected model through Agent API requests

**Files:**
- Modify: `src/lib/agentApi.ts`
- Modify: `src/store.ts`
- Test: `src/lib/agentApi.test.ts`

- [ ] **Step 1: Add failing request-routing tests**

Add tests that call the main Agent request, title request, and `callBatchImageSingle` with `agentTextModel: 'gpt-6-astra'`, then inspect each request body and expect `model` to equal `gpt-6-astra`. Keep one legacy settings assertion expecting `gpt-5.6-sol` when the field is omitted.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- src/lib/agentApi.test.ts -t "selected Agent text model"`

Expected: FAIL because all request builders currently use `AGENT_FIXED_MODEL` and the batch helper has no settings input.

- [ ] **Step 3: Implement selected-model routing**

Use a defensive helper in `agentApi.ts` that returns the normalized `settings.agentTextModel` and falls back to `AGENT_FIXED_MODEL`. Replace the hard-coded model in the main conversation and title request bodies. Extend `callBatchImageSingle` options with `settings: AppSettings` and use the helper there. Update the `store.ts` batch-image callsite to pass `requestSettings`; leave `createFixedAgentProfile` fixed to the default model for route validation and preserve `agentImageModel` for image tasks.

- [ ] **Step 4: Run focused Agent and store tests**

Run: `npm test -- src/lib/agentApi.test.ts src/store.test.ts`

Expected: PASS, including existing image-model routing assertions.

- [ ] **Step 5: Commit Agent routing**

Run: `git add src/lib/agentApi.ts src/store.ts src/lib/agentApi.test.ts src/store.test.ts && git commit -m "feat: route Agent requests through selected text model"`

### Task 3: Add the Agent settings selector

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add the selector using existing settings patterns**

Import `AGENT_TEXT_MODELS`, add a labeled `Select` row under the Agent tab, map registry items to `{ label, value }`, and call `commitSettings({ ...draft, agentTextModel: String(value) as AgentTextModel })` on change. Show a concise description that the choice affects subsequent Agent requests.

- [ ] **Step 2: Verify type safety and build**

Run: `npm run build`

Expected: TypeScript compilation and Vite production build succeed.

### Task 4: Full verification and review

**Files:**
- Review: all files changed above

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff HEAD~2..HEAD --stat; git status --short`

Confirm only the intended settings, API, store, UI, tests, and plan files changed; generated logs and existing unrelated worktree files remain untouched.
