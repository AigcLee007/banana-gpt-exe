// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDefaultColorAdjustments } from '../lib/colorGrading'
import { storeColorEditedImage } from '../lib/db'
import { useStore } from '../store'
import ColorGradingEditor from './ColorGradingEditor'

const editorMocks = vi.hoisted(() => ({
  getImage: vi.fn(),
  getColorEditRecord: vi.fn(),
  getColorEditVersions: vi.fn(),
  storeColorEditedImage: vi.fn(),
  loadRenderer: vi.fn(),
  renderPreview: vi.fn(),
  exportImage: vi.fn(),
  dispose: vi.fn(),
  callAssistant: vi.fn(),
  createPreview: vi.fn(),
  getAssistantHistory: vi.fn(),
  putAssistantHistory: vi.fn(),
  updateAssistantHistory: vi.fn(),
}))

vi.mock('../lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/db')>(),
  getImage: editorMocks.getImage,
  getColorEditRecord: editorMocks.getColorEditRecord,
  getColorEditVersions: editorMocks.getColorEditVersions,
  storeColorEditedImage: editorMocks.storeColorEditedImage,
  getColorAssistantHistory: editorMocks.getAssistantHistory,
  putColorAssistantHistoryRecord: editorMocks.putAssistantHistory,
  updateColorAssistantHistoryOutcome: editorMocks.updateAssistantHistory,
}))
vi.mock('../lib/colorGradingRenderer', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/colorGradingRenderer')>(),
  createColorGradingRenderer: vi.fn(() => ({
    load: editorMocks.loadRenderer,
    renderPreview: editorMocks.renderPreview,
    exportImage: editorMocks.exportImage,
    dispose: editorMocks.dispose,
  })),
}))
vi.mock('../lib/agentApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/agentApi')>(),
  callAgentColorAssistantApi: editorMocks.callAssistant,
}))
vi.mock('../lib/colorAssistantImage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/colorAssistantImage')>(),
  createColorAssistantImagePayload: editorMocks.createPreview,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
const ORIGINAL_SETTINGS = structuredClone(useStore.getState().settings)

function configureAgentProfile() {
  const profile = {
    ...ORIGINAL_SETTINGS.profiles[0],
    id: 'color-editor-test',
    provider: 'openai',
    apiMode: 'images' as const,
    name: '测试 Agent',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'editor-key',
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

function prepareEditorDependencies() {
  editorMocks.getImage.mockImplementation(async (id: string) => ({
    id,
    dataUrl: 'data:image/png;base64,aGVsbG8=',
  }))
  editorMocks.getColorEditRecord.mockResolvedValue(null)
  editorMocks.getColorEditVersions.mockResolvedValue([])
  editorMocks.storeColorEditedImage.mockResolvedValue('saved-image')
  editorMocks.loadRenderer.mockResolvedValue({ width: 64, height: 48 })
  editorMocks.renderPreview.mockImplementation(async () => ({
    bitmap: { width: 64, height: 48, close: vi.fn() },
    histogram: null,
  }))
  editorMocks.exportImage.mockResolvedValue(new Blob(['export']))
  editorMocks.callAssistant.mockResolvedValue({
    explanation: '轻微降低曝光。',
    changes: [{ path: 'basic.exposure', value: -0.4 }],
    curves: [],
    clarification: null,
  })
  editorMocks.createPreview.mockResolvedValue({
    previewImageDataUrl: 'data:image/jpeg;base64,compressed',
    analysis: {
      width: 64,
      height: 48,
      samplingStep: 1,
      sampledPixels: 3072,
      ignoredTransparentSamples: 0,
      channels: {
        red: { mean: 128, p10: 64, median: 128, p90: 192, clippedLowPercent: 0, clippedHighPercent: 0 },
        green: { mean: 128, p10: 64, median: 128, p90: 192, clippedLowPercent: 0, clippedHighPercent: 0 },
        blue: { mean: 128, p10: 64, median: 128, p90: 192, clippedLowPercent: 0, clippedHighPercent: 0 },
      },
      luminance: { shadowPercent: 15, midtonePercent: 70, highlightPercent: 15, clippedBlackPercent: 0, clippedWhitePercent: 0 },
      lowChromaCandidates: { sampleCount: 500, percent: 16.3, medianLab: { lightness: 54, a: 0, b: 0 } },
    },
  })
  editorMocks.getAssistantHistory.mockResolvedValue([])
  editorMocks.putAssistantHistory.mockResolvedValue('round-id')
  editorMocks.updateAssistantHistory.mockImplementation(async (id: string, outcome: string, decidedAt = Date.now()) => ({ id, outcome, decidedAt }))

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['source'], { type: 'image/png' }) }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['preview'], { type: 'image/png' })))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:editor-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
}

