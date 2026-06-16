# Agent Upstream Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the upstream `CookSleep/gpt_image_playground` Agent fixes from `upstream/main` into this Banana/Aittco fork while preserving local model routing, Gemini support, transparent background workflow, desktop/PWA support, and current UI customizations.

**Architecture:** Do not merge `upstream/main` wholesale. Apply a small Agent-focused patch set around the Responses stream parser, Agent task synchronization, and optional math rendering preference. Keep local `AGENT_FIXED_MODEL` behavior as the source of truth for Agent requests and avoid replacing local `store.ts`, `SettingsModal.tsx`, or `apiProfiles.ts` with upstream versions.

**Tech Stack:** React 19, Vite 6, TypeScript, Zustand, Vitest, Streamdown, OpenAI Responses API image-generation tools, local IndexedDB persistence.

---

## Scope And Guardrails

Implement these upstream Agent changes:

- Avoid duplicated assistant message output items when `response.completed` omits item ids.
- Surface failed built-in `image_generation_call` items through an Agent API failure callback.
- Mark failed Agent image tasks as `error` while allowing the Agent text stream to continue.
- Add streaming format and unsupported-streaming hints used by the Agent parser.
- Add optional Agent math formatting instructions and Streamdown math rendering.

Do not implement these upstream non-Agent features in this upgrade:

- Favorite collections.
- Task completion browser notifications.
- Default-config-only deployment mode.
- Full README/release note replacement.
- Upstream UI layout rewrites unrelated to Agent behavior.

Preserve these local fork behaviors:

- `src/lib/agentApi.ts` must continue sending `model: AGENT_FIXED_MODEL` for Agent chat, Agent title generation, and `callBatchImageSingle`.
- `src/lib/apiProfiles.ts` must continue using Banana/Aittco defaults from `src/lib/bananaModels.ts`.
- Gemini gallery sizing from `src/lib/geminiImageSizing.ts` must remain intact.
- Transparent background task fields and storage flow must remain intact.
- Electron desktop scripts and PWA files must remain intact.

## File Map

- Modify: `src/lib/imageApiShared.ts`  
  Adds streaming hint helpers shared by Agent and gallery API parsing.

- Modify: `src/lib/agentApi.ts`  
  Ports upstream Agent stream parsing fixes and failure callback support while preserving `AGENT_FIXED_MODEL`.

- Modify: `src/lib/agentApi.test.ts`  
  Adds parser regression tests for failed image tool items, duplicate assistant item prevention, math prompt injection, and fixed Agent model routing.

- Modify: `src/store.ts`  
  Wires `onImageToolFailed` into `executeAgentRound`, marks corresponding Agent image tasks as failed, and marks failed batch image tasks as failed.

- Modify: `src/store.test.ts`  
  Adds store-level regression tests for failed built-in image tools and batch image failures.

- Modify: `src/types.ts`  
  Adds `agentMathFormattingPrompt` to `AppSettings`.

- Modify: `src/lib/apiProfiles.ts`  
  Normalizes and defaults `agentMathFormattingPrompt`.

- Modify: `src/components/SettingsModal.tsx`  
  Adds a small Agent settings toggle using the existing settings UI style.

- Modify: `src/components/MarkdownRenderer.tsx`  
  Loads `@streamdown/math` when modern Streamdown is available and enables single-dollar inline math.

- Modify: `package.json`, `package-lock.json`  
  Adds `@streamdown/math` and `katex`.

---

### Task 1: Prepare Upgrade Branch And Baseline

**Files:**
- Read: `package.json`
- Read: `src/lib/agentApi.ts`
- Read: `src/store.ts`
- Read: `src/lib/apiProfiles.ts`
- Read: `src/components/MarkdownRenderer.tsx`

- [ ] **Step 1: Confirm current working tree**

Run:

```powershell
git status --short --branch
```

Expected: branch is `main`; only known untracked runtime logs such as `dev-server.log` and `mock-api.log` may appear.

- [ ] **Step 2: Fetch upstream references**

Run:

```powershell
git fetch upstream --prune
```

