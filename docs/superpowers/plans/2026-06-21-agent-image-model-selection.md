# Agent Image Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Agent text reasoning fixed on `gpt-5.5`, while adding an Agent-mode image model selector that can use the same Banana image models as Gallery mode.

**Architecture:** Do not import upstream Agent API profile selection wholesale. Adapt upstream's hybrid tool idea: Agent text calls remain fixed to `AGENT_FIXED_MODEL`, and image generation is delegated to app-side image generation using an Agent-specific image model setting. This preserves local Banana UI/product behavior while gaining separated text/image model execution.

**Tech Stack:** React 19, TypeScript, Zustand store, Vitest, OpenAI Responses API, existing Banana model routing in `src/lib/bananaModels.ts`, existing image API entry point `callImageApi`.

---

## Current State

- Agent text calls are fixed to `AGENT_FIXED_MODEL` in `src/lib/agentApi.ts`.
- Agent title generation is fixed to `AGENT_FIXED_MODEL`.
- Agent batch image generation currently uses `callBatchImageSingle`, which also sends `AGENT_FIXED_MODEL`.
- `InputBar` hides the model selector unless `appMode === 'gallery'`.
- `AppSettings` has Agent behavior settings, but no Agent-specific image model setting.
- Gallery mode already supports Banana model routing through `BANANA_GALLERY_MODELS` and `getBananaModelRoute`.

## Target Behavior

- Agent mode text model is always `gpt-5.5`.
- Agent mode shows a model selector in the parameter area.
- The Agent selector defaults to the current Gallery default model.
- Changing Agent image model does not change Gallery mode's selected model.
- Agent-generated image tasks record the selected image model/profile metadata.
- Single-image and batch-image Agent tool calls use the selected image model.
- Gallery mode behavior remains unchanged.

## File Responsibility Map

- `src/types.ts`
  - Add `agentImageModel` to `AppSettings`.
- `src/lib/apiProfiles.ts`
  - Normalize and default `agentImageModel`.
  - Add `normalizeAgentImageModel`.
- `src/lib/bananaModels.ts`
  - Keep `AGENT_FIXED_MODEL`.
  - Reuse existing Banana model list and routing helpers.
  - No planned change unless implementation discovers duplicate routing code that belongs beside the existing helpers.
- `src/lib/agentApi.ts`
  - Add hybrid-style `generate_image` function tool.
  - Keep text and title request body model as `AGENT_FIXED_MODEL`.
  - Make Agent tool instructions switch to custom image tools when app-side generation is used.
- `src/store.ts`
  - Build separate text profile and image settings/profile.
  - Use text profile for `callAgentResponsesApi`.
  - Use image settings/profile plus `callImageApi` for Agent image generation.
  - Preserve existing task persistence and Agent conversation updates.
- `src/components/InputBar.tsx`
  - Show Banana model selector in Agent mode.
  - Write to `settings.agentImageModel` in Agent mode.
  - Keep Gallery mode selector writing to `settings.model`.
- `src/lib/agentApi.test.ts`
  - Verify text requests stay fixed to `AGENT_FIXED_MODEL`.
  - Verify hybrid/custom image tools are exposed when Agent image model separation is active.
- `src/store.test.ts`
  - Verify Agent image generation uses the selected image model while text remains fixed.
  - Verify batch generation uses selected image model.
- Optional UI tests/manual checks
  - Validate parameter area layout on desktop and mobile.

---

## Task 1: Add Agent Image Model Setting

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Test: create `src/lib/apiProfiles.test.ts` if it does not exist; otherwise extend the existing file.

### Steps

- [ ] Add `agentImageModel: string` to `AppSettings` in `src/types.ts` next to the other Agent settings.

Expected shape:

```ts
export interface AppSettings {
  // existing fields...
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentMathFormattingPrompt: boolean
  agentWebSearch: boolean
  agentImageModel: string
  profiles: ApiProfile[]
  activeProfileId: string
  theme?: 'light' | 'dark' | 'sepia' | 'cream'
}
```

- [ ] Update `normalizeSettings` in `src/lib/apiProfiles.ts` to normalize the field through Banana model IDs.

Implementation guidance:

