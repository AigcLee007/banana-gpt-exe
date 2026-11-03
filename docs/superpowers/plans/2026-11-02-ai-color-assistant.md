# AI Color Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in natural-language color assistant that proposes validated adjustments from the current compressed preview and applies them only after explicit user confirmation.

**Architecture:** Add a pure color-assistant module for strict proposal validation and recipe patching, and a dedicated Responses API function that sends one image and the current recipe through the active Agent profile. The color editor owns request state and an unapplied proposal; only Apply updates adjustments, while save and export remain independent explicit actions.

**Tech Stack:** React 19, TypeScript, OpenAI-compatible Responses API, Canvas 2D, Vitest.

---

### Task 1: Validate and apply structured color proposals

**Files:**
- Create `src/lib/colorAssistant.ts`
- Create `src/lib/colorAssistant.test.ts`
- Reuse `src/lib/colorGrading.ts`

- [x] **Step 1: Write failing tests for allowed scalar and curve patches**

Add tests that call `applyColorAssistantProposal(base, proposal)` with:

```ts
const base = createDefaultColorAdjustments()
const proposal = {
  explanation: '降低红色偏色并稍微冷却画面。',
  changes: [
    { path: 'whiteBalance.temperature', value: 5900 },
    { path: 'hsl.red.saturation', value: -12 },
  ],
  curves: [{ channel: 'blue', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.54 }, { x: 1, y: 1 }] }],
  clarification: null,
}
```

Assert the base recipe is unchanged, the returned recipe contains the three requested edits, and `changes` preserves the original values for before/after display. Add cases for duplicate paths, unknown paths, non-finite and out-of-range numbers, invalid channel names, duplicate curve channels, unsorted or duplicate-X points, and more than 64 curve points; each invalid proposal must throw without returning a partial recipe. Add a clarification-only proposal case with empty `changes` and `curves`.

- [x] **Step 2: Run the new tests and confirm the missing helper causes failure**

Run: `npx vitest run src/lib/colorAssistant.test.ts`
Expected: FAIL because `colorAssistant.ts` does not yet export `applyColorAssistantProposal`.

- [x] **Step 3: Implement the proposal types and all-or-nothing validator**

 In `src/lib/colorAssistant.ts`, export `ColorAssistantProposal`, `ColorAssistantChange`, `ColorAssistantCurve`, `COLOR_ASSISTANT_ALLOWED_PATHS`, `applyColorAssistantProposal`, and `getColorAssistantChangeLabel`. Use fixed enums for the scalar path roots and segments:

```ts
export interface ColorAssistantChange {
  path: string
  value: number
}

export interface ColorAssistantProposal {
  explanation: string
  changes: ColorAssistantChange[]
  curves: Array<{ channel: ColorChannel; points: CurvePoint[] }>
  clarification: string | null
}

export function applyColorAssistantProposal(base: ColorAdjustments, input: unknown) {
  const proposal = normalizeColorAssistantProposal(input)
  const adjustments = structuredClone(base)
  for (const change of proposal.changes) setAllowedAdjustmentPath(adjustments, change.path, change.value)
  for (const curve of proposal.curves) adjustments.curves[curve.channel] = curve.points
  return { proposal, adjustments: normalizeColorAdjustments(adjustments) }
}
```

Implement `normalizeColorAssistantProposal` to require an object with exactly `explanation`, `changes`, `curves`, and `clarification`; trim explanation and clarification to at most 500 characters each, cap changes at 48, cap curves at four and points per curve at 64, reject duplicate paths/channels, and validate every numeric value against the same ranges used by `normalizeColorAdjustments`. Accept only `master`, `red`, `green`, and `blue` curve channels. Require curves to contain 2–64 points with finite x/y values in [0, 1], unique x values, and strictly increasing x order. Call `normalizeColorAdjustments` only after every operation succeeds. Make `getColorAssistantChangeLabel` map every allowlisted path and curve channel to a Chinese UI label.

The path allowlist must cover `basic` values; `whiteBalance.temperature` and `.tint`; every `levels.{master|red|green|blue}.{inputBlack|inputWhite|gamma|outputBlack|outputWhite}` value; every `hsl.{red|orange|yellow|green|cyan|blue|purple|magenta}.{hue|saturation|luminance}` value; `colorGrading.balance`, `.blending`, and each `.shadows|midtones|highlights.{hue|saturation|luminance}` value; and each `channelMixer.{red|green|blue}.{0|1|2}` value. Do not accept `neutralGains` or LUT data.

