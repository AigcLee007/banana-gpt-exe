import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeVideoParams } from '../lib/videoModels'
import { encodeVideoMention, serializeVideoPrompt } from '../lib/videoPromptMentions'
import type { VideoReferenceItem } from '../lib/videoTypes'

const draft = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
const editor = vi.hoisted(() => ({ onAddLibrary: undefined as undefined | ((item: VideoReferenceItem) => Promise<void | VideoReferenceItem>) }))
vi.mock('../videoStore', () => ({ useVideoStore: Object.assign(() => draft.state, { getState: () => draft.state }) }))
vi.mock('../videoAssetStore', () => ({ useVideoAssetStore: Object.assign(() => [], { getState: () => ({ assets: [{ id: 'image:gallery-1', type: 'image', storage: 'images' }] }) }) }))
vi.mock('../lib/videoAssetBridge', () => ({ resolveVideoAssetToMediaReference: vi.fn(async () => ({ id: 'converted-media-1', type: 'image' })) }))
vi.mock('../store', () => ({ useStore: { getState: () => ({ showToast: vi.fn() }) } }))
vi.mock('../hooks/useVideoMediaMetadata', () => ({ useVideoMediaMetadata: () => ({}) }))
vi.mock('../hooks/useMediaBlobUrl', () => ({ useMediaBlobUrl: () => null }))
vi.mock('./VideoPromptEditor', () => ({ default: (props: { onAddLibrary: typeof editor.onAddLibrary }) => {
  editor.onAddLibrary = props.onAddLibrary
  return <textarea aria-label="提示词" />
} }))
import VideoInputBar from './VideoInputBar'

beforeEach(() => {
  draft.state = { inputMode: 'create', model: 'gemini-omni-flash-10s', params: normalizeVideoParams({}, 'gemini-omni-flash-10s', 't2v'), prompt: 'fox', firstFrameId: null, lastFrameId: null, refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], isGenerating: false }
})