```ts
import { AGENT_FIXED_MODEL, DEFAULT_GALLERY_MODEL, normalizeBananaModelId, getBananaModelById } from './bananaModels'

function normalizeAgentImageModel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_GALLERY_MODEL
  const normalized = normalizeBananaModelId(value)
  return getBananaModelById(normalized) ? normalized : DEFAULT_GALLERY_MODEL
}
```

Then include:

```ts
agentImageModel: normalizeAgentImageModel(record.agentImageModel),
```

- [ ] Add `agentImageModel: DEFAULT_GALLERY_MODEL` to `DEFAULT_SETTINGS`.

- [ ] Add tests for normalization.

Suggested tests:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'

describe('normalizeSettings Agent image model', () => {
  it('defaults Agent image model to the Gallery default', () => {
    const settings = normalizeSettings({})
    expect(settings.agentImageModel).toBe('gemini-3-pro-image-preview')
  })

  it('normalizes Agent image model display aliases', () => {
    const settings = normalizeSettings({ agentImageModel: 'GPT-Image-2(VIP)' })
    expect(settings.agentImageModel).toBe('gpt-5.5')
  })

  it('falls back when Agent image model is unknown', () => {
    const settings = normalizeSettings({ agentImageModel: 'unknown-model' })
    expect(settings.agentImageModel).toBe('gemini-3-pro-image-preview')
  })

  it('keeps existing Gallery model separate from Agent image model', () => {
    const settings = normalizeSettings({
      model: 'gpt-image-2',
      agentImageModel: 'gemini-3.1-flash-image-preview',
    })
    expect(settings.model).toBe('gpt-image-2')
    expect(settings.agentImageModel).toBe('gemini-3.1-flash-image-preview')
  })
})
```

- [ ] Run focused tests.

Command:

```bash
npm test -- src/lib/apiProfiles.test.ts
```

If no dedicated test file exists yet, run the exact file created for this task.

Expected result: all tests pass.

### Review Checklist

- [ ] Old settings without `agentImageModel` migrate cleanly.
- [ ] Unknown values do not persist as broken model IDs.
- [ ] Gallery `settings.model` remains independent.

### Suggested Commit

```bash
git add src/types.ts src/lib/apiProfiles.ts src/lib/apiProfiles.test.ts
git commit -m "feat: add Agent image model setting"
```

---

## Task 2: Add Agent Image Model Selector UI

**Files:**
- Modify: `src/components/InputBar.tsx`
- Test: existing component tests if available; otherwise rely on build plus manual browser verification

### Steps

- [ ] Compute an `agentImageModel` value near the existing `galleryModel` calculation.

Implementation guidance:

```ts
const resolvedAgentImageModel = normalizeBananaModelId(settings.agentImageModel)
const agentImageModel = BANANA_GALLERY_MODELS.some((item) => item.model === resolvedAgentImageModel)
  ? resolvedAgentImageModel
  : DEFAULT_GALLERY_MODEL