Expected: `upstream/main` resolves to the latest upstream commit.

- [ ] **Step 3: Create the upgrade branch**

Run:

```powershell
git switch -c codex/agent-upstream-v0.6.6
```

Expected: switched to new branch `codex/agent-upstream-v0.6.6`.

- [ ] **Step 4: Run the current focused baseline tests**

Run:

```powershell
npm test -- src/lib/agentApi.test.ts src/store.test.ts src/lib/apiProfiles.test.ts src/lib/api.test.ts
```

Expected: PASS before making code changes. If unrelated existing tests fail, capture the failing test names and stop this upgrade until the baseline is understood.

- [ ] **Step 5: Record upstream Agent patch references**

Run:

```powershell
git log --oneline --decorate --regexp-ignore-case --grep='agent\|response\|stream\|math\|image_generation\|failed\|partial' 626b3d34e4fe92506036710a68fa45b2027e4958..upstream/main
```

Expected: includes these upstream commits:

```text
8fb2285 fix(agent): avoid duplicating assistant message when response.completed lacks item id
af91506 fix: sync failed agent image tasks
c76f59d fix: preserve partial image generation failures
20804c7 feat: add Agent math rendering preference
e721f81 release: v0.6.1，优化流式传输兼容性
```

No commit is needed for this setup task.

---

### Task 2: Add Streaming Hint Helpers

**Files:**
- Modify: `src/lib/imageApiShared.ts`
- Create: `src/lib/imageApiShared.test.ts`

- [ ] **Step 1: Write failing tests for streaming hints**

Create `src/lib/imageApiShared.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import {
  STREAMING_FORMAT_HINT,
  STREAMING_UNSUPPORTED_HINT,
  appendStreamingFormatHint,
  appendStreamingUnsupportedHint,
  maybeAppendStreamingHint,
} from './imageApiShared'

describe('streaming hint helpers', () => {
  it('appends an unsupported streaming hint to client-side compatibility errors', () => {
    expect(appendStreamingUnsupportedHint('bad stream')).toBe(`bad stream\n${STREAMING_UNSUPPORTED_HINT}`)
    expect(appendStreamingUnsupportedHint('')).toBe(STREAMING_UNSUPPORTED_HINT)
  })

  it('appends an invalid streaming format hint to malformed SSE payloads', () => {
    expect(appendStreamingFormatHint('not-json')).toBe(`not-json\n${STREAMING_FORMAT_HINT}`)
    expect(appendStreamingFormatHint('')).toBe(STREAMING_FORMAT_HINT)
  })

  it('only adds unsupported streaming hints for non-auth non-server HTTP errors', () => {
    expect(maybeAppendStreamingHint('bad request', 400, true)).toBe(`bad request\n${STREAMING_UNSUPPORTED_HINT}`)
    expect(maybeAppendStreamingHint('unauthorized', 401, true)).toBe('unauthorized')
    expect(maybeAppendStreamingHint('server error', 500, true)).toBe('server error')
    expect(maybeAppendStreamingHint('bad request', 400, false)).toBe('bad request')
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npm test -- src/lib/imageApiShared.test.ts
```

Expected: FAIL because `STREAMING_FORMAT_HINT`, `STREAMING_UNSUPPORTED_HINT`, `appendStreamingFormatHint`, `appendStreamingUnsupportedHint`, and `maybeAppendStreamingHint` are not exported yet.

- [ ] **Step 3: Add streaming hint helpers**

In `src/lib/imageApiShared.ts`, insert after `IMAGE_FETCH_CORS_HINT`:

```ts
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

/** Avoid adding streaming hints to clear auth, rate-limit, timeout, or server-side errors. */
export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500) {
    return message
  }
  return appendStreamingUnsupportedHint(message)
}
```

- [ ] **Step 4: Run the helper test**

Run:

```powershell
npm test -- src/lib/imageApiShared.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the helper**

Run:

```powershell
git add src/lib/imageApiShared.ts src/lib/imageApiShared.test.ts
git commit -m "fix: add streaming compatibility hints"
```

Expected: commit succeeds.

---

### Task 3: Port Agent Stream Parser Fixes

**Files:**
- Modify: `src/lib/agentApi.ts`
- Modify: `src/lib/agentApi.test.ts`

- [ ] **Step 1: Add failing Agent parser tests**

Append these tests inside the existing `describe('callAgentResponsesApi', () => { ... })` block in `src/lib/agentApi.test.ts`:

```ts
  it('reports failed image output item without aborting the ongoing stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: '已跳过失败图片',
      images: [],
    })
    expect(result.rawResponsePayload).toContain('resp_1')
  })

  it('does not duplicate the assistant message item when response.completed lacks an item id', async () => {
    const itemId = 'msg_abc123'
    const streamBody = [
      `data: {"type":"response.created","response":{"id":"resp_1","output":[]}}`,
      '',
      `data: {"type":"response.output_item.added","item":{"id":"${itemId}","type":"message","status":"in_progress","content":[],"role":"assistant"}}`,
      '',
      `data: {"type":"response.output_text.delta","delta":"hi","item_id":"${itemId}"}`,
      '',
      `data: {"type":"response.output_text.delta","delta":"!","item_id":"${itemId}"}`,
      '',
      `data: {"type":"response.output_item.done","item":{"id":"${itemId}","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"}}`,
      '',
      `data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const outputItemSnapshots: number[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      onOutputItems: (items) => outputItemSnapshots.push(items.length),
    })

    const messageItems = (result.outputItems ?? []).filter((item) => item.type === 'message')
    expect(messageItems).toHaveLength(1)
    expect(result.text).toBe('hi!')
    expect(outputItemSnapshots[outputItemSnapshots.length - 1]).toBe(1)
  })

  it('keeps Banana Agent requests on the fixed Agent model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'user-selected-gallery-model',
    })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, model: 'settings-gallery-model' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('gpt-5.5')
  })
```

- [ ] **Step 2: Run the Agent parser tests and verify they fail**

Run:

```powershell
npm test -- src/lib/agentApi.test.ts
```

Expected: FAIL because `onImageToolFailed` does not exist and the duplicate item merge still appends the id-less completed message.

- [ ] **Step 3: Update Agent API imports and result types**

In `src/lib/agentApi.ts`, replace the `imageApiShared` import with:

```ts
import { appendStreamingFormatHint, getApiErrorMessage, maybeAppendStreamingHint, MIME_MAP, normalizeBase64Image, pickActualParams } from './imageApiShared'
```

Add this interface after `AgentApiResultImage`:

```ts
export interface AgentApiImageToolFailure {
  toolCallId: string
  error: string
}
```

- [ ] **Step 4: Add failed image output parsing helpers**

In `src/lib/agentApi.ts`, insert after `getStreamEventErrorMessage`:

```ts
function getErrorMessageFromValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecordValue(value)) return null

  return getStringValue(value, 'message')
    ?? getStringValue(value, 'code')
    ?? null
}

function getImageToolFailureFromOutputItem(event: Record<string, unknown>, item?: ResponsesOutputItem): AgentApiImageToolFailure | null {
  if (item?.type !== 'image_generation_call' || item.status !== 'failed') return null

  const toolCallId = (typeof item.id === 'string' && item.id)
    || getStringValue(event, 'item_id')
  if (!toolCallId) return null

  const itemRecord = item as Record<string, unknown>
  const error = getErrorMessageFromValue(itemRecord.error)
    ?? getErrorMessageFromValue(event.error)
    ?? getStringValue(event, 'message')
    ?? '内置 image_generation 工具调用失败'

  return {
    toolCallId,
    error,
  }
}
```

- [ ] **Step 5: Make SSE parsing fail with streaming format hints**

In `readJsonServerSentEvents`, add a `hasDataLine` flag and use `appendStreamingFormatHint`:

```ts
  let hasDataLine = false
```

Inside `processBlock`, before parsing data:

```ts
    if (block.split(/\r?\n/).some((line) => line.startsWith('data:'))) hasDataLine = true
```

Replace the JSON parse error throw with:

```ts
      throw new Error(appendStreamingFormatHint(data))
```

After processing the final buffer and before leaving the `try` block, add:

```ts
    if (!hasDataLine) throw new Error(appendStreamingFormatHint('未从流式响应中解析到有效的 data 事件'))
```

- [ ] **Step 6: Merge output items by id, output index, or unique type**

Replace `publishOutputItems` in `parseAgentStreamResponse` with:

```ts
  const publishOutputItems = (items: ResponsesOutputItem[], outputIndices?: Array<number | undefined>) => {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      const outputIndex = outputIndices?.[i]
      let index = item.id ? outputItems.findIndex((existing) => existing.id === item.id) : -1

      if (index < 0 && !item.id && typeof outputIndex === 'number' && outputIndex >= 0 && outputIndex < outputItems.length) {
        const candidate = outputItems[outputIndex]
        if (candidate?.type === item.type) index = outputIndex
      }

      if (index < 0 && !item.id && item.type) {
        const sameTypeIndices = outputItems
          .map((existing, idx) => existing.type === item.type ? idx : -1)
          .filter((idx) => idx >= 0)
        if (sameTypeIndices.length === 1) index = sameTypeIndices[0]
      }

      if (index >= 0) outputItems[index] = item
      else outputItems.push(item)
    }
    onOutputItems?.([...outputItems])
  }
```

When publishing `payload.output`, replace:

```ts
      publishOutputItems(payload.output)
```

with:

```ts
      const indices = type === 'response.completed' ? payload.output.map((_, idx) => idx) : undefined
      publishOutputItems(payload.output, indices)
```

- [ ] **Step 7: Add and pass `onImageToolFailed`**

Update `parseAgentStreamResponse` parameters:

```ts
  onImageToolCompleted?: (image: AgentApiResultImage) => void | Promise<void>,
  onImageToolFailed?: (event: AgentApiImageToolFailure) => void | Promise<void>,
```

In the `response.output_item.done` block, add failure handling before image extraction:

```ts
      const imageFailure = getImageToolFailureFromOutputItem(event, item)
      if (imageFailure) {
        await onImageToolFailed?.(imageFailure)
        return
      }
```

Update `callAgentResponsesApi` options:

```ts
  onImageToolFailed?: (event: AgentApiImageToolFailure) => void | Promise<void>
```

Update the destructuring:

```ts
  const { settings, profile, params, input, maskDataUrl, signal, onTextDelta, onOutputItems, onImageToolStarted, onImagePartialImage, onImageToolCompleted, onImageToolFailed } = opts
```

Update the streaming call:

```ts
      return parseAgentStreamResponse(response, mime, controller.signal, signal, onTextDelta, onOutputItems, onImageToolStarted, onImagePartialImage, onImageToolCompleted, onImageToolFailed)
```

- [ ] **Step 8: Add HTTP streaming compatibility hint**

In `callAgentResponsesApi`, replace:

```ts
      throw new Error(await getApiErrorMessage(response))
```

with:

```ts
      const errorMessage = await getApiErrorMessage(response)
      throw new Error(maybeAppendStreamingHint(errorMessage, response.status, profile.streamImages))
```

In `callBatchImageSingle`, replace:

```ts
      return { batchItemId, image: null, error: errorMsg }
```

with:

```ts
      return { batchItemId, image: null, error: maybeAppendStreamingHint(errorMsg, response.status, profile.streamImages) }
```

Keep all three Agent request bodies using:

```ts
model: AGENT_FIXED_MODEL
```

- [ ] **Step 9: Run Agent parser tests**

Run:

```powershell
npm test -- src/lib/agentApi.test.ts src/lib/imageApiShared.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Agent parser fixes**

Run:

```powershell
git add src/lib/agentApi.ts src/lib/agentApi.test.ts src/lib/imageApiShared.ts src/lib/imageApiShared.test.ts
git commit -m "fix(agent): handle failed image stream items"
```

Expected: commit succeeds.

---

### Task 4: Sync Failed Agent Image Tasks In Store

**Files:**
- Modify: `src/store.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Add a failing store test for failed built-in image tools**

Append this test block to `src/store.test.ts` after the existing Agent context tests:

```ts
describe('agent built-in image tool failure', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
    streamImages: true,
  })

  beforeEach(async () => {
    await clearImages()
    await clearAgentConversations()
    vi.mocked(callAgentResponsesApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '生成一张图',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
  })

  it('marks a failed built-in image task as error while the Agent stream continues', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      await opts.onImageToolFailed?.({ toolCallId: 'ig-fail', error: 'safety rejected' })
      opts.onTextDelta?.('图片失败，但回复继续。')
      return {
        text: '图片失败，但回复继续。',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '图片失败，但回复继续。' }] }],
        responseId: 'response-continued',
      }
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'safety rejected',
      sourceMode: 'agent',
      agentToolCallId: 'ig-fail',
    })
    expect(failedTask.streamPartialImageIds?.length).toBeGreaterThan(0)
    expect(state.agentConversations[0].messages.some((message) =>
      message.role === 'assistant' && message.content.includes('图片失败，但回复继续。'),
    )).toBe(true)
    expect(state.agentConversations[0].rounds[0]).toMatchObject({
      status: 'done',
      responseId: 'response-continued',
      outputTaskIds: [failedTask.id],
    })
  })
})
```

- [ ] **Step 2: Run the store test and verify it fails**

Run:

```powershell
npm test -- src/store.test.ts
```

Expected: FAIL because the mocked `onImageToolFailed` callback is not wired through `executeAgentRound`.

- [ ] **Step 3: Add `failAgentImageTask` to `executeAgentRound`**

In `src/store.ts`, inside `executeAgentRound`, insert this helper immediately after `completeAgentImageTask`:

```ts
    const failAgentImageTask = (toolCallId: string, error: string, rawResponsePayload?: string) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId) return
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return

      useStore.getState().setTaskStreamPreview(taskId)
      updateTaskInStore(taskId, {
        status: 'error',
        error,
        rawResponsePayload,
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - latestTask.createdAt,
      })
    }
```

- [ ] **Step 4: Wire failed built-in image tool callback**

In the `callAgentResponsesApi` options inside `executeAgentRound`, add after `onImageToolCompleted`:

```ts
        onImageToolFailed: shouldStreamAssistantMessage
          ? async ({ toolCallId, error }) => {
              if (controller.signal.aborted) return
              await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              failAgentImageTask(toolCallId, error)
            }
          : undefined,
```

- [ ] **Step 5: Mark failed batch image tasks as failed**

In `executeBatchFunctionCall`, after each fulfilled batch result is read, add:

```ts
          if (!r.image) {
            failAgentImageTask(batchExecutionItems[i].batchToolCallId, r.error ?? '接口未返回图片数据', r.rawResponsePayload)
          }
```

In the rejected branch, before pushing `outputImages`, add:

```ts
          failAgentImageTask(batchExecutionItems[i].batchToolCallId, error)
```

The fulfilled branch should look like:

```ts
        if (settled.status === 'fulfilled') {
          const r = settled.value
          if (!r.image) {
            failAgentImageTask(batchExecutionItems[i].batchToolCallId, r.error ?? '接口未返回图片数据', r.rawResponsePayload)
          }
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? 'done' : 'error',
            ...(r.error ? { error: r.error } : {}),
          })
        } else {
          const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
          failAgentImageTask(batchExecutionItems[i].batchToolCallId, error)
          outputImages.push({
            id: batchItem.id,
            status: 'error',
            error,
          })
        }
```

- [ ] **Step 6: Run the Agent store test**

Run:

```powershell
npm test -- src/store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run focused Agent parser and store tests together**

Run:

```powershell
npm test -- src/lib/agentApi.test.ts src/store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit store failure sync**

Run:

```powershell
git add src/store.ts src/store.test.ts
git commit -m "fix(agent): sync failed image tool tasks"
```

Expected: commit succeeds.

---

### Task 5: Add Agent Math Formatting Preference

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/types.ts`
- Modify: `src/lib/apiProfiles.ts`
- Modify: `src/lib/apiProfiles.test.ts`
- Modify: `src/lib/agentApi.ts`
- Modify: `src/lib/agentApi.test.ts`
- Modify: `src/components/MarkdownRenderer.tsx`
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Install math rendering dependencies**

Run:

```powershell
npm install @streamdown/math@^1.0.2 katex@^0.16.47
```

Expected: `package.json` and `package-lock.json` include `@streamdown/math` and `katex`.

- [ ] **Step 2: Add failing tests for settings normalization and Agent instructions**

In `src/lib/apiProfiles.test.ts`, add:

```ts
  it('enables Agent math formatting prompt by default', () => {
    expect(DEFAULT_SETTINGS.agentMathFormattingPrompt).toBe(true)
    expect(normalizeSettings({ agentMathFormattingPrompt: false }).agentMathFormattingPrompt).toBe(false)
    expect(normalizeSettings({}).agentMathFormattingPrompt).toBe(true)
  })
```

In `src/lib/agentApi.test.ts`, inside `describe('callAgentResponsesApi', () => { ... })`, add:

```ts
  it('injects configurable math formatting instructions', async () => {
    const createResponse = () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createResponse())
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('## Math formatting')
    expect(body.instructions).toContain('Use `$...$` for inline formulas.')

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentMathFormattingPrompt: false },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.instructions).not.toContain('## Math formatting')
  })
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run:

```powershell
npm test -- src/lib/apiProfiles.test.ts src/lib/agentApi.test.ts
```

Expected: FAIL because `agentMathFormattingPrompt` and math instructions do not exist yet.

- [ ] **Step 4: Add the setting type**

In `src/types.ts`, add to `AppSettings` after `agentWebSearch: boolean`:

```ts
  agentMathFormattingPrompt: boolean
```

- [ ] **Step 5: Normalize and default the setting**

In `src/lib/apiProfiles.ts`, inside `normalizeSettings`, add after `agentWebSearch`:

```ts
    agentMathFormattingPrompt: typeof record.agentMathFormattingPrompt === 'boolean' ? record.agentMathFormattingPrompt : true,
```

In `DEFAULT_SETTINGS`, add after `agentWebSearch: false`:

```ts
  agentMathFormattingPrompt: true,
```

- [ ] **Step 6: Add math instructions to Agent API**

In `src/lib/agentApi.ts`, insert after `AGENT_IMAGE_INSTRUCTIONS`:

```ts
const AGENT_MATH_FORMATTING_INSTRUCTIONS = [
  '## Math formatting',
  '- When a response contains mathematical formulas, output them using Markdown math delimiters supported by this app.',
  '- Use `$...$` for inline formulas.',
  '- Use block math with opening and closing `$$` on their own lines for display formulas.',
  '- Do not use LaTeX delimiters like `\\(...\\)` or `\\[...\\]` in visible assistant text.',
].join('\n')
```