describe('video workbench controls from model capabilities', () => {
  it.each(['create', 'reference', 'existing-frame'])('returns the resolved gallery ID for @ mentions in %s mode', async (mode) => {
    draft.state.inputMode = mode === 'reference' ? 'reference' : 'create'
    draft.state.firstFrameId = mode === 'existing-frame' ? 'converted-media-1' : null
    draft.state.setFirstFrame = (id: string) => { draft.state.firstFrameId = id }
    draft.state.addReference = (item: VideoReferenceItem) => { draft.state.refItems = [item] }
    renderToStaticMarkup(<VideoInputBar />)
    const selected = await editor.onAddLibrary!({ id: 'image:gallery-1', type: 'image' })
    expect(selected).toEqual({ id: 'converted-media-1', type: 'image' })
    if (!selected) throw new Error('Expected a resolved gallery reference')
    const references: VideoReferenceItem[] = mode === 'reference'
      ? draft.state.refItems as VideoReferenceItem[]
      : [{ id: draft.state.firstFrameId as string, type: 'image' }]
    const prompt = encodeVideoMention({ ...selected, label: '图片1' })
    expect(serializeVideoPrompt(prompt, references)).toBe('图片1')
  })

  it.each([
    ['MiniMax-H3', '推荐', '稳定、快速，推荐使用。'],
    ['sd2.0-15s', '耗时较长', '稳定性较低，生成时间较长，建议优先使用 MiniMax H3。'],
    ['sd2.5-30s', '耗时较长', '稳定性较低，生成时间较长，建议优先使用 MiniMax H3。'],
  ])('shows the %s badge and advice below its selected model', (model, badge, description) => {
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain(`>${badge}</span>`)
    expect(html).toContain('data-testid="video-model-guidance"')
    expect(html).toContain(description)
    expect(html.indexOf(description)).toBeLessThan(html.indexOf('>分辨率</span>'))
  })

  it.each(['grok-imagine-video-1.5', 'gemini-omni-flash-10s'])('clears the selected SD advice when switching to %s', (model) => {
    draft.state.model = 'sd2.0-15s'
    draft.state.params = normalizeVideoParams({}, 'sd2.0-15s', 't2v')
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain('稳定性较低，生成时间较长')
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).not.toContain('data-testid="video-model-guidance"')
    expect(html).not.toContain('耗时较长')
  })
  it.each([['768p', 2.5, 10], ['2k', 5, 20]] as const)('shows the H3 %s rate and matching four-second estimate', (resolution, rate, estimate) => {
    draft.state.model = 'MiniMax-H3'
    draft.state.params = normalizeVideoParams({ resolution, duration: 4 }, 'MiniMax-H3', 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain(`MiniMax H3 · ${rate} 积分/秒`)
    expect(html).toContain(`创建（${estimate.toFixed(1)} 积分）`)
  })
  it.each([
    ['gemini-omni-flash-10s', 25],
    ['sd2.0-15s', 20],
    ['sd2.5-30s', 38],
  ] as const)('shows the configured %s price and matching creation estimate', (model, credits) => {
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain(`${model} · ${credits} 积分/次`)
    expect(html).toContain(`创建（${credits.toFixed(1)} 积分）`)
    expect(html).not.toContain('价格待配置')
  })
  it.each([
    ['MiniMax-H3', 'MiniMax Logo'],
    ['grok-imagine-video-1.5', 'Grok Logo'],
    ['gemini-omni-flash-10s', 'Gemini Logo'],
    ['sd2.0-15s', 'Seedance Logo'],
    ['sd2.5-30s', 'Seedance Logo'],
  ])('shows the logo in the active %s model selector', (model, logo) => {
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain(logo)
  })
  it.each([['sd2.0-15s', 15], ['sd2.5-30s', 30]] as const)('shows fixed %s controls and 30 image references', (model, seconds) => {
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain(model)
    expect(html).toContain(`${seconds}秒`)
    expect(html).toContain('720P')
    expect(html).toContain('1080P')
    expect(html).toContain('21:9')
    expect(html).toContain('1个')
    expect(html).toContain('参考图片')
    expect(html).not.toContain('起始帧')
    expect(html).not.toContain('结束帧')
    expect(html).not.toContain('type="range"')
    expect(html).not.toContain('2个')
    expect(html).not.toContain('4个')
    expect(html).toContain('image/jpeg,image/jpg,image/png,image/webp')
    draft.state.inputMode = 'reference'
    const referenceHtml = renderToStaticMarkup(<VideoInputBar />)
    expect(referenceHtml).toContain('图片 0/30')
    expect(referenceHtml).toContain('15 MB')
    expect(referenceHtml).not.toContain('视频 0/')
    expect(referenceHtml).not.toContain('音频 0/')
    expect(referenceHtml).not.toContain('video/*')
    expect(referenceHtml).not.toContain('audio/*')
  })
  it('shows Gemini logo, single image input and only fixed parameters for Omni', () => {
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain('gemini-omni-flash-10s')
    expect(html).toContain('Gemini Logo')
    expect(html).toContain('文生视频')
    expect(html).toContain('单图生视频')
    expect(html).toContain('10秒')
    expect(html).toContain('720P')
    expect(html).toContain('16:9')
    expect(html).toContain('9:16')
    expect(html).toContain('1个')
    expect(html).not.toContain('结束帧')
    expect(html).not.toContain('video-last-file')
    expect(html).not.toContain('type="range"')
    expect(html).not.toContain('2个')
    expect(html).not.toContain('4个')
  })

  it('shows seven image references without video or audio controls for Omni', () => {
    draft.state.inputMode = 'reference'
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain('图片 0/7')
    expect(html).toContain('accept="image/*"')
    expect(html).not.toContain('视频 0/')
    expect(html).not.toContain('音频 0/')
    expect(html).not.toContain('video/*')
    expect(html).not.toContain('audio/*')
  })

  it('preserves H3 tail frames and multimodal references and Grok single image controls', () => {
    draft.state.model = 'MiniMax-H3'
    draft.state.params = normalizeVideoParams({}, 'MiniMax-H3', 't2v')
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain('结束帧')
    draft.state.inputMode = 'reference'
    const h3 = renderToStaticMarkup(<VideoInputBar />)
    expect(h3).toContain('图片 0/9')
    expect(h3).toContain('视频 0/3')
    expect(h3).toContain('音频 0/3')
    draft.state.model = 'grok-imagine-video-1.5'
    draft.state.inputMode = 'create'
    draft.state.params = normalizeVideoParams({}, 'grok-imagine-video-1.5', 't2v')
    const grok = renderToStaticMarkup(<VideoInputBar />)
    expect(grok).not.toContain('结束帧')
    expect(grok).not.toContain('多参考')
    expect(grok).toContain('480P')
  })
})