const selectedImageModel = appMode === 'agent' ? agentImageModel : galleryModel
```

- [ ] Change `isGeminiGalleryModel` logic into image-model-aware logic.

Implementation guidance:

```ts
const isGeminiSelectedImageModel = isGeminiNativeModel(selectedImageModel)
const isGeminiGalleryModel = appMode === 'gallery' && isGeminiSelectedImageModel
```

Keep Gallery-only controls Gallery-only unless explicitly needed.

- [ ] Update `renderParams` so the model selector appears when `appMode === 'gallery' || appMode === 'agent'`.

Implementation guidance:

```tsx
{(appMode === 'gallery' || appMode === 'agent') && (
  <label className="flex flex-col gap-0.5">
    <span className="text-gray-400 dark:text-gray-500 ml-1">模型</span>
    <Select
      value={selectedImageModel}
      onChange={(model) => {
        const nextModel = String(model)
        const nextRoute = getBananaModelRoute(nextModel)
        const nextApiMode = nextRoute === 'openai-responses' ? 'responses' : 'images'
        if (appMode === 'agent') {
          const nextSettings = normalizeSettings({ ...settings, agentImageModel: nextModel })
          const nextParams = normalizeParamsForSettings(
            {
              ...params,
              n: 1,
            },
            normalizeSettings({ ...nextSettings, model: nextModel, apiMode: nextApiMode }),
            { hasInputImages: inputImages.length > 0 },
          )
          setSettings({ agentImageModel: nextModel })
          const patch = getChangedParams(params, nextParams)
          if (Object.keys(patch).length) setParams(patch)
          return
        }

        const nextSettings = normalizeSettings({ ...settings, model: nextModel, apiMode: nextApiMode })
        const nextParams = normalizeParamsForSettings(params, nextSettings, { hasInputImages: inputImages.length > 0 })
        setSettings({ model: nextModel, apiMode: nextApiMode })
        const patch = getChangedParams(params, nextParams)
        if (Object.keys(patch).length) setParams(patch)
      }}
      options={BANANA_GALLERY_MODELS.map((item) => ({
        label: item.displayName,
        value: item.model,
      }))}
      className={selectClass}
      menuClassName="min-w-max"
      triggerTitle={BANANA_GALLERY_MODELS.find((item) => item.model === selectedImageModel)?.displayName ?? String(selectedImageModel)}
      truncateOptionLabel={false}
    />
  </label>
)}
```

- [ ] Keep Agent quantity behavior unchanged.

Acceptance:

```ts
const agentAutoImageCount = appMode === 'agent'
```

The count input should still display auto/disabled behavior in Agent mode.

- [ ] Confirm the grid column count still looks acceptable.

Suggested adjustment:

```tsx
{renderParams(appMode === 'gallery' ? (isGeminiGalleryModel ? 'grid-cols-4' : 'grid-cols-7') : 'grid-cols-7')}
```

If the desktop layout becomes cramped, use `grid-cols-7` for Agent desktop params and keep the existing mobile two-column rendering unchanged.

- [ ] Run build.

Command:

```bash
npm run build
```

Expected result: TypeScript and Vite build pass.

### Manual Verification

- [ ] Start local app.

Command:

```bash
npm run dev
```

- [ ] Open Agent mode.
- [ ] Confirm model selector appears in the parameter area.
- [ ] Switch Agent model to `Nano Banana 2`; switch to Gallery mode; confirm Gallery model did not change unexpectedly.
- [ ] Switch Gallery model; switch back to Agent mode; confirm Agent model did not change unexpectedly.
- [ ] Confirm Agent count remains automatic.

### Review Checklist

- [ ] Agent model selector uses `settings.agentImageModel`.
- [ ] Gallery model selector still uses `settings.model`.
- [ ] No layout overlap on desktop/mobile.

### Suggested Commit

```bash
git add src/components/InputBar.tsx
git commit -m "feat: show Agent image model selector"
```

---

## Task 3: Add Custom Image Tool Definitions For Agent

**Files:**
- Modify: `src/lib/agentApi.ts`
- Test: `src/lib/agentApi.test.ts`

### Steps

- [ ] Add a `createGenerateImageFunctionTool` function based on upstream's hybrid design.

Implementation guidance:

```ts
function createGenerateImageFunctionTool() {
  return {
    type: 'function',
    name: 'generate_image',
    description: [
      'Generate one image through the app image API. Use this for single-image requests or prerequisite/base images that later images must reference.',
      'The prompt must be self-contained and include full visual style descriptions.',
      'If it refers to an existing image, include the corresponding XML tag, e.g. <ref id="round-1-image-1" />, inside the prompt so the app can attach the reference image automatically.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Short stable identifier for this image, e.g. "cover", "base_character", "scene_1".',
        },
        prompt: {
          type: 'string',
          description: 'Complete image generation prompt with all visual details. Include matching XML ref tags when referring to existing images.',
        },
      },
      required: ['id', 'prompt'],
      additionalProperties: false,
    },
    strict: true,
  }
}
```

- [ ] Update `createAgentInstructions` so Agent uses app-side image tools.

Implementation guidance:

```ts
const imageInstructions = AGENT_IMAGE_INSTRUCTIONS.replace(/image_generation/g, 'generate_image')
const instructions = [
  imageInstructions,
  '',
  '## Tool policy',
  `- Current maximum tool-use rounds for this Agent turn: ${maxToolRounds}.`,
  '- Use generate_image for single-image requests and generate_image_batch for concurrent multi-image requests. The built-in image_generation tool is not available in this session.',
  '- Call continue_generation ONLY when you have generated a prerequisite image and need another round to generate dependent images. Do NOT call it when the task is complete.',
  '- When web_search is available, use it only when current external information would improve the answer or the user asks for research/news/facts.',
  '- When the requested task is complete, stop calling tools and provide the final response.',
  ...(settings.agentMathFormattingPrompt ? ['', AGENT_MATH_FORMATTING_INSTRUCTIONS] : []),
]
```

- [ ] Update `createAgentTools` to use `generate_image` instead of built-in `image_generation` for the main Agent loop.

Implementation guidance:

```ts
function createAgentTools(params: TaskParams, profile: ApiProfile, settings: AppSettings, maskDataUrl?: string): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [createGenerateImageFunctionTool()]
  const singleImageToolInstruction = 'For single images or prerequisite/base images, use the generate_image tool instead.'

  tools.push({
    type: 'function',
    name: 'generate_image_batch',
    description: [
      'Generate multiple images concurrently. Use this ONLY when:',
      '1. There are 2+ remaining images whose prerequisites (base references) are ALL already generated.',
      '2. These images are independent of each other (none references another image in this same batch).',
      singleImageToolInstruction,
      'Each image prompt must be self-contained and include full visual style descriptions.',
      'If an image needs to match a previously generated image, include the corresponding XML tag (e.g. <ref id="round-1-image-1" />) inside that image prompt so the app can attach the reference image automatically.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          description: 'Array of images to generate concurrently.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Short stable identifier for this image, e.g. "slide_2_problem", "scene_3".',
              },
              prompt: {
                type: 'string',
                description: 'Complete image generation prompt with all visual details. If it refers to a previous image, include the matching XML tag, e.g. <ref id="round-1-image-1" />.',
              },
            },
            required: ['id', 'prompt'],
            additionalProperties: false,
          },
        },
      },
      required: ['images'],
      additionalProperties: false,
    },
    strict: true,
  })

  tools.push({
    type: 'function',
    name: 'continue_generation',
    description: [
      'Request another round to continue generating images.',
      'Call this ONLY when you have just generated a prerequisite/base image and still need to generate dependent images that reference it.',
      'Do NOT call this when the task is already complete.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief reason why another tool-use round is required.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    strict: true,
  })

  if (settings.agentWebSearch) {
    tools.push({ type: 'web_search_preview' })
  }

  return tools
}
```

Keep `createImageTool` and `callBatchImageSingle` for compatibility until store migration is complete. Do not remove them in this task.

- [ ] Keep `callAgentResponsesApi` request body model fixed.

Acceptance:

```ts
model: AGENT_FIXED_MODEL
```

- [ ] Add or update tests in `src/lib/agentApi.test.ts`.

Suggested test:

```ts
it('uses custom Agent image tools while keeping text model fixed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [] }), { status: 200 })))

  const profile = createDefaultOpenAIProfile()
  await callAgentResponsesApi({
    settings: DEFAULT_SETTINGS,
    profile,
    params: DEFAULT_PARAMS,
    input: [{ role: 'user', content: '生成一张图' }],
  })

  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(body.model).toBe(AGENT_FIXED_MODEL)
  expect(body.tools.some((tool: { name?: string }) => tool.name === 'generate_image')).toBe(true)
  expect(body.tools.some((tool: { type?: string }) => tool.type === 'image_generation')).toBe(false)
})
```

Use the repo's existing test helpers/imports for `DEFAULT_PARAMS`; if unavailable, define a minimal valid params object in the test.

- [ ] Run focused tests.

Command:

```bash
npm test -- src/lib/agentApi.test.ts
```

Expected result: all tests pass.

### Review Checklist

- [ ] Text request still uses `AGENT_FIXED_MODEL`.
- [ ] Title generation still uses `AGENT_FIXED_MODEL`.
- [ ] Main Agent loop exposes `generate_image` and `generate_image_batch`.
- [ ] Built-in `image_generation` is not exposed in main Agent loop.
- [ ] `callBatchImageSingle` remains available for compatibility until Task 4.

### Suggested Commit

```bash
git add src/lib/agentApi.ts src/lib/agentApi.test.ts
git commit -m "feat: add app-side Agent image tools"
```

---

## Task 4: Split Agent Text Profile From Image Generation Settings

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

### Steps

- [ ] Add imports needed for Agent image model routing.

Implementation guidance:

```ts
import { AGENT_FIXED_MODEL, DEFAULT_GALLERY_MODEL, getBananaModelRoute, normalizeBananaModelId } from './lib/bananaModels'
```

Keep existing imports if they already include these symbols.

- [ ] Add a helper to build image settings from `agentImageModel`.

Implementation guidance near `createFixedAgentProfile`:

```ts
function getApiModeForBananaModel(model: string): ApiMode {
  return getBananaModelRoute(model) === 'openai-responses' ? 'responses' : 'images'
}

function createAgentImageSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings)
  const imageModel = normalizeBananaModelId(normalized.agentImageModel || DEFAULT_GALLERY_MODEL)
  const imageApiMode = getApiModeForBananaModel(imageModel)
  return normalizeSettings({
    ...normalized,
    model: imageModel,
    apiMode: imageApiMode,
    profiles: normalized.profiles.map((profile) =>
      profile.id === normalized.activeProfileId
        ? {
            ...profile,
            model: imageModel,
            apiMode: imageApiMode,
          }
        : profile,
    ),
  })
}
```

If `ApiMode` is not imported in `store.ts`, import it from `src/types.ts`.

- [ ] Add a helper to call the selected image model through existing image API.

Implementation guidance inside `executeAgentRound`, after `resolveReferenceImages` is defined and before batch handling:

```ts
const imageRequestSettings = createAgentImageSettings(requestSettings)
const imageProfile = getActiveApiProfile(imageRequestSettings)

const callAgentImageApiSingle = async (opts: {
  prompt: string
  referenceImageDataUrls: string[]
  taskParams: TaskParams
  signal: AbortSignal
  maskDataUrl?: string
  onPartialImage?: (event: { image: string; partialImageIndex?: number }) => void | Promise<void>
}) => {
  const result = await callImageApi({
    settings: imageRequestSettings,
    prompt: replaceImageMentionsForApi(opts.prompt, opts.referenceImageDataUrls.length),
    params: opts.taskParams,
    inputImageDataUrls: opts.referenceImageDataUrls,
    maskDataUrl: opts.maskDataUrl,
    onPartialImage: opts.onPartialImage
      ? (partial) => {
          void opts.onPartialImage?.({ image: partial.image, partialImageIndex: partial.partialImageIndex ?? partial.requestIndex })
        }
      : undefined,
  })
  if (opts.signal.aborted) throw createAgentAbortError()
  const dataUrl = result.images[0]
  return {
    image: dataUrl ? {
      dataUrl,
      actualParams: result.actualParamsList?.[0] ?? result.actualParams,
      revisedPrompt: result.revisedPrompts?.[0] ?? opts.prompt,
    } satisfies AgentApiResultImage : null,
    error: result.failedRequests?.[0]?.error ?? (dataUrl ? null : '接口未返回图片数据'),
    rawResponsePayload: JSON.stringify({
      imageCount: result.images.length,
      actualParams: result.actualParams,
      actualParamsList: result.actualParamsList,
      revisedPrompts: result.revisedPrompts,
      rawImageUrls: result.rawImageUrls,
      failedRequests: result.failedRequests,
    }, null, 2),
  }
}
```

- [ ] Update task creation metadata in `ensureStreamingAgentTask` to use `imageProfile`.

Acceptance:

```ts
apiProvider: imageProfile.provider,
apiProfileId: imageProfile.id,
apiProfileName: imageProfile.name,
apiMode: imageProfile.apiMode,
apiModel: imageProfile.model,
```

Do not use `activeProfile` for image task metadata after this task.

- [ ] Handle `generate_image` function calls in the Agent loop.

Implementation guidance:

1. Find the loop that handles response output/function calls after `callAgentResponsesApi`.
2. Add a branch for `function_call` with `name === 'generate_image'`.
3. Parse the function arguments as JSON.
4. Extract `id` and `prompt`.
5. Resolve reference IDs with existing `extractAgentReferenceIds` and `resolveReferenceImages`.
6. Create or reuse a streaming task with the function call ID.
7. Call `callAgentImageApiSingle`.
8. Complete or fail the task.
9. Return function call output JSON back into the next Agent input, matching the existing pattern used by `generate_image_batch`.

Expected function-call output shape:

```ts
JSON.stringify({
  id,
  image: result.image ? {
    status: 'done',
    ref_id: getAgentGeneratedImageReferenceId(round, imageIndex),
  } : {
    status: 'failed',
    error: result.error ?? '接口未返回图片数据',
  },
})
```

Use the same function-call continuation format already used for `generate_image_batch`: append an output item that includes the original function call id/call id and a JSON string result. Keep the exact field names already used in `store.ts` so previous Responses API turns remain compatible.

- [ ] Replace Agent batch image execution from `callBatchImageSingle` to `callAgentImageApiSingle`.

Existing call:

```ts
const batchResult = await callBatchImageSingle({
  profile: activeProfile,
  params,
  batchItemId: item.id,
  prompt: item.prompt,
  referenceImageDataUrls: references.dataUrls,
  referenceIds,
  signal: controller.signal,
  onImageToolStarted: shouldStreamAssistantMessage
    ? async () => {
        if (controller.signal.aborted) return
      }
    : undefined,
  onPartialImage: shouldStreamAssistantMessage
    ? async ({ image, partialImageIndex }) => {
        if (controller.signal.aborted) return
        const taskId = taskIdByToolCallId.get(batchToolCallId)
        if (taskId) {
          useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
          if (partialImageIndex === 0 || partialImageIndex == null) {
            void persistTaskStreamPartialImage(taskId, image)
          }
        }
      }
    : undefined,
})
```

Target structure:

```ts
const taskParams = { ...params, n: 1 }
const batchResult = {
  batchItemId: item.id,
  ...(await callAgentImageApiSingle({
    prompt: item.prompt,
    referenceImageDataUrls: references.dataUrls,
    taskParams,
    signal: controller.signal,
    onPartialImage: async ({ image, partialImageIndex }) => {
      if (controller.signal.aborted) return
      const taskId = taskIdByToolCallId.get(batchToolCallId)
      if (taskId) {
        useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
        if (partialImageIndex === 0 || partialImageIndex == null) {
          void persistTaskStreamPartialImage(taskId, image)
        }
      }
    },
  })),
}
```

- [ ] Keep `callAgentResponsesApi` using `activeProfile`.

Acceptance:

```ts
const result = await callAgentResponsesApi({
  settings: requestSettings,
  profile: activeProfile,
  params,
  input: apiInputForTurn,
  maskDataUrl,
  signal: controller.signal,
  onTextDelta,
  onOutputItems,
  onImageToolStarted,
  onImagePartialImage,
  onImageToolCompleted,
  onImageToolFailed,
})
```

`activeProfile` must remain `createFixedAgentProfile(...)`.

- [ ] Update `submitAgentMessage` and `regenerateAgentAssistantMessage` only if they need to pass image settings/profile.

Keep their signatures unchanged and derive image settings inside `executeAgentRound`.

- [ ] Add store tests.

Suggested tests:

```ts
it('keeps Agent text on fixed model while image tasks use selected Agent image model', async () => {
  const state = useStore.getState()
  state.setSettings({
    apiKey: 'test-key',
    model: 'gpt-image-2',
    apiMode: 'images',
    agentImageModel: 'gemini-3.1-flash-image-preview',
  })
  state.setAppMode('agent')
  state.setPrompt('生成一张海报')

  vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (options) => {
    expect(options.profile.model).toBe(AGENT_FIXED_MODEL)
    return {
      text: '',
      images: [],
      output: [{
        type: 'function_call',
        id: 'fc_single',
        call_id: 'call_single',
        name: 'generate_image',
        arguments: JSON.stringify({ id: 'poster', prompt: '一张海报' }),
      }],
    }
  }).mockResolvedValueOnce({
    text: '完成',
    images: [],
    output: [],
  })

  vi.mocked(callImageApi).mockResolvedValueOnce({
    images: ['data:image/png;base64,abc'],
    actualParams: { model: 'gemini-3.1-flash-image-preview' },
  } as Awaited<ReturnType<typeof callImageApi>>)

  await submitAgentMessage()
  await waitForAgentRoundToFinish()

  expect(callImageApi).toHaveBeenCalled()
  const imageSettings = vi.mocked(callImageApi).mock.calls[0][0].settings
  expect(imageSettings.model).toBe('gemini-3.1-flash-image-preview')
  expect(imageSettings.apiMode).toBe('images')
})
```

Use existing store test utilities for waiting; if there is no helper named `waitForAgentRoundToFinish`, follow the existing polling pattern in `src/store.test.ts`.

Add a second test for batch:

```ts
it('uses selected Agent image model for generate_image_batch', async () => {
  // Arrange settings.agentImageModel = 'gpt-image-2'
  // Mock callAgentResponsesApi to return generate_image_batch with two images.
  // Mock callImageApi twice.
  // Assert every callImageApi settings.model is 'gpt-image-2'.
  // Assert callBatchImageSingle is not called.
})
```

- [ ] Run focused tests.

Command:

```bash
npm test -- src/store.test.ts
```

Expected result: all tests pass.

### Review Checklist

- [ ] Text model is fixed to `gpt-5.5`.
- [ ] Image generation uses `settings.agentImageModel`.
- [ ] Single and batch Agent image generation both use `callImageApi`.
- [ ] Task metadata records selected image model.
- [ ] Reference image tags still resolve.
- [ ] Abort behavior still stops running rounds.
- [ ] Existing Gallery `submitTask` path is untouched.

### Suggested Commit

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat: route Agent images through selected model"
```