Replace `createAgentInstructions` with:

```ts
function createAgentInstructions(settings: AppSettings) {
  const maxToolRounds = Number.isFinite(settings.agentMaxToolRounds)
    ? Math.max(1, Math.trunc(settings.agentMaxToolRounds))
    : DEFAULT_AGENT_MAX_TOOL_ROUNDS
  const instructions = [
    AGENT_IMAGE_INSTRUCTIONS,
    '',
    '## Tool policy',
    `- Current maximum tool-use rounds for this Agent turn: ${maxToolRounds}.`,
    '- Call continue_generation ONLY when you have generated a prerequisite image and need another round to generate dependent images. Do NOT call it when the task is complete.',
    '- When web_search is available, use it only when current external information would improve the answer or the user asks for research/news/facts.',
    '- When the requested task is complete, stop calling tools and provide the final response.',
  ]

  if (settings.agentMathFormattingPrompt) instructions.push('', AGENT_MATH_FORMATTING_INSTRUCTIONS)

  return instructions.join('\n')
}
```

- [ ] **Step 7: Enable Streamdown math plugin**

In `src/components/MarkdownRenderer.tsx`, change the import type:

```ts
import type { Components, MathPlugin, StreamdownTranslations } from 'streamdown'
```

Add:

```ts
type MathMarkdownModule = {
  math: MathPlugin
}
```

