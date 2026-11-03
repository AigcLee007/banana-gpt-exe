// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { useStore } from '../store'
import { createDefaultColorAdjustments, type ColorAdjustments } from '../lib/colorGrading'
import { callAgentColorAssistantApi } from '../lib/agentApi'
import { createColorAssistantImagePayload } from '../lib/colorAssistantImage'
import ColorAssistantPanel from './ColorAssistantPanel'

vi.mock('../lib/agentApi', () => ({ callAgentColorAssistantApi: vi.fn() }))
vi.mock('../lib/colorAssistantImage', () => ({ createColorAssistantImagePayload: vi.fn() }))

const ORIGINAL_SETTINGS = structuredClone(useStore.getState().settings)
const PREVIEW_URL = 'blob:rendered-preview'
const PREVIEW_DATA = 'data:image/jpeg;base64,compressed-current-preview'
const PREVIEW_ANALYSIS = {
  width: 768,
  height: 432,
  samplingStep: 3,
  sampledPixels: 40000,
  ignoredTransparentSamples: 0,
  channels: {
    red: { mean: 136, p10: 72, median: 132, p90: 205, clippedLowPercent: 0.1, clippedHighPercent: 0.2 },
    green: { mean: 122, p10: 68, median: 119, p90: 184, clippedLowPercent: 0.1, clippedHighPercent: 0.2 },
    blue: { mean: 114, p10: 65, median: 112, p90: 172, clippedLowPercent: 0.1, clippedHighPercent: 0.1 },
  },
  luminance: { shadowPercent: 18, midtonePercent: 69, highlightPercent: 13, clippedBlackPercent: 0.4, clippedWhitePercent: 0.3 },
  lowChromaCandidates: { sampleCount: 4200, percent: 10.5, medianLab: { lightness: 55, a: 8, b: 4 } },
}
const historyMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), update: vi.fn() }))

vi.mock('../lib/db', () => ({
  getColorAssistantHistory: historyMocks.get,
  putColorAssistantHistoryRecord: historyMocks.put,
  updateColorAssistantHistoryOutcome: historyMocks.update,
}))

const VALID_PROPOSAL = {
  explanation: '降低曝光，并轻微抬高红色曲线中段。',
  changes: [{ path: 'basic.exposure', value: -0.4 }],
  curves: [{ channel: 'red', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.72 }, { x: 1, y: 1 }] }],
  clarification: null,
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function configureProfile(provider: string = 'openai', apiMode: 'images' | 'responses' = 'images') {
  const profile = {
    ...ORIGINAL_SETTINGS.profiles[0],
    id: 'color-assistant-test',
    provider,
    apiMode,
    name: '测试 Agent',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
  }
  useStore.setState({ settings: {
    ...ORIGINAL_SETTINGS,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    apiMode: profile.apiMode,
    profiles: [profile],
    activeProfileId: profile.id,
  } })
}

function makeAdjustments(): ColorAdjustments {
  const adjustments = createDefaultColorAdjustments()
  adjustments.curves.red = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]
  return adjustments
}

function mountPanel(props: Partial<ComponentProps<typeof ColorAssistantPanel>> = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const defaults: ComponentProps<typeof ColorAssistantPanel> = {
    imageId: 'image-a',
    sourceImageId: 'source-a',
    adjustments: makeAdjustments(),
    previewUrl: PREVIEW_URL,
    ready: true,
    onApply: vi.fn(),
  }
  act(() => root?.render(<ColorAssistantPanel {...defaults} {...props} />))
  return { container, props: { ...defaults, ...props } }
}