---

## Task 5: Clean Up Compatibility Paths And Tests

**Files:**
- Modify: `src/lib/agentApi.ts`
- Modify: `src/lib/agentApi.test.ts`
- Modify: `src/store.test.ts`

### Steps

- [ ] Decide whether `callBatchImageSingle` remains needed.

Keep it if:

- Existing tests still cover built-in image generation parsing.
- It is useful as a fallback for Responses-native models.
- Removing it causes too much churn.

Remove it only if:

- Store no longer imports it.
- No tests depend on it.
- `agentApi.ts` remains simpler after removal.

For this upgrade, keep `callBatchImageSingle` exported but unused by Agent store to reduce risk.

- [ ] If store no longer uses `callBatchImageSingle`, remove the import from `src/store.ts`.

Expected import change:

```ts
import { callAgentConversationTitleApi, callAgentResponsesApi, parseBatchImageCallArguments, type AgentApiResultImage, type BatchImageCallResult } from './lib/agentApi'
```

If `BatchImageCallResult` becomes unused too, remove that type import.

- [ ] Update tests that assumed built-in `image_generation` in main Agent loop.

Expected changes:

- Tests for fixed text model still expect `body.model === AGENT_FIXED_MODEL`.
- Tests for tools should expect `generate_image` and `generate_image_batch`.
- Tests for built-in image_generation should be scoped to `callBatchImageSingle` if kept.