Change the modern state type:

```ts
  | { type: 'modern'; Component: StreamdownComponent; math: MathMarkdownModule }
```

Replace the Streamdown dynamic import in `loadMarkdownRenderer` with:

```ts
  streamdownPromise ??= Promise.all([
    import('streamdown'),
    import('@streamdown/math'),
  ])
    .then(([streamdown, math]) => ({
      type: 'modern' as const,
      Component: streamdown.Streamdown,
      math: {
        math: math.createMathPlugin({
          errorColor: 'var(--muted-foreground)',
          singleDollarTextMath: true,
        }),
      },
    }))
    .catch((error) => {
      console.error('Streamdown failed to load:', error)
      return loadLegacyMarkdown()
    })

  return streamdownPromise!
```

Add the plugin prop to `StreamdownComponent`:

```tsx
      plugins={{ math: renderer.math.math }}
```

- [ ] **Step 8: Add the Agent settings toggle**

In `src/components/SettingsModal.tsx`, inside `activeTab === 'agent'`, add a block matching existing switch styling:

```tsx
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">数学公式渲染提示</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, agentMathFormattingPrompt: !draft.agentMathFormattingPrompt })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.agentMathFormattingPrompt ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.agentMathFormattingPrompt}
                      aria-label="数学公式渲染提示"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.agentMathFormattingPrompt ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后会提示 Agent 使用本应用支持的 Markdown 数学公式格式。
                  </div>
                </div>
```