- [x] **Step 4: Run validator tests and verify the existing recipe stays immutable**

Run: `npx vitest run src/lib/colorAssistant.test.ts`
Expected: PASS; every invalid input rejects, the input recipe remains deeply equal to its pre-call clone, and valid proposals return a normalized candidate recipe.

- [x] **Step 5: Review the validator and tests without committing**

```bash
Keep changes in the working tree. This checkout contains pre-existing uncommitted color-grading work, so do not stage or commit it as part of this plan.
```

### Task 2: Add a dedicated image-aware Responses API request

**Files:**
- Modify `src/lib/agentApi.ts`
- Modify `src/lib/agentApi.test.ts`
- Reuse `src/types.ts` and `src/lib/apiProfiles.ts`

- [x] **Step 1: Add failing request and response tests**

Add a test for `callAgentColorAssistantApi` using a mocked JSON response containing one `function_call` item named `propose_color_adjustments`, both alone and beside an allowed reasoning item. Assert the posted body uses `settings.agentTextModel`, the supplied profile URL and key, one user message with text plus `input_image`, one strict function tool, `tool_choice: { type: 'function', name: 'propose_color_adjustments' }`, no image-generation tools, and no streaming. Assert model-facing instructions define absolute target values (not deltas), every scalar control range, full-curve replacement semantics, finite normalized [0,1] coordinates, strictly increasing x values, a 2–64 point limit, and Chinese explanation text. Assert the helper returns parsed function arguments. Add rejecting cases for missing, duplicate, or wrongly named calls; assistant prose/image output; invalid JSON arguments; non-2xx API errors; pre-aborted and in-flight cancellation; and request timeout.

- [x] **Step 2: Run the focused API tests and confirm they fail first**

Run: `npx vitest run src/lib/agentApi.test.ts -t "color assistant"`
Expected: FAIL because `callAgentColorAssistantApi` is not exported.

- [x] **Step 3: Implement the isolated API call and strict function schema**

Export this signature from `src/lib/agentApi.ts`:

```ts
export async function callAgentColorAssistantApi(opts: {
  settings: AppSettings
  profile: ApiProfile
  instruction: string
  adjustments: ColorAdjustments
  previewImageDataUrl?: string
  signal?: AbortSignal
}): Promise<unknown>
```

Build one Responses API request using the existing `createHeaders`, `buildApiUrl`, `readClientDevProxyConfig`, and `shouldUseApiProxy` helpers. Include `settings.agentTextModel`, low reasoning effort, instructions to return a concise Chinese explanation and clarification, state that scalar values are absolute targets and unlisted fields remain unchanged, and list the same numeric ranges used by the validator. State that a curve replaces the entire selected channel using finite normalized [0,1] coordinates with strictly increasing x values. Explain that channelMixer paths name an output channel and indexes 0/1/2 select red/green/blue input contributions. Include the assistant-editable recipe as JSON (omit `neutralGains` and LUT contents), and the compressed preview as an `input_image` when supplied. Define the sole tool as a strict `propose_color_adjustments` function and source its path enum from `COLOR_ASSISTANT_ALLOWED_PATHS` so the API schema and local validator cannot drift. The schema must use `additionalProperties: false` at every object level and require every property: `explanation` string, `changes` array of `{ path: enum, value: number }`, `curves` array of `{ channel: enum, points: array of { x: number, y: number } }`, and `clarification` string-or-null. Reject prose and image output while accepting zero or more reasoning items alongside exactly one matching function call; parse its JSON arguments and return them as `unknown` for the validator. Reuse the existing request timeout and abort-listener cleanup pattern. Do not add tool execution or a loop.

- [x] **Step 4: Run the API tests and inspect the serialized request**

Run: `npx vitest run src/lib/agentApi.test.ts -t "color assistant"`
Expected: PASS; the request contains exactly the configured profile/model, preview input image and one strict color proposal tool; malformed and failed responses reject.

- [x] **Step 5: Review the API function and tests without committing**

```bash
Keep changes in the working tree; do not stage or commit pre-existing changes.
```