- [ ] Run all tests.

Command:

```bash
npm test
```

Expected result: all tests pass.

- [ ] Run production build.

Command:

```bash
npm run build
```

Expected result: TypeScript and Vite build pass.

### Review Checklist

- [ ] No unused imports.
- [ ] No unreachable Agent image path remains.
- [ ] Test expectations match new custom-tool architecture.
- [ ] Compatibility exports are intentionally kept or intentionally removed.

### Suggested Commit

```bash
git add src/lib/agentApi.ts src/lib/agentApi.test.ts src/store.ts src/store.test.ts
git commit -m "test: cover separated Agent image model flow"
```

---

## Task 6: Manual End-To-End Verification

**Files:**
- No required source changes unless bugs are found.

### Steps

- [ ] Start dev server.

Command:

```bash
npm run dev
```

- [ ] Open the local app in browser.

Expected default Vite URL:

```text
http://localhost:5173
```

- [ ] Verify Gallery mode baseline.

Checklist:

- Select `Nano Banana Pro`.
- Generate one normal image.
- Confirm the selected model still appears in Gallery after generation.
- Switch to Agent and back; Gallery selection remains unchanged.

- [ ] Verify Agent model selector.

Checklist:

- Switch to Agent mode.
- Confirm model selector appears in parameter area.
- Select `Nano Banana 2`.
- Submit: `生成 1 张赛博朋克风格海报`.
- Confirm generation succeeds.
- Confirm generated task details/raw params show `gemini-3.1-flash-image-preview`.

