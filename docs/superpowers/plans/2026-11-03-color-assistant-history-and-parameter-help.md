# Color Assistant History and Parameter Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every successful AI color proposal for the source-image lineage, record whether it was applied, discarded, or expired, and explain every color control with an on-demand, accessible tooltip.

**Architecture:** Add a dedicated IndexedDB history store indexed by source image ID. Include sanitized history in gallery workspace backup/import and remove it only when cleanup removes its lineage. The assistant panel persists a pending record before presenting each candidate and updates the outcome after user action; a shared description catalog and tooltip component explain slider and custom controls.

**Tech Stack:** React 19, TypeScript, IndexedDB, Vitest, existing `useTooltip` and `ViewportTooltip` components.

---

### Task 1: History records and IndexedDB persistence

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/db.ts`
- Create: `src/lib/colorAssistantHistory.ts`
- Create: `src/lib/colorAssistantHistory.test.ts`
- Modify: `src/lib/dbConnection.test.ts`

- [x] **Step 1: Write failing tests for history record construction and outcome changes**

Test a scalar plus curve proposal against a base recipe. Assert the record contains the source ID, active image ID, instruction, explanation, clarification, timestamp, scalar before/after values, normalized curve before/after values, and `pending` outcome. Assert only `pending` records can transition to `applied`, `discarded`, or `expired`, and each transition sets `decidedAt`.

Run: `npm test -- src/lib/colorAssistantHistory.test.ts`
Expected: FAIL because the history model helpers do not exist.

- [x] **Step 2: Add the history schema and pure helpers**

Add `ColorAssistantHistoryRecord`, `ColorAssistantHistoryChange`, and `ColorAssistantHistoryCurveChange` types. Add `createColorAssistantHistoryRecord` and `decideColorAssistantHistoryRecord` in `src/lib/colorAssistantHistory.ts`; copy only the validated proposal fields and exact before/after values. Do not include images, API settings, or request/response payloads.

- [x] **Step 3: Add failing tests for IndexedDB history queries and image cleanup**

Extend the database connection test with an upgrade from version 8 and assert the new store and `sourceImageId` index are created. Add database API coverage for put, newest-first query, outcome update, deletion by source, and `clearImages` cleanup using the repository's IndexedDB test setup.

Run: `npm test -- src/lib/dbConnection.test.ts`
Expected: FAIL because schema version 9 and history APIs do not exist.

- [x] **Step 4: Implement the IndexedDB store and APIs**

Increment the database version to 9, create `colorAssistantHistory` with key path `id` and non-unique `sourceImageId` index, and add read/write APIs. Add the history store to `clearImages`. Add source-history deletion to `deleteImage` only when that source image is actually removed; retain its existing color-edit lineage protection.

- [x] **Step 5: Verify the storage tests**

Run: `npm test -- src/lib/colorAssistantHistory.test.ts src/lib/dbConnection.test.ts`
Expected: PASS, including migration from existing version 8 data.

### Task 2: Gallery backup, restore, and cleanup

**Files:**
- Modify: `src/lib/localWorkspaceData.ts`
- Modify: `src/lib/localWorkspaceData.test.ts`

- [x] **Step 1: Write failing workspace tests**

Add fixtures for two source-image lineages. Assert gallery export/import retains history and its exact decision metadata; import accepts an older v1 workspace archive with no history field; an `agent`-only export contains no color-assistant history; gallery cleanup removes history for a removed source lineage but preserves history for any lineage still referenced by retained work or drafts.

Run: `npm test -- src/lib/localWorkspaceData.test.ts`
Expected: FAIL because workspace snapshots do not yet include assistant history.

- [x] **Step 2: Add validated, gallery-scoped history to workspace snapshots**

Add `colorAssistantHistory` to `WorkspaceSnapshot` and the IndexedDB store list. Sanitize records by allowlisting fields, finite timestamps, outcome values, supported scalar paths, curve channels, and normalized point arrays. Require source and active-image references to exist in the archived image set. Keep the archive field optional when parsing so existing v1 and legacy v3 backups remain readable.

- [x] **Step 3: Scope and clean records with source-image lineage**

Include history only when `gallery` is selected. Select records by the same expanded color-edit lineage used for images. During cleanup, preserve records whose source image remains and remove only records belonging to removed gallery lineages. Keep the existing single-transaction import/cleanup behavior.

- [x] **Step 4: Verify workspace coverage**

Run: `npm test -- src/lib/localWorkspaceData.test.ts`
Expected: PASS for new round-trip, compatibility, scope, and cleanup cases plus existing atomicity tests.

### Task 3: Persistent assistant round history and state transitions

**Files:**
- Modify: `src/components/ColorAssistantPanel.tsx`
- Modify: `src/components/ColorAssistantPanel.test.tsx`
- Modify: `src/components/ColorGradingEditor.tsx`
- Modify: `src/components/ColorGradingEditor.test.tsx`
- Modify: `src/components/ColorGradingEditor.css`

- [x] **Step 1: Write failing panel tests for persistence and status changes**

Mock the history APIs and assert a successful proposal is stored as `pending` before its Apply/Discard controls appear; Apply stores `applied`, Discard stores `discarded`, recipe/image invalidation stores `expired`, history query uses the source image ID, and a database write failure reports that the round was not saved while leaving the current candidate available. Assert failed and canceled requests create no record.

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx`
Expected: FAIL because the panel does not persist history or render prior rounds.

