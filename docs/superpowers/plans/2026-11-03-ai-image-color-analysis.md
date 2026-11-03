# AI Image Color Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit image-analysis action that asks the configured Agent to inspect the current color preview and propose a validated recipe, while leaving application and image saving under the user's control.

**Architecture:** Reuse `ColorAssistantPanel` request cancellation, compressed preview generation, `callAgentColorAssistantApi`, proposal validation, candidate preview, and history persistence. Distinguish natural-language and image-analysis intents only in the panel; image analysis supplies a fixed localized diagnostic instruction without requiring text input. Represent no-change analysis as a normal history candidate that the user can accept as keeping the current recipe or discard.

**Tech Stack:** React 19, TypeScript, Vitest, existing Responses API structured function tool, IndexedDB color-assistant history.

---

### Task 1: Add an explicit image-analysis request mode

**Files:**
- Modify: `src/components/ColorAssistantPanel.tsx`
- Modify: `src/components/ColorAssistantPanel.test.tsx`
- Modify: `src/components/ColorGradingEditor.css`

- [x] **Step 1: Write a failing panel test for explicit image analysis**

Add a test that opens the editor with a ready preview and an empty instruction. Assert that no Agent request is made on open, the image-analysis action is enabled, and clicking it calls the assistant with a non-empty fixed diagnostic instruction, the current recipe, and a preview image. Assert that no candidate is applied before the user action.

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx -t "image analysis"`

Expected: FAIL because the panel has no image-analysis action and currently requires typed text.

- [x] **Step 2: Implement request intent and the explicit action**

Add a localized fixed instruction that asks the model to identify visible color-balance issues, explain its observations in Chinese, and make conservative targeted changes only when the preview shows a problem. Allow `submit` to receive either the typed instruction or this fixed instruction. Keep `createColorAssistantPreviewDataUrl` and the current adjustment snapshot on both paths.

Render separate actions labeled `提交调色建议` and `分析图片色彩`. Gate each action on preview readiness, valid Agent configuration, and request state; only the natural-language action requires non-empty textarea content. Update the privacy notice to name both explicit actions.

- [x] **Step 3: Verify request-mode behavior**

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx`

Expected: PASS, including no request on open, image attached only after clicking analysis, current recipe included, and existing manual requests still working.

### Task 2: Handle recommendations that require no parameter changes

**Files:**
- Modify: `src/components/ColorAssistantPanel.tsx`
- Modify: `src/components/ColorAssistantPanel.test.tsx`

- [x] **Step 1: Write failing tests for accepting and discarding a no-change result**

Return a valid proposal with an explanation and empty `changes` and `curves`. Assert that the panel displays the analysis, hides `应用建议`, and offers `保持当前配方` and `放弃建议`. Clicking `保持当前配方` records outcome `applied` without calling `onApply`; clicking `放弃建议` records outcome `discarded` without calling `onApply`.

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx -t "no-change analysis"`

Expected: FAIL because the current candidate UI only offers a discard action when the proposal has no edits.

- [x] **Step 2: Add explicit no-change decision actions**

When a candidate has no scalar or curve changes, show `保持当前配方` and `放弃建议`. The first action clears the candidate and records it as `applied` to represent acceptance of the recommendation; it must not call `onApply` or mutate the recipe. Preserve the existing apply/discard actions for candidates with actual edits.

- [x] **Step 3: Verify candidate decision and history behavior**

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx`

Expected: PASS for changed and no-change proposals, history state transitions, and no automatic recipe mutation.

### Task 3: Preserve failure, cancellation, and iterative-adjustment behavior

**Files:**
- Modify: `src/components/ColorAssistantPanel.tsx`
- Modify: `src/components/ColorAssistantPanel.test.tsx`
- Verify: `src/components/ColorGradingEditor.test.tsx`

- [x] **Step 1: Add focused regression tests for analysis failure and stale state**

Assert that an analysis response rejecting image input shows a recoverable error, does not offer text-only retry, and leaves the recipe unchanged. Assert that cancelling or changing the active image/recipe while analysis is pending prevents a stale candidate from appearing and expires any persisted pending record. Retain the existing text-only retry behavior for natural-language requests.

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx -t "analysis failure|stale analysis|text-only retry"`

Expected: FAIL only for any new analysis-specific behavior not already supported.

- [x] **Step 2: Scope retry state to the request intent**

Keep the image-analysis mode when handling image-input errors so the retry button remains exclusive to typed natural-language requests. Reuse the existing AbortController and request identity checks for both modes. Do not change `src/lib/agentApi.ts` or add a new endpoint; its current image-aware structured proposal contract already supports this flow.

- [x] **Step 3: Verify assistant and editor flows**

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx src/components/ColorGradingEditor.test.tsx`

Expected: PASS, including second-round requests based on an accepted recipe and no automatic save or export.

### Task 4: Full verification and browser review

**Files:**
- Verify: `src/components/ColorAssistantPanel.test.tsx`
- Verify: `src/components/ColorGradingEditor.test.tsx`
- Verify: `src/components/ColorGradingEditor.css`

- [x] **Step 1: Run the full test suite and production build**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build complete with exit code 0.

- [x] **Step 2: Check whitespace and inspect the final patch**

Run: `git diff --check`

Expected: no whitespace errors. Inspect the changed panel and tests to confirm the analysis action is explicit, proposal application is user-triggered, no-change acceptance never mutates the recipe, and no save/export occurs automatically.

- [x] **Step 3: Verify desktop and narrow-screen behavior**

Use `http://127.0.0.1:5173/` and a synthetic image in an isolated browser profile. Confirm the editor sends no request on open, clicking `分析图片色彩` sends only the compressed current preview, a changed proposal remains a candidate until `应用建议`, a no-change proposal can be accepted without recipe mutation, and both outcomes appear in history after reopening. Check the action layout at desktop and 390 px width. Do not use a real LLM or alter a user image recipe during verification.

---

## Self-review

- Spec coverage: explicit user-triggered image sending, current preview and recipe, conservative visual diagnosis, candidate review, one-action application, no-change acceptance, history, cancellation, model errors, no automatic save/export, and narrow-screen controls each map to a task above.
- Scope: the existing API, schema, compressor, candidate renderer, and history remain the only data path; no database migration or new endpoint is needed.
- Type consistency: request mode is local to the panel; accepted outcomes continue to use the existing `applied`, `discarded`, and `expired` history states.
- Placeholder scan: no TODO, TBD, or unspecified behavior remains; each test task names an observable assertion and command.
- Workspace constraint: keep all current uncommitted work intact; do not stage or commit changes.
