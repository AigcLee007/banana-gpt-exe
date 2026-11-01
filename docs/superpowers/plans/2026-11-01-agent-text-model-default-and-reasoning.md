# Agent Text Model Default and Reasoning Implementation Plan

> **For agentic workers:** Execute inline in this session using the approved design and this plan.

**Goal:** Make `gpt-6-astra` the default Agent text model, offer `gpt-6.1-sol` as the other choice, and send high reasoning effort on Agent text requests.

**Architecture:** Reuse `AGENT_TEXT_MODELS` as the source of truth for supported IDs, fallback normalization, and the existing selector. Add the Responses API reasoning field at the three existing Agent request builders without changing routing or image-generation parameters.

**Tech Stack:** TypeScript, React, Vitest, Vite.

---

### Task 1: Specify the new settings and request behavior in tests

**Files:**
- Modify: `src/lib/apiProfiles.test.ts`
- Modify: `src/lib/agentApi.test.ts`

- [x] **Step 1: Update model normalization assertions**

In the existing `defaults and normalizes the Agent text model` test, assert that the default is `gpt-6-astra`, `gpt-6.1-sol` is accepted, and blank, unknown, and legacy `gpt-5.6-sol` values normalize to `gpt-6-astra`.

- [x] **Step 2: Assert high reasoning effort for every Agent text request**

In the existing selected-model tests for conversation, title, and batch helper requests, parse each request body once and assert both its selected model and `reasoning` equals `{ effort: 'high' }`. Add an assertion that `DEFAULT_SETTINGS.agentTextModel` is `gpt-6-astra` to the settings test.

- [x] **Step 3: Run focused tests and confirm expected failures**

Run: `npm test -- src/lib/apiProfiles.test.ts src/lib/agentApi.test.ts`

Expected: failures show the current default remains `gpt-5.6-sol`, `gpt-6.1-sol` is rejected, and Agent request bodies omit high reasoning effort.

### Task 2: Implement the approved defaults and request parameter

**Files:**
- Modify: `src/lib/bananaModels.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Modify: `src/lib/agentApi.ts`

- [x] **Step 1: Update supported model IDs and default**

Set `AGENT_TEXT_MODELS` to `gpt-6-astra` and `gpt-6.1-sol`, in that order, and keep `AGENT_FIXED_MODEL` derived from the first entry. Update `AppSettings.agentTextModel` to the corresponding two-value union. Set the portal-managed settings default to `AGENT_FIXED_MODEL` instead of a hard-coded model ID.

- [x] **Step 2: Attach high reasoning effort to all Agent text requests**

Add `reasoning: { effort: 'high' }` to the JSON body constructed by `callAgentResponsesApi`, `callAgentConversationTitleApi`, and `callBatchImageSingle`.

- [x] **Step 3: Run focused tests**

Run: `npm test -- src/lib/apiProfiles.test.ts src/lib/agentApi.test.ts src/lib/api.test.ts`

Expected: all focused tests pass, including model routing and normalization coverage.

- [x] **Step 4: Run full verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build exit successfully.