function getButton(label: string) {
  const button = [...(container?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

function enterInstruction(value: string) {
  const textarea = container?.querySelector<HTMLTextAreaElement>('textarea[aria-label="调色需求"]')
  if (!textarea) throw new Error('instruction field not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  act(() => textarea.dispatchEvent(new Event('input', { bubbles: true })))
  act(() => textarea.dispatchEvent(new Event('change', { bubbles: true })))
  return textarea
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function getSubmitButton() {
  return getButton('提交调色建议') as HTMLButtonElement
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  historyMocks.get.mockResolvedValue([])
  historyMocks.put.mockResolvedValue('round-1')
  historyMocks.update.mockImplementation(async (id: string, outcome: string, decidedAt = Date.now()) => ({ id, outcome, decidedAt }))
  configureProfile()
  vi.mocked(createColorAssistantImagePayload).mockResolvedValue({ previewImageDataUrl: PREVIEW_DATA, analysis: PREVIEW_ANALYSIS })
  vi.mocked(callAgentColorAssistantApi).mockResolvedValue(VALID_PROPOSAL)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  useStore.setState({ settings: ORIGINAL_SETTINGS })
})

describe('color assistant panel', () => {
  it('renders accessible privacy and readiness controls without calling the API on open', () => {
    const markup = renderToStaticMarkup(<ColorAssistantPanel
      imageId="ssr-image"
      sourceImageId="ssr-image"
      adjustments={makeAdjustments()}
      previewUrl=""
      ready={false}
      onApply={vi.fn()}
    />)
    expect(markup).toContain('role="region"')
    expect(markup).toContain('AI 调色助手')
    expect(markup).toContain('提交调色建议')
    expect(markup).toContain('分析图片色彩')
    expect(markup).toContain('当前调色预览')
    expect(markup).toContain('Agent 模型')
    expect(markup).toContain('disabled=""')
    expect(callAgentColorAssistantApi).not.toHaveBeenCalled()
  })

  it('analyzes the current image only after an explicit click and keeps its proposal pending', async () => {
    const initial = makeAdjustments()
    const onApply = vi.fn()
    mountPanel({ adjustments: initial, onApply })

    const analyzeButton = getButton('分析图片色彩') as HTMLButtonElement
    expect(analyzeButton.disabled).toBe(false)
    expect(callAgentColorAssistantApi).not.toHaveBeenCalled()
    expect(createColorAssistantImagePayload).not.toHaveBeenCalled()

    act(() => analyzeButton.click())
    await flushPromises()

    expect(createColorAssistantImagePayload).toHaveBeenCalledWith(PREVIEW_URL)
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(1)
    const request = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0]
    expect(request.instruction).toContain('分析当前图片')
    expect(request.instruction).toContain('色彩')
    expect(request.adjustments).toEqual(initial)
    expect(request.previewImageDataUrl).toBe(PREVIEW_DATA)
    expect(request.colorAnalysis).toEqual(PREVIEW_ANALYSIS)
    expect(onApply).not.toHaveBeenCalled()
    expect(container?.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
  })

  it('keeps submit disabled until an instruction and current preview are ready', () => {
    const adjustments = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ ready: false, adjustments, onApply })
    expect(node.querySelector('textarea[aria-label="调色需求"]')).not.toBeNull()
    enterInstruction('稍微提亮')
    expect(getSubmitButton().disabled).toBe(true)

    act(() => root?.render(<ColorAssistantPanel imageId="image-a" sourceImageId="source-a" adjustments={adjustments} previewUrl="" ready onApply={onApply} />))
    expect(getSubmitButton().disabled).toBe(true)
    act(() => root?.render(<ColorAssistantPanel imageId="image-a" sourceImageId="source-a" adjustments={adjustments} previewUrl={PREVIEW_URL} ready onApply={onApply} />))
    expect(getSubmitButton().disabled).toBe(false)
    expect(callAgentColorAssistantApi).not.toHaveBeenCalled()
    expect(createColorAssistantImagePayload).not.toHaveBeenCalled()
  })

  it('rejects a non-OpenAI-compatible profile and gives direct configuration guidance', () => {
    configureProfile('fal')
    const { container: node } = mountPanel()
    enterInstruction('让画面更冷一些')
    expect(node.textContent).toContain('请在 API 配置中选择可用于 Agent 的 OpenAI 兼容配置')
    expect(getSubmitButton().disabled).toBe(true)
    expect(callAgentColorAssistantApi).not.toHaveBeenCalled()
  })

  it('allows a custom OpenAI-compatible profile through the fixed Responses route', async () => {
    const settings = {
      ...ORIGINAL_SETTINGS,
      baseUrl: 'https://custom.example.test/v1',
      apiKey: 'custom-key',
      model: 'image-model',
      apiMode: 'images' as const,
      customProviders: [{
        id: 'custom-openai-compatible',
        name: 'Compatible provider',
        template: 'http-image' as const,
        submit: { path: 'images/generations', contentType: 'json' as const, body: {} },
      }],
      profiles: [{
        ...ORIGINAL_SETTINGS.profiles[0],
        id: 'custom-compatible-profile',
        provider: 'custom-openai-compatible',
        name: 'Compatible profile',
        baseUrl: 'https://custom.example.test/v1',
        apiKey: 'custom-key',
        apiMode: 'images' as const,
      }],
      activeProfileId: 'custom-compatible-profile',
    }
    useStore.setState({ settings })
    const { container: node } = mountPanel()
    enterInstruction('稍微提亮')
    expect(getSubmitButton().disabled).toBe(false)
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].profile).toMatchObject({ provider: 'openai', apiMode: 'responses' })
    expect(node.textContent).not.toContain('配置不可用')
  })

  it('keeps small curve changes visible in the before and after coordinates', async () => {
    vi.mocked(callAgentColorAssistantApi).mockResolvedValueOnce({
      explanation: '只做轻微调整。',
      changes: [],
      curves: [{ channel: 'red', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.504 }, { x: 1, y: 1 }] }],
      clarification: null,
    })
    const { container: node } = mountPanel()
    enterInstruction('微调红色曲线')
    act(() => getSubmitButton().click())
    await flushPromises()

    expect(node.textContent).toContain('(0.5, 0.5)')
    expect(node.textContent).toContain('(0.5, 0.504)')
  })

  it('persists a successful proposal before showing its candidate controls', async () => {
    let resolveHistoryWrite!: (value: string) => void
    historyMocks.put.mockImplementationOnce(() => new Promise((resolve) => { resolveHistoryWrite = resolve }))
    const initial = makeAdjustments()
    const { container: node } = mountPanel({ adjustments: initial })
    enterInstruction('去掉红色偏色')
    act(() => getSubmitButton().click())
    await flushPromises()

    expect(historyMocks.put).toHaveBeenCalledTimes(1)
    expect(historyMocks.put.mock.calls[0][0]).toMatchObject({
      sourceImageId: 'source-a',
      activeImageId: 'image-a',
      instruction: '去掉红色偏色',
      outcome: 'pending',
      changes: [{ path: 'basic.exposure', before: 0, after: -0.4 }],
      curves: [{ channel: 'red', before: initial.curves.red, after: VALID_PROPOSAL.curves[0].points }],
    })
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()

    resolveHistoryWrite('round-1')
    await flushPromises()
    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
  })

  it('retains a newly stored round if the initial history read completes with an older snapshot', async () => {
    let resolveInitialRead!: (records: never[]) => void
    historyMocks.get.mockImplementationOnce(() => new Promise((resolve) => { resolveInitialRead = resolve }))
    const { container: node } = mountPanel()
    enterInstruction('去掉红色偏色')
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(node.querySelector('.color-assistant-history-entry')).not.toBeNull()

    await act(async () => { resolveInitialRead([]); await flushPromises() })
    expect(node.querySelector('.color-assistant-history-entry')).not.toBeNull()
  })

  it('keeps the candidate available when saving its history record fails', async () => {
    historyMocks.put.mockRejectedValueOnce(new Error('quota exceeded'))
    const onApply = vi.fn()
    const { container: node } = mountPanel({ onApply })
    enterInstruction('降低一点曝光')
    act(() => getSubmitButton().click())
    await flushPromises()

    expect(node.querySelector('[role="alert"]')?.textContent).toContain('本轮未能保存到历史记录')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
    await act(async () => { getButton('应用建议').click(); await flushPromises() })
    expect(onApply).toHaveBeenCalledOnce()
    expect(historyMocks.update).not.toHaveBeenCalled()
  })

  it('loads read-only round history by source image and shows its decision and before/after values', async () => {
    historyMocks.get.mockResolvedValueOnce([{
      id: 'old-round', sourceImageId: 'source-lineage', activeImageId: 'saved-version',
      instruction: '去掉暖红色', explanation: '降低色温。', clarification: null,
      createdAt: 100, decidedAt: 200, outcome: 'applied',
      changes: [{ path: 'whiteBalance.temperature', before: 6500, after: 6000 }],
      curves: [{ channel: 'red', before: [{ x: 0, y: 0 }, { x: 1, y: 1 }], after: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }] }],
    }])
    const { container: node } = mountPanel({ sourceImageId: 'source-lineage' })
    await flushPromises()

    expect(historyMocks.get).toHaveBeenCalledWith('source-lineage')
    expect(node.textContent).toContain('去掉暖红色')
    expect(node.textContent).toContain('已采纳')
    expect(node.textContent).toContain('图片版本 saved-version')
    expect(node.textContent).toContain('6500 → 6000')
    expect(node.textContent).toContain('(0, 0) (1, 1) → (0, 0) (1, 0.9)')
    expect(node.querySelector('.color-assistant-history-entry button')).toBeNull()
  })

  it('sends only the compressed current preview and the current recipe after explicit submit', async () => {
    const initial = makeAdjustments()
    const { container: node } = mountPanel({ adjustments: initial })
    enterInstruction('稍微降低曝光')
    expect(callAgentColorAssistantApi).not.toHaveBeenCalled()

    act(() => getSubmitButton().click())
    await flushPromises()

    expect(createColorAssistantImagePayload).toHaveBeenCalledWith(PREVIEW_URL)
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(1)
    const request = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0]
    expect(request.instruction).toBe('稍微降低曝光')
    expect(request.adjustments).toEqual(initial)
    expect(request.previewImageDataUrl).toBe(PREVIEW_DATA)
    expect(request.colorAnalysis).toEqual(PREVIEW_ANALYSIS)
    expect(request.profile.provider).toBe('openai')
    expect(request.profile.apiMode).toBe('responses')
    expect(request.settings).toEqual(useStore.getState().settings)
    expect(node.textContent).toContain('降低曝光')
    expect(node.textContent).toContain('红色曲线')
    expect(node.textContent).toContain('(0.5, 0.5)')
    expect(node.textContent).toContain('(0.5, 0.72)')
    expect(request.adjustments).toEqual(initial)
  })

  it('holds a proposal until Apply and Discard never calls the parent', async () => {
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })
    enterInstruction('降低一点曝光')
    act(() => getSubmitButton().click())
    await flushPromises()

    expect(onApply).not.toHaveBeenCalled()
    expect(initial.basic.exposure).toBe(0)
    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
    await act(async () => { getButton('放弃建议').click(); await flushPromises() })
    expect(onApply).not.toHaveBeenCalled()
    expect(node.querySelector('.color-assistant-candidate')).toBeNull()
    expect(node.textContent).toContain('降低曝光，并轻微抬高红色曲线中段。')
    expect(historyMocks.update.mock.calls[0]).toEqual([expect.any(String), 'discarded'])
  })

  it('applies a candidate only after an explicit Apply action', async () => {
    const initial = makeAdjustments()
    const onApply = vi.fn()
    mountPanel({ adjustments: initial, onApply })
    enterInstruction('降低一点曝光')
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(onApply).not.toHaveBeenCalled()

    await act(async () => { getButton('应用建议').click(); await flushPromises() })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(historyMocks.update.mock.calls[0]).toEqual([expect.any(String), 'applied'])
    const [next, base] = onApply.mock.calls[0]
    expect(base).toEqual(initial)
    expect(next.basic.exposure).toBe(-0.4)
    expect(next.curves.red[1]).toEqual({ x: 0.5, y: 0.72 })
    expect(initial.basic.exposure).toBe(0)
  })

  it('lets the user accept a no-change analysis without mutating the recipe', async () => {
    vi.mocked(callAgentColorAssistantApi).mockResolvedValueOnce({
      explanation: '当前画面白平衡自然，明暗和饱和度协调，无需调整。',
      changes: [], curves: [], clarification: null,
    })
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })

    act(() => getButton('分析图片色彩').click())
    await flushPromises()

    expect(node.textContent).toContain('当前画面白平衡自然')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
    expect(node.textContent).toContain('保持当前配方')
    expect(node.textContent).toContain('放弃建议')
    await act(async () => { getButton('保持当前配方').click(); await flushPromises() })
    expect(onApply).not.toHaveBeenCalled()
    expect(initial).toEqual(makeAdjustments())
    expect(historyMocks.update.mock.calls[0]).toEqual([expect.any(String), 'applied'])
    expect(node.querySelector('.color-assistant-candidate')).toBeNull()
  })

  it('lets the user discard a no-change analysis without mutating the recipe', async () => {
    vi.mocked(callAgentColorAssistantApi).mockResolvedValueOnce({
      explanation: '整体色彩已经平衡。', changes: [], curves: [], clarification: null,
    })
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })

    act(() => getButton('分析图片色彩').click())
    await flushPromises()
    await act(async () => { getButton('放弃建议').click(); await flushPromises() })

    expect(onApply).not.toHaveBeenCalled()
    expect(initial).toEqual(makeAdjustments())
    expect(historyMocks.update.mock.calls[0]).toEqual([expect.any(String), 'discarded'])
    expect(node.querySelector('.color-assistant-candidate')).toBeNull()
  })

  it('shows clarification without an Apply action', async () => {
    vi.mocked(callAgentColorAssistantApi).mockResolvedValueOnce({
      explanation: '需要确认期望色温。', changes: [], curves: [], clarification: '希望偏冷还是偏暖？',
    })
    const onApply = vi.fn()
    const { container: node } = mountPanel({ onApply })
    enterInstruction('调整白平衡')
    act(() => getSubmitButton().click())
    await flushPromises()

    expect(node.textContent).toContain('希望偏冷还是偏暖？')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
    expect(node.textContent).not.toContain('保持当前配方')
    expect(onApply).not.toHaveBeenCalled()
    await act(async () => { getButton('放弃建议').click(); await flushPromises() })
    expect(node.querySelector('.color-assistant-candidate')).toBeNull()
    expect(node.textContent).toContain('希望偏冷还是偏暖？')
  })

  it('shows identity coordinates when a proposal replaces an initially empty curve', async () => {
    const initial = makeAdjustments()
    initial.curves.red = []
    const { container: node } = mountPanel({ adjustments: initial })
    enterInstruction('调整红色曲线')
    act(() => getSubmitButton().click())
    await flushPromises()
    const curveRow = [...node.querySelectorAll('.color-assistant-candidate .color-assistant-change')].find((row) => row.textContent?.includes('红色曲线'))
    expect(curveRow?.textContent).toContain('(0, 0) (1, 1) →')
  })

  it('clears a completed candidate after a manual recipe edit', async () => {
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })
    enterInstruction('稍微调暗')
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()

    const edited = structuredClone(initial)
    edited.basic.contrast = 20
    act(() => root?.render(<ColorAssistantPanel imageId="image-a" sourceImageId="source-a" adjustments={edited} previewUrl={PREVIEW_URL} ready={false} onApply={onApply} />))
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
    expect(onApply).not.toHaveBeenCalled()
    await flushPromises()
    expect(historyMocks.update.mock.calls[0]).toEqual([expect.any(String), 'expired'])
  })

  it('keeps the instruction after invalid responses and recoverable API errors', async () => {
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })
    const textarea = enterInstruction('让肤色自然')
    vi.mocked(callAgentColorAssistantApi).mockResolvedValueOnce({ explanation: 'invalid' })
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('调色建议')
    expect(textarea.value).toBe('让肤色自然')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()

    vi.mocked(callAgentColorAssistantApi).mockRejectedValueOnce(new Error('temporarily unavailable'))
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('暂时无法获取调色建议')
    expect(textarea.value).toBe('让肤色自然')
    expect(node.textContent).not.toContain('仅文字与参数重试')
    expect(initial).toEqual(makeAdjustments())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('cancels an in-flight request and ignores its late response', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.mocked(callAgentColorAssistantApi).mockImplementationOnce((options) => new Promise((resolve) => {
      resolveRequest = resolve
      expect(options.signal?.aborted).toBe(false)
    }))
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })
    const textarea = enterInstruction('电影感')
    act(() => getSubmitButton().click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    expect(signal?.aborted).toBe(false)

    act(() => getButton('取消请求').click())
    expect(signal?.aborted).toBe(true)
    resolveRequest(VALID_PROPOSAL)
    await flushPromises()

    expect(textarea.value).toBe('电影感')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
    expect(initial).toEqual(makeAdjustments())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('aborts and ignores a response when the recipe changes during the request', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.mocked(callAgentColorAssistantApi).mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const initial = makeAdjustments()
    const { container: node } = mountPanel({ adjustments: initial })
    enterInstruction('提升对比')
    act(() => getSubmitButton().click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    const edited = structuredClone(initial)
    edited.basic.contrast = 12
    act(() => root?.render(<ColorAssistantPanel imageId="image-a" sourceImageId="source-a" adjustments={edited} previewUrl={PREVIEW_URL} ready onApply={vi.fn()} />))
    expect(signal?.aborted).toBe(true)

    resolveRequest(VALID_PROPOSAL)
    await flushPromises()
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
  })

  it('keeps a request and candidate when the same recipe preview refreshes', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.mocked(callAgentColorAssistantApi).mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const adjustments = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments, onApply })
    enterInstruction('稍微调整色调')
    act(() => getSubmitButton().click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    expect(signal?.aborted).toBe(false)

    act(() => root?.render(<ColorAssistantPanel imageId="image-a" sourceImageId="source-a" adjustments={adjustments} previewUrl="blob:high-quality-preview" ready={false} onApply={onApply} />))
    expect(signal?.aborted).toBe(false)
    resolveRequest(VALID_PROPOSAL)
    await flushPromises()

    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
    act(() => getButton('应用建议').click())
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('shows an expired proposal message when the parent rejects a stale snapshot', async () => {
    const onApply = vi.fn().mockReturnValue(false)
    const { container: node } = mountPanel({ onApply })
    enterInstruction('稍微调暗')
    act(() => getSubmitButton().click())
    await flushPromises()

    act(() => getButton('应用建议').click())
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('该建议已过期，请重新提交')
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
  })

  it('aborts and ignores a response when the image changes', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.mocked(callAgentColorAssistantApi).mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const { container: node } = mountPanel()
    enterInstruction('调成冷色')
    act(() => getSubmitButton().click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    act(() => root?.render(<ColorAssistantPanel imageId="image-b" sourceImageId="source-b" adjustments={makeAdjustments()} previewUrl={PREVIEW_URL} ready onApply={vi.fn()} />))
    expect(signal?.aborted).toBe(true)
    resolveRequest(VALID_PROPOSAL)
    await flushPromises()
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
  })

  it('offers an explicit text-only retry for unsupported image input and omits the preview', async () => {
    vi.mocked(callAgentColorAssistantApi)
      .mockRejectedValueOnce(new Error('This model does not support image input'))
      .mockResolvedValueOnce(VALID_PROPOSAL)
    const { container: node } = mountPanel()
    enterInstruction('电影感')
    act(() => getSubmitButton().click())
    await flushPromises()
    expect(node.textContent).toContain('仅文字与参数重试')
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('当前 Agent 模型不支持图像输入，无法分析预览')
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(1)

    act(() => getButton('仅文字与参数重试').click())
    await flushPromises()
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callAgentColorAssistantApi).mock.calls[1][0]).not.toHaveProperty('previewImageDataUrl')
    expect(vi.mocked(callAgentColorAssistantApi).mock.calls[1][0].instruction).toBe('电影感')
    expect(vi.mocked(callAgentColorAssistantApi).mock.calls[1][0].adjustments).toEqual(makeAdjustments())
    expect(createColorAssistantImagePayload).toHaveBeenCalledTimes(1)
    expect(node.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
  })

  it('does not offer text-only retry when visual analysis cannot send an image', async () => {
    vi.mocked(callAgentColorAssistantApi).mockRejectedValueOnce(new Error('This model does not support image input'))
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })

    act(() => getButton('分析图片色彩').click())
    await flushPromises()

    expect(node.querySelector('[role="alert"]')?.textContent).toContain('无法分析预览')
    expect(node.textContent).not.toContain('仅文字与参数重试')
    expect(initial).toEqual(makeAdjustments())
    expect(onApply).not.toHaveBeenCalled()
    expect(node.querySelector('button[aria-label="应用调色建议"]')).toBeNull()
  })

  it('ignores a late image-analysis proposal after the user cancels', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.mocked(callAgentColorAssistantApi).mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const initial = makeAdjustments()
    const onApply = vi.fn()
    const { container: node } = mountPanel({ adjustments: initial, onApply })

    act(() => getButton('分析图片色彩').click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    expect(signal?.aborted).toBe(false)

    act(() => getButton('取消请求').click())
    expect(signal?.aborted).toBe(true)
    resolveRequest(VALID_PROPOSAL)
    await flushPromises()

    expect(node.querySelector('.color-assistant-candidate')).toBeNull()
    expect(initial).toEqual(makeAdjustments())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('does not submit duplicate requests while one is in flight', async () => {
    vi.mocked(callAgentColorAssistantApi).mockImplementation(() => new Promise(() => {}))
    mountPanel()
    enterInstruction('稍微提亮')
    act(() => {
      const submit = getSubmitButton()
      submit.click()
      submit.click()
    })
    await flushPromises()
    expect(callAgentColorAssistantApi).toHaveBeenCalledTimes(1)
  })

  it('aborts the active request on close via unmount', async () => {
    vi.mocked(callAgentColorAssistantApi).mockImplementation(() => new Promise(() => {}))
    mountPanel()
    enterInstruction('调整色温')
    act(() => getSubmitButton().click())
    await flushPromises()
    const signal = vi.mocked(callAgentColorAssistantApi).mock.calls[0][0].signal
    act(() => root?.unmount())
    root = null
    expect(signal?.aborted).toBe(true)
  })
})