- [ ] **Step 9: Run math-related tests**

Run:

```powershell
npm test -- src/lib/apiProfiles.test.ts src/lib/agentApi.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run TypeScript build check**

Run:

```powershell
npm run build
```

Expected: PASS. If `MathPlugin` is not exported from `streamdown` in the installed version, adjust the type to:

```ts
type MathMarkdownModule = {
  math: unknown
}
```

and rerun `npm run build`.

- [ ] **Step 11: Commit math preference**

Run:

```powershell
git add package.json package-lock.json src/types.ts src/lib/apiProfiles.ts src/lib/apiProfiles.test.ts src/lib/agentApi.ts src/lib/agentApi.test.ts src/components/MarkdownRenderer.tsx src/components/SettingsModal.tsx
git commit -m "feat(agent): add math rendering preference"
```

Expected: commit succeeds.

---

### Task 6: Preserve Local Fork Behaviors With Regression Tests

**Files:**
- Modify: `src/lib/agentApi.test.ts`
- Modify: `src/lib/api.test.ts`
- Modify: `src/store.test.ts`

- [ ] **Step 1: Confirm Agent still uses the fixed Banana model**

Run:

```powershell
npm test -- src/lib/agentApi.test.ts -- -t "keeps Banana Agent requests on the fixed Agent model"
```

Expected: PASS and request body model is `gpt-5.5`.

- [ ] **Step 2: Confirm Gallery GPT-Image-2 VIP routing still works**

Run:

```powershell
npm test -- src/lib/api.test.ts -- -t "routes Gallery GPT-Image-2"
```

Expected: PASS for the existing VIP Responses route tests.

- [ ] **Step 3: Confirm Gemini gallery routing still works**

Run:

```powershell
npm test -- src/lib/api.test.ts -- -t "Gemini"
```

Expected: PASS for existing Gemini payload, aspect ratio, normalization, and multi-image splitting tests.

- [ ] **Step 4: Confirm transparent background workflow still works**

Run:

```powershell
npm test -- src/store.test.ts src/lib/paramCompatibility.test.ts -- -t "transparent"
```

Expected: PASS for existing transparent background task and parameter compatibility tests.

- [ ] **Step 5: Commit any missing regression-test adjustments**

Run:

```powershell
git status --short
```

If files changed in this task, run:

```powershell
git add src/lib/agentApi.test.ts src/lib/api.test.ts src/store.test.ts
git commit -m "test(agent): preserve banana fork behavior"
```

Expected: commit succeeds if there are changes; if no files changed, no commit is needed.

---

### Task 7: Final Verification And Manual QA

**Files:**
- Read: all modified files
- Read: `package.json`
- Read: `package-lock.json`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- src/lib/imageApiShared.test.ts src/lib/agentApi.test.ts src/store.test.ts src/lib/apiProfiles.test.ts src/lib/api.test.ts src/lib/paramCompatibility.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: PASS and `dist/` is produced.

- [ ] **Step 4: Start dev server for manual Agent QA**

Run:

```powershell
npm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 5: Manual QA Agent stream success**