### Task 3: Build a bounded preview payload and proposal UI

**Files:**
- Create `src/lib/colorAssistantImage.ts`
- Create `src/lib/colorAssistantImage.test.ts`
- Create `src/components/ColorAssistantPanel.tsx`
- Create `src/components/ColorAssistantPanel.test.tsx`
- Modify `src/components/ColorGradingEditor.tsx`
- Modify `src/components/ColorGradingEditor.css`
- Modify `src/components/ColorGradingEditor.test.tsx`
- Modify `package.json` and `package-lock.json` to add test-only `happy-dom`

- [x] **Step 1: Write failing image-payload helper tests**

Test `createColorAssistantPreviewDataUrl(previewUrl)` with mocked `Image`, `document.createElement('canvas')`, and `canvas.toBlob`. Assert it scales the current preview so the longest edge is at most 768 pixels, requests `image/jpeg` at quality `0.82`, returns a JPEG data URL, and rejects when image loading, canvas context creation, or blob encoding fails. Include landscape, portrait, and already-small image dimensions.

- [x] **Step 2: Run the helper tests and confirm they fail first**

Run: `npx vitest run src/lib/colorAssistantImage.test.ts`
Expected: FAIL because the helper module does not yet exist.

- [x] **Step 3: Implement the image helper with guaranteed bitmap cleanup**

Export `createColorAssistantPreviewDataUrl(previewUrl: string): Promise<string>` from `src/lib/colorAssistantImage.ts`. Load only the editor's rendered preview URL, calculate a scale of `Math.min(1, 768 / Math.max(width, height))`, draw into a canvas at rounded scaled dimensions, encode with `canvas.toBlob(callback, 'image/jpeg', 0.82)`, and convert the Blob with `FileReader`. Detach the temporary image's load/error handlers after completion; do not revoke the editor-owned `previewUrl`. Reject if the result is empty or is not `image/jpeg`.

- [x] **Step 4: Add focused editor tests for the opt-in assistant states**

Keep existing SSR tests and add `happy-dom` tests using React `createRoot` and `act` for real interaction. Extract the compact request and candidate UI into `ColorAssistantPanel.tsx`. Verify an opened editor shows the instruction field, compressed-preview privacy notice and disabled-until-ready submit action, while making no request. Mock only API, image helper and renderer/database boundaries; do not mock React state transitions.

- [x] **Step 5: Add editor request state and explicit submit/cancel behavior**

In `ColorGradingEditor.tsx`, subscribe to `settings`, add controlled instruction state, `aiRequestState` (`idle | loading | error`), an `AbortController` ref, and a proposal state containing the validated proposal, candidate recipe, and a snapshot of the recipe used for the request. Add `requestAiAdjustment`: require `renderState === 'ready'`, `isRendering === false`, non-empty instruction, a current preview URL, an OpenAI-compatible Responses active profile, and a profile that passes `validateApiProfile`; compress the current `previewUrl`, call `callAgentColorAssistantApi`, validate with `applyColorAssistantProposal`, and then display the candidate without changing `adjustments`. Disable duplicate submits, allow cancellation, clear proposal state on image change/close, and keep failures recoverable without changing adjustments. Show the existing Agent configuration guidance when the profile is not usable for Responses requests.

- [x] **Step 6: Render the compact request, privacy, result, and recovery controls**

Add an AI adjustment section above the manual controls. It contains a multiline text input, submit button, cancel-while-loading button, and a short privacy notice. When a proposal exists, render its explanation, any clarification question, and each scalar/curve before-and-after value using `getColorAssistantChangeLabel`; show Apply and Discard actions. When API error text indicates image input is unsupported, retain the instruction and offer a separate explicit retry that calls the same endpoint without `previewImageDataUrl` (text plus recipe only). Do not silently retry without the image.

- [x] **Step 7: Verify helper and editor behavior**

Run: `npx vitest run src/lib/colorAssistantImage.test.ts src/components/ColorGradingEditor.test.tsx`
Expected: PASS; opening the editor makes no request, only explicit submit calls the API, the payload is bounded JPEG, and failures/cancel leave the current recipe unchanged.

- [x] **Step 8: Review preview helper and request UI without committing**

```bash
Keep changes in the working tree; do not stage or commit pre-existing changes.
```

### Task 4: Apply proposals safely and integrate undo/staleness rules