- [ ] Verify Agent batch generation.

Prompt:

```text
生成 3 张不同风格的产品海报，分别是极简、科技、国潮。
```

Expected:

- Agent creates multiple image tasks.
- Tasks run concurrently or near-concurrently.
- All image requests use the selected Agent image model.
- Final Agent response completes normally.

- [ ] Verify Agent reference image flow.

Checklist:

- Upload or attach a reference image.
- Ask Agent to generate a variation based on it.
- Confirm the selected Agent image model receives reference images.
- Confirm no broken `<ref>` tags appear in final user-facing message.

- [ ] Verify model switching.

Checklist:

- Agent selected model: `GPT-Image-2`.
- Gallery selected model: `Nano Banana Pro`.
- Switch between modes.
- Confirm each mode preserves its own model.

- [ ] Verify failure handling.

Checklist:

- Temporarily use an invalid API key or blocked model route.
- Submit Agent image request.
- Confirm task card fails visibly.
- Confirm Agent round reports a clear failure message.
- Restore valid key.

### Review Checklist

- [ ] UI works on desktop width.
- [ ] UI works on mobile width.
- [ ] Agent count remains automatic.
- [ ] No console runtime errors.
- [ ] No regression in Gallery generation.

### Suggested Commit

If manual verification only finds no code changes, no commit is required.