In the browser:

1. Open the local Vite URL.
2. Switch to Agent mode.
3. Send a simple text-only prompt: `用一句话介绍这个应用。`
4. Confirm the assistant streams text normally.
5. Confirm no duplicate assistant message appears after completion.

- [ ] **Step 6: Manual QA Agent image success**

In Agent mode:

1. Send: `生成一张 1:1 的蓝色玻璃质感图标。`
2. Confirm an Agent image task card appears while running.
3. Confirm it finishes as a gallery task.
4. Confirm the task detail still shows Banana/Aittco profile and model information correctly.

- [ ] **Step 7: Manual QA Agent image failure handling**

Use a mock or intentionally failing API key/profile:

1. Enable streaming on the active OpenAI-compatible profile.
2. Trigger an Agent image-generation request.
3. Confirm failed image tool tasks become `error`.
4. Confirm Agent text can still appear if the stream returns text after the failed image item.
5. Confirm the failed task remains visible for inspection and can be deleted.

- [ ] **Step 8: Manual QA math rendering**

In Agent mode:

1. Ensure the Agent math setting is enabled.
2. Send: `解释勾股定理，并写出公式。`
3. Confirm inline `$a^2+b^2=c^2$` style output renders as math.
4. Disable the Agent math setting.
5. Send another math prompt and confirm the request instructions no longer include the math formatting section by inspecting a mocked request or test output.

- [ ] **Step 9: Inspect final diff for accidental upstream drift**

Run:

```powershell
git diff --stat main..HEAD
git diff main..HEAD -- package.json src/lib/agentApi.ts src/store.ts src/lib/apiProfiles.ts src/components/SettingsModal.tsx
```

Expected:

- No deletion of Electron desktop scripts.
- No deletion of PWA files.
- No replacement of Aittco/Banana defaults with upstream OpenAI defaults.
- No introduction of favorite collections or browser notification settings unless already present locally before this upgrade.
- `src/lib/agentApi.ts` keeps `model: AGENT_FIXED_MODEL`.

- [ ] **Step 10: Final commit if verification fixes were needed**

Run:

```powershell
git status --short
```

If verification fixes changed files, run:

```powershell
git add <changed-files>
git commit -m "test: verify agent upstream upgrade"
```

Expected: commit succeeds if changes were needed.

---

## Completion Criteria

The upgrade is complete when:

- `npm test` passes.
- `npm run build` passes.
- Agent streaming text does not duplicate assistant messages when final completed output lacks ids.
- Failed built-in Agent image tool calls create or update an Agent task with `status: 'error'`.
- Failed image tasks do not prevent the Agent assistant text stream from completing when the API continues streaming text.
- Agent chat, title generation, and batch image generation still send `model: AGENT_FIXED_MODEL`.
- Existing Gemini, Gallery GPT-Image-2 VIP, transparent background, desktop, PWA, and theme customizations remain present.

## Self-Review Notes

- Spec coverage: Each requested upstream Agent area maps to a task: streaming compatibility in Task 2, Agent parser fixes in Task 3, failed Agent task sync in Task 4, math rendering in Task 5, local fork preservation in Task 6, and verification in Task 7.
- Placeholder scan: The plan contains concrete files, commands, code snippets, expected outcomes, and commit messages.
- Type consistency: `AgentApiImageToolFailure`, `onImageToolFailed`, and `agentMathFormattingPrompt` are named consistently across type definitions, API options, tests, store wiring, and settings normalization.