**Files:**
- Modify `src/components/ColorGradingEditor.tsx`
- Modify `src/components/ColorGradingEditor.test.tsx`

- [x] **Step 1: Add failing tests for Apply, Discard, and stale proposals**

Test real React interactions: receiving a proposal leaves the active recipe unchanged; Discard clears only the candidate; Apply commits one history entry; Undo restores the exact prior recipe; and a stale candidate cannot replace a newer recipe. Verify cancellation on manual edits, image changes and unmount. A same-recipe high-quality preview refresh must preserve in-flight requests and proposals. Assert Apply does not call save, export, or image-storage helpers.

- [x] **Step 2: Run editor interaction tests and verify the missing state behavior**

Run: `npx vitest run src/components/ColorGradingEditor.test.tsx -t "proposal"`
Expected: FAIL because proposal application and discard controls are not implemented.

- [x] **Step 3: Route all adjustment commits through one history-aware helper**

Add a `commitAdjustments(next: ColorAdjustments)` helper that pushes the current recipe to the existing undo stack once, clears redo, clears any candidate proposal, and then updates `adjustments`. Use it from `changeAdjustments`, `undo`, `redo`, `resetAll`, curve drag completion/update, manual white-balance sampling, and version loading. Keep transient curve pointer movement from adding one undo entry per pointer event by using the existing `beginCurvePointDrag` snapshot and a commit path that does not add duplicate history for the active drag.

- [x] **Step 4: Implement Apply/Discard and stale-recipe protection**

When a proposal response arrives, store a `JSON.stringify(requestAdjustments)` snapshot with the candidate. On Apply, compare it to `JSON.stringify(adjustments)`; if they differ, discard the candidate and show a stale-proposal message. Otherwise call the single history-aware commit helper with the candidate recipe and clear the proposal. Discard only clears candidate state. A new manual edit always invalidates an existing candidate. Neither action touches IndexedDB or invokes export/save methods.

- [x] **Step 5: Run focused interaction and validator tests**

Run: `npx vitest run src/lib/colorAssistant.test.ts src/lib/agentApi.test.ts src/lib/colorAssistantImage.test.ts src/components/ColorGradingEditor.test.tsx`
Expected: PASS; accepted proposals are one undoable edit, stale proposals cannot overwrite changes, and discard/failure leave current adjustments unchanged.

- [x] **Step 6: Review safe proposal application without committing**

```bash
Keep changes in the working tree; do not stage or commit pre-existing changes.
```

### Task 5: Verify the complete opt-in workflow

**Files:**
- Modify tests only if verification exposes a defect.

- [x] **Step 1: Run focused API, image payload, validation, and editor tests**

Run: `npx vitest run src/lib/colorAssistant.test.ts src/lib/agentApi.test.ts src/lib/colorAssistantImage.test.ts src/components/ColorGradingEditor.test.tsx`
Expected: all selected suites pass.

- [x] **Step 2: Run the full test suite, production build, and whitespace check**

Run: `npm test`
Expected: exit 0 with zero failed test files or tests.

Run: `npm run build`
Expected: exit 0; note any existing Vite chunk-size or Browserslist warnings without expanding scope.

Run: `git diff --check`
Expected: exit 0 with no whitespace errors.

- [x] **Step 3: Verify in browser at desktop and mobile widths**

With the development server running, open a stored generated image and an uploaded reference image in the color editor. Confirm no network request occurs before submit; submit a prompt and confirm the request contains one JPEG image no larger than 768 px on its longest edge; verify proposal values appear without changing the preview; verify Discard leaves it unchanged; verify Apply updates the preview and Undo restores it; edit manually while a proposal is visible and verify the proposal becomes unavailable; confirm save and export remain separate actions. At mobile width, confirm the input, explanation, and Apply/Discard controls fit without horizontal overflow.

- [x] **Step 4: Review privacy and non-destructive boundaries**

Review the final diff and confirm that only explicit submit sends the compressed preview, no source-resolution image or stored source blob is sent, the API call cannot invoke image-generation tools, model results cannot write to IndexedDB, and Apply changes only the in-memory recipe until a later explicit save/export.

- [x] **Step 5: Review verification-only test fixes and report results**

Do not stage or commit from this checkout, which already contains uncommitted work.