- [x] **Step 2: Persist candidates before exposing them**

Pass `sourceImageId` from the editor. After API validation, build a pending record from the request snapshot and persist it before showing the candidate. Re-check request/image/recipe identity after the write; expire a just-written record if the request became stale. If the initial write fails, show a recoverable error and still allow an explicit in-memory Apply or Discard, with no claim that the history was saved.

- [x] **Step 3: Record decisions and render read-only history**

Apply marks the record `applied` only when the parent accepts the same image and recipe; rejected stale candidates become `expired`. Discard marks `discarded`. Manual recipe/image changes expire an unresolved candidate. Refresh and display newest-first source-lineage history in a collapsible list with request, status, explanation, scalar before/after values, curve before/after points, timestamp, active image version, and clarification. Past rounds have no apply action. Show database read/update errors and keep in-memory editing behavior intact.

- [x] **Step 4: Verify assistant round flows**

Run: `npm test -- src/components/ColorAssistantPanel.test.tsx src/components/ColorGradingEditor.test.tsx`
Expected: PASS, including a second request based on the applied recipe, no auto-apply, and no image save/export side effect.

### Task 4: Complete parameter descriptions and accessible tooltips

**Files:**
- Create: `src/lib/colorParameterHelp.ts`
- Create: `src/lib/colorParameterHelp.test.ts`
- Create: `src/components/ColorParameterHelp.tsx`
- Modify: `src/components/ColorGradingEditor.tsx`
- Modify: `src/components/ColorGradingEditor.test.tsx`
- Modify: `src/components/ColorGradingEditor.css`

- [x] **Step 1: Write failing description coverage tests**

Assert every description has a purpose and explicit higher/lower effects for exposure, contrast, tonal controls, saturation/vibrance, temperature/tint, master and RGB levels, curves, each HSL axis, each color wheel axis, color balance/blending, channel mixing, and LUT. Include specific behavior for the neutral sampler, curve points, wheel picker, LUT import/removal, and export quality control.

Run: `npm test -- src/lib/colorParameterHelp.test.ts`
Expected: FAIL because the description catalog does not exist.

- [x] **Step 2: Implement the shared description catalog and help control**

Create a typed description catalog and `ColorParameterHelp` icon button. Use `useTooltip` and `ViewportTooltip` so hover, keyboard focus, and touch activation expose the description without changing the control's accessible name or keyboard operation.

- [x] **Step 3: Attach a description to each color control and custom surface**

Make each `NumericSlider` receive a help description. Add contextual help for the neutral-point sampler, channel curve graph, wheel picker, LUT tools, and export quality. Use channel/range-specific descriptions where the effect depends on which channel or hue range is selected; group-level explanations may cover all interactions inside a custom surface.

- [x] **Step 4: Verify coverage and accessibility**

Run: `npm test -- src/lib/colorParameterHelp.test.ts src/components/ColorGradingEditor.test.tsx src/components/ViewportTooltip.test.tsx`
Expected: PASS; rendered controls retain their accessible slider labels and help buttons expose the correct tooltip text on focus and touch click.

### Task 5: Full verification and browser review

**Files:**
- Verify: `src/lib/colorAssistantHistory.test.ts`
- Verify: `src/lib/localWorkspaceData.test.ts`
- Verify: `src/components/ColorAssistantPanel.test.tsx`
- Verify: `src/components/ColorGradingEditor.test.tsx`
- Verify: `src/components/ViewportTooltip.test.tsx`

- [x] **Step 1: Run the full test suite and production build**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: TypeScript and Vite production build complete with exit code 0.

- [x] **Step 2: Check the final patch**

Run: `git diff --check`
Expected: no whitespace errors; inspect the final diff to confirm only the history/help implementation and its plan changed, while all pre-existing user edits remain present.

- [x] **Step 3: Verify browser behavior at desktop and narrow widths**

Use the running application at `http://127.0.0.1:5173/`. Verify the history list survives closing and reopening the editor and displays status and exact changes; verify a new instruction after Apply starts from the updated recipe; focus and tap a help icon at both viewport widths and confirm its tooltip remains visible and does not clip. Do not change any image recipe without an explicit test interaction.

---

## Self-review

- Spec coverage: proposal persistence, state transitions, source-lineage grouping, backups, cleanup, compatibility, detailed before/after review, non-reapplication of old records, database error handling, full parameter descriptions, and hover/focus/touch help are covered by Tasks 1–5.
- Placeholder scan: no implementation step uses TODO/TBD or delegates edge-case design to the worker; each test step names concrete cases and commands.
- Type consistency: the record uses `sourceImageId`, `activeImageId`, `changes`, `curves`, `outcome`, and timestamps consistently across IndexedDB, workspace data, and UI.
- Workspace constraint: do not commit or reset existing user changes as part of this implementation; the current checkout already contains the uncommitted editor and assistant code this feature extends.
