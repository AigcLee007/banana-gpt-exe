# Agent Text Model gpt-5.6-sol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the fixed Agent text model to `gpt-5.6-sol` without changing API routes or image model behavior.

**Architecture:** Keep the existing `AGENT_FIXED_MODEL` single source of truth. Update its direct regression assertion first, then change only the constant so Agent conversation and title requests continue using the existing Responses API code paths.

**Tech Stack:** TypeScript, Vitest, Vite

---

### Task 1: Update the fixed Agent text model

**Files:**
- Modify: `src/lib/api.test.ts:1688`
- Modify: `src/lib/bananaModels.ts:10`

- [ ] **Step 1: Write the failing test**

Update the existing assertion:

```ts
it('uses gpt-5.6-sol as the fixed Agent text model', () => {
  expect(AGENT_FIXED_MODEL).toBe('gpt-5.6-sol')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/api.test.ts -t "uses gpt-5.6-sol as the fixed Agent text model"`

Expected: FAIL because `AGENT_FIXED_MODEL` is still `gpt-5.5-pro`.

- [ ] **Step 3: Write the minimal implementation**

Change the shared constant:

```ts
export const AGENT_FIXED_MODEL = 'gpt-5.6-sol'
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- src/lib/api.test.ts src/lib/agentApi.test.ts`

Expected: both test files pass, confirming model routing and Agent request bodies still use the shared constant.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build exits successfully.
