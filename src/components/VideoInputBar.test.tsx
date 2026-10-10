import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeVideoParams } from '../lib/videoModels'
import { encodeVideoMention, serializeVideoPrompt } from '../lib/videoPromptMentions'
import type { VideoReferenceItem } from '../lib/videoTypes'

const draft = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
const editor = vi.hoisted(() => ({ onAddLibrary: undefined as undefined | ((item: VideoReferenceItem) => Promise<void | VideoReferenceItem>) }))
const media = vi.hoisted(() => ({ metadata: {} as Record<string, { duration?: number }> }))
vi.mock('../videoStore', () => ({ useVideoStore: Object.assign(() => draft.state, { getState: () => draft.state }) }))
vi.mock('../videoAssetStore', () => ({ useVideoAssetStore: Object.assign(() => [], { getState: () => ({ assets: [{ id: 'image:gallery-1', type: 'image', storage: 'images' }] }) }) }))
vi.mock('../lib/videoAssetBridge', () => ({ resolveVideoAssetToMediaReference: vi.fn(async () => ({ id: 'converted-media-1', type: 'image' })) }))
vi.mock('../store', () => ({ useStore: { getState: () => ({ showToast: vi.fn() }) } }))
vi.mock('../hooks/useVideoMediaMetadata', () => ({ useVideoMediaMetadata: () => media.metadata }))
vi.mock('../hooks/useMediaBlobUrl', () => ({ useMediaBlobUrl: () => null }))
vi.mock('./VideoPromptEditor', () => ({ default: (props: { onAddLibrary: typeof editor.onAddLibrary }) => {
  editor.onAddLibrary = props.onAddLibrary
  return <textarea aria-label="提示词" />
} }))
import VideoInputBar from './VideoInputBar'

beforeEach(() => {
  media.metadata = {}
  draft.state = { inputMode: 'create', model: 'gemini-omni-flash-10s', params: normalizeVideoParams({}, 'gemini-omni-flash-10s', 't2v'), prompt: 'fox', firstFrameId: null, lastFrameId: null, refImageIds: [], refVideoIds: [], refAudioIds: [], refItems: [], isGenerating: false }
})