function findButton(label: string): HTMLButtonElement {
  const button = [...(container?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

function setInstruction(value: string) {
  const input = container?.querySelector<HTMLTextAreaElement>('textarea[aria-label="调色需求"]')
  if (!input) throw new Error('instruction field not found')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value)
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })))
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
}

async function waitForPreviewCallCount(minimum: number) {
  for (let attempt = 0; attempt < 12 && editorMocks.renderPreview.mock.calls.length < minimum; attempt++) {
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 50)) })
  }
  expect(editorMocks.renderPreview.mock.calls.length).toBeGreaterThanOrEqual(minimum)
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  editorMocks.getAssistantHistory.mockResolvedValue([])
  editorMocks.putAssistantHistory.mockResolvedValue('round-id')
  editorMocks.updateAssistantHistory.mockImplementation(async (id: string, outcome: string, decidedAt = Date.now()) => ({ id, outcome, decidedAt }))
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  useStore.getState().setColorGradingImageId(null)
  useStore.setState({ settings: ORIGINAL_SETTINGS })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('color grading editor opt-in behavior', () => {
  it('does not render an editor until the user opens a specific stored image', () => {
    expect(renderToStaticMarkup(<ColorGradingEditor />)).toBe('')
    expect(useStore.getState().colorGradingImageId).toBeNull()
  })

  it('renders assistant privacy and configuration controls as soon as the editor opens', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<ColorGradingEditor />))
    act(() => useStore.getState().setColorGradingImageId('assistant-ssr-image'))

    expect(container.textContent).toContain('AI 调色助手')
    expect(container.textContent).toContain('点击“提交调色建议”或“分析图片色彩”后')
    expect(container.querySelector('button.color-assistant-analyze')?.textContent).toBe('分析图片色彩')
    expect(container.textContent).toContain('JPEG')
    expect(editorMocks.callAssistant).not.toHaveBeenCalled()
    expect(editorMocks.createPreview).not.toHaveBeenCalled()
  })

  it('adds accessible explanations to numeric controls and custom adjustment surfaces', async () => {
    prepareEditorDependencies()
    act(() => useStore.getState().setColorGradingImageId('help-editor-image'))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<ColorGradingEditor />))
    await waitForPreviewCallCount(1)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const sliders = [...(container.querySelectorAll('.color-editor-slider') ?? [])]
    expect(sliders.length).toBeGreaterThan(20)
    expect(sliders.every((slider) => slider.querySelector('.color-parameter-help-button'))).toBe(true)
    expect(container.querySelector('button[aria-label="曝光说明"]')).not.toBeNull()
    expect(container.querySelector('input[aria-label="曝光"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="取样中性点说明"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="点曲线说明"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="阴影色轮说明"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="3D LUT说明"]')).not.toBeNull()
  })

  it('applies one in-memory recipe step and Undo restores the exact prior recipe without saving or exporting', async () => {
    prepareEditorDependencies()
    configureAgentProfile()
    const initial = createDefaultColorAdjustments()
    act(() => useStore.getState().setColorGradingImageId('editor-image'))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<ColorGradingEditor />))
    await waitForPreviewCallCount(1)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    setInstruction('稍微降低曝光')
    act(() => findButton('提交调色建议').click())
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(editorMocks.createPreview).toHaveBeenCalledWith('blob:editor-preview')
    expect(editorMocks.callAssistant).toHaveBeenCalledTimes(1)
    expect(editorMocks.callAssistant.mock.calls[0][0].adjustments).toEqual(initial)
    expect(editorMocks.callAssistant.mock.calls[0][0].colorAnalysis.sampledPixels).toBe(3072)
    expect(container.querySelector('button[aria-label="应用调色建议"]')).not.toBeNull()
    expect(editorMocks.renderPreview.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(editorMocks.renderPreview.mock.calls.map(([recipe]) => recipe)).toEqual(
      editorMocks.renderPreview.mock.calls.map(() => initial),
    )

    const previewsBeforeApply = editorMocks.renderPreview.mock.calls.length
    act(() => findButton('应用建议').click())
    await waitForPreviewCallCount(previewsBeforeApply + 1)
    expect(editorMocks.renderPreview.mock.calls[previewsBeforeApply][0].basic.exposure).toBe(-0.4)
    const previewsBeforeUndo = editorMocks.renderPreview.mock.calls.length
    act(() => container?.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')?.click())
    await waitForPreviewCallCount(previewsBeforeUndo + 1)

    expect(editorMocks.renderPreview.mock.calls[editorMocks.renderPreview.mock.calls.length - 1]?.[0]).toEqual(initial)
    expect(storeColorEditedImage).not.toHaveBeenCalled()
    expect(editorMocks.exportImage).not.toHaveBeenCalled()
    expect(editorMocks.callAssistant).toHaveBeenCalledTimes(1)
  })
})