If fixes are needed:

```bash
git add src/components/InputBar.tsx src/store.ts src/lib/agentApi.ts src/store.test.ts src/lib/agentApi.test.ts
git commit -m "fix: polish Agent image model selection"
```

---

## Task 7: Documentation And Release Notes

**Files:**
- Modify: `docs/release-template.md` if this feature should be added as a recurring release note item.
- Create: `docs/releases/v0.4.7-banana.1.md` during the actual release if that is the next release version; use the actual version from `package.json`.

### Steps

- [ ] Add a release note bullet when implementation is complete.

Suggested wording:

```md
- Agent mode now has an independent image model selector. Text planning remains fixed on `gpt-5.5`, while image generation can use Nano Banana / GPT-Image models from the parameter area.
```

- [ ] Add tester notes.

Suggested wording:

```md
Test focus:
- Agent text requests still use `gpt-5.5`.
- The Agent parameter-area image model is used for both single-image and batch-image generation.
- Gallery and Agent model selections do not overwrite each other.
```

- [ ] Commit docs only after implementation is verified.

Suggested commit:

```bash
git add docs/release-template.md docs/releases/v0.4.7-banana.1.md
git commit -m "docs: document Agent image model selection"
```

---

## Subagent Execution Strategy

Use one implementation subagent per task, in order. Do not run implementation tasks in parallel because several tasks touch `src/store.ts`, `src/lib/agentApi.ts`, and tests.

For each task:

1. Dispatch implementer with only that task's text and relevant current findings.
2. Require focused tests before DONE.
3. Dispatch spec reviewer.
4. Dispatch code quality reviewer.
5. Fix and re-review until both pass.
6. Move to next task.

Recommended model strength:

- Task 1: fast/standard model.
- Task 2: standard model because UI layout and settings interaction need judgment.
- Task 3: standard model.
- Task 4: strongest available model because it touches the Agent execution loop.
- Task 5: standard model.
- Task 6: controller/manual verification.
- Task 7: fast model.

---

## Final Verification Commands

Run before merging:

```bash
npm test
npm run build
```

Optional local app check:

```bash
npm run dev
```

---

## Suggested Commit Grouping

If keeping history compact, combine task commits into two final commits:

1. `feat: add Agent image model selection`
   - Tasks 1-4.
2. `test: verify separated Agent image model flow`
   - Tasks 5-7 plus docs.

If using subagent-driven execution, per-task commits are also acceptable and easier to review.

---

## Known Risks

- Agent single-image custom function handling is the riskiest part because the current code already handles built-in `image_generation` output and batch custom calls, but may not yet handle a custom single-image call.
- Some image models may treat reference images or masks differently. Reusing `callImageApi` should minimize this, but manual checks are required.
- Streaming partial images may differ by provider. The implementation should pass through `onPartialImage` but must tolerate providers that do not stream.
- If `agentImageModel` selects an `openai-responses` route, `callImageApi` must still resolve to the existing OpenAI-compatible Responses image path. Verify this specifically with `GPT-Image-2(VIP)`.

## Non-Goals

- Do not expose Agent text model selection.
- Do not add upstream's `agentApiConfigMode`, `agentTextProfileId`, or `agentImageProfileId` UI.
- Do not change Gallery mode model behavior.
- Do not remove custom provider support.
- Do not change API key/balance query behavior.