describe('video workbench controls from model capabilities', () => {
  it('places a model comparison entry after the model selector', () => {
    const html = renderToStaticMarkup(<VideoInputBar />)
    const entry = html.indexOf('aria-label="视频模型对比说明"')
    expect(entry).toBeGreaterThan(html.indexOf('title="gemini-omni-flash-10s · 25 积分/次"'))
    expect(entry).toBeLessThan(html.indexOf('>分辨率</span>'))
    expect(entry).toBeGreaterThan(-1)
  })
  it('shows Wan limits, third-party upload notice and a video-dependent duration maximum', () => {
    draft.state.model = 'wan3.0-video-720p'
    draft.state.inputMode = 'reference'
    draft.state.params = normalizeVideoParams({}, 'wan3.0-video-720p', 'ref2v')
    draft.state.refItems = [{ id: 'clip', type: 'video' }]
    draft.state.refVideoIds = ['clip']
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain('Uguu')
    expect(html).toContain('3 小时')
    expect(html).toContain('24–60 FPS')
    expect(html).toContain('max="15"')
    expect(html).not.toContain('结束帧')
    draft.state.inputMode = 'create'
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain('max="30"')
  })
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
    ['MiniMax-H3', ['推荐', '稳定快速', '30S']],
    ['wan3.0-video-720p', ['优质', '30S长视频']],
    ['sd2.0-15s', ['耗时较长']],
    ['sd2.5-30s', ['耗时较长']],
  ] as const)('shows the %s badges next to the selected name without advice below', (model, badges) => {
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    for (const badge of badges) expect(html).toContain(`>${badge}</span>`)
    expect(html.match(/data-video-model-badge/g)).toHaveLength(badges.length)
    expect(html).not.toContain('data-testid="video-model-guidance"')
    expect(html).not.toContain('稳定、快速，推荐使用。')
    expect(html).not.toContain('稳定性较低，生成时间较长，建议优先使用 MiniMax H3。')
    expect(html.indexOf('data-video-model-badge')).toBeLessThan(html.indexOf('>分辨率</span>'))
  })

  it.each(['grok-imagine-video-1.5', 'gemini-omni-flash-10s'])('clears the selected SD badge when switching to %s', (model) => {
    draft.state.model = 'sd2.0-15s'
    draft.state.params = normalizeVideoParams({}, 'sd2.0-15s', 't2v')
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain('耗时较长')
    draft.state.model = model
    draft.state.params = normalizeVideoParams({}, model, 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).not.toContain('data-testid="video-model-guidance"')
    expect(html).not.toContain('耗时较长')
    expect(html).not.toContain('data-video-model-badge')
  })
  it.each([['480p', 1.5, 6], ['768p', 2.5, 10], ['1080p', 3.75, 15], ['2k', 5, 20]] as const)('shows the H3 %s rate and matching four-second estimate', (resolution, rate, estimate) => {
    draft.state.model = 'MiniMax-H3'
    draft.state.params = normalizeVideoParams({ resolution, duration: 4 }, 'MiniMax-H3', 't2v')
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain(`MiniMax H3 · ${rate} 积分/秒起`)
    expect(html).toContain(`创建（预估 ${estimate} 积分）`)
    expect(html).not.toContain('data-testid="video-pricing-rules"')
    expect(html).toContain('aria-label="视频模型对比说明"')
  })

  it.each([['480p', 30], ['768p', 30], ['1080p', 15], ['2k', 15]] as const)(
    'shows the H3 %s resolution duration limit', (resolution, max) => {
      draft.state.model = 'MiniMax-H3'
      draft.state.params = normalizeVideoParams({ resolution, duration: 30 }, 'MiniMax-H3', 't2v')
      const html = renderToStaticMarkup(<VideoInputBar />)
      expect(html).toContain(`max="${max}"`)
      expect(html).toContain(`value="${max}"`)
      for (const label of ['480P', '768P', '1080P', '2K']) expect(html).toContain(`>${label}</button>`)
    },
  )

  it.each([['480p', 3, 73.25], ['768p', 5, 111.25]] as const)(
    'shows doubled H3 %s rates and all reference costs at 16 seconds', (resolution, rate, estimate) => {
      draft.state.model = 'MiniMax-H3'
      draft.state.inputMode = 'reference'
      draft.state.params = normalizeVideoParams({ resolution, duration: 16 }, 'MiniMax-H3', 'ref2v')
      draft.state.refImageIds = Array.from({ length: 6 }, (_, i) => `image-${i}`)
      draft.state.refVideoIds = ['clip']
      draft.state.refAudioIds = ['audio']
      draft.state.refItems = [
        ...(draft.state.refImageIds as string[]).map(id => ({ id, type: 'image' })),
        { id: 'clip', type: 'video' }, { id: 'audio', type: 'audio' },
      ]
      media.metadata = { clip: { duration: 12 }, audio: { duration: 15 } }
      const html = renderToStaticMarkup(<VideoInputBar />)
      expect(html).toContain(`MiniMax H3 · ${rate} 积分/秒起`)
      expect(html).toContain(`创建（预估 ${estimate} 积分）`)
    },
  )
  it.each([['768p', '23.75'], ['2k', '46.25']] as const)('includes active H3 references in the %s creation estimate', (resolution, estimate) => {
    draft.state.model = 'MiniMax-H3'
    draft.state.inputMode = 'reference'
    draft.state.params = normalizeVideoParams({ resolution, duration: 4 }, 'MiniMax-H3', 'ref2v')
    draft.state.refImageIds = Array.from({ length: 7 }, (_, i) => `image-${i}`)
    draft.state.refVideoIds = ['clip-a', 'clip-b']
    draft.state.refAudioIds = ['audio']
    draft.state.refItems = [
      ...(draft.state.refImageIds as string[]).map(id => ({ id, type: 'image' })),
      { id: 'clip-a', type: 'video' }, { id: 'clip-b', type: 'video' }, { id: 'audio', type: 'audio' },
    ]
    media.metadata = { 'clip-a': { duration: 4 }, 'clip-b': { duration: 6 }, audio: { duration: 15 } }
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain(`创建（预估 ${estimate} 积分）`)
    draft.state.inputMode = 'create'
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain(`创建（预估 ${resolution === '2k' ? 20 : 10} 积分）`)
  })
  it('keeps fractional image credits and waits for unknown reference-video durations', () => {
    draft.state.model = 'MiniMax-H3'
    draft.state.inputMode = 'reference'
    draft.state.params = normalizeVideoParams({ duration: 4 }, 'MiniMax-H3', 'ref2v')
    draft.state.refImageIds = Array.from({ length: 6 }, (_, i) => `image-${i}`)
    draft.state.refItems = (draft.state.refImageIds as string[]).map(id => ({ id, type: 'image' }))
    expect(renderToStaticMarkup(<VideoInputBar />)).toContain('创建（预估 10.625 积分）')
    draft.state.refVideoIds = ['unknown-clip']
    draft.state.refItems = [...draft.state.refItems as VideoReferenceItem[], { id: 'unknown-clip', type: 'video' }]
    const html = renderToStaticMarkup(<VideoInputBar />)
    expect(html).toContain('创建（费用待估算）')
    expect(html).toContain('参考视频时长尚未读取，完整费用待估算')
    expect(html).not.toContain('创建（预估 10.625 积分）')
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
