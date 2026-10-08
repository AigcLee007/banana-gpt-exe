import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useVideoStore } from '../videoStore'
import { useStore } from '../store'
import { getMediaBlobUrl } from '../lib/videoDb'
import VideoPromptEditor from './VideoPromptEditor'
import { useVideoMediaMetadata } from '../hooks/useVideoMediaMetadata'
import { useVideoAssetStore } from '../videoAssetStore'
import { resolveVideoAssetToMediaReference } from '../lib/videoAssetBridge'
import type { VideoReferenceItem } from '../lib/videoTypes'
import { serializeVideoPrompt, getFrameReferences } from '../lib/videoPromptMentions'
import { VideoImageIcon, VideoFilmIcon, VideoAudioIcon } from './VideoMediaIcons'
import { useMediaBlobUrl } from '../hooks/useMediaBlobUrl'
import { getAllVideoModels, getVideoModelDefinition, getVideoModelPriceLabel, estimateVideoCredits, formatVideoResolution, type VideoResolution } from '../lib/videoModels'
import Select from './Select'
import ReferenceTile from './ReferenceTile'
import VideoModelLogo from './VideoModelLogo'

const MODEL_GUIDANCE_STYLES = {
  recommended: {
    badge: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
    description: 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  },
  warning: {
    badge: 'bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300',
    description: 'bg-orange-500/5 text-orange-700 dark:text-orange-300',
  },
}

export default function VideoInputBar() {
  const {
    inputMode,
    model,
    params,
    prompt,
    firstFrameId,
    lastFrameId,
    refImageIds,
    refVideoIds,
    refAudioIds,
    refItems,
    isGenerating,
    setInputMode,
    setModel,
    setParams,
    setPrompt,
    setFirstFrame,
    setLastFrame,
    addRefImage,
    removeRefImage,
    removeRefVideo,
    removeRefAudio,
    uploadFile,
    generateVideo,
  } = useVideoStore()

  const firstFrameInputRef = useRef<HTMLInputElement>(null)
  const lastFrameInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const assetLibrary = useVideoAssetStore((state) => state.assets)
  const [library, setLibrary] = useState<VideoReferenceItem[]>([])
  useEffect(() => {
    setLibrary(assetLibrary.map((asset) => ({ id: asset.id, type: asset.type })))
  }, [assetLibrary])
  const modelDef = getVideoModelDefinition(model)
  const supportsTailFrame = Boolean(modelDef?.modes.flf2v)
  const refSpec = modelDef?.modes.ref2v
  const referenceMode = inputMode === 'reference' && Boolean(refSpec)
  const maxImages = refSpec?.maxImages ?? 0
  const maxVideos = refSpec?.maxVideos ?? 0
  const maxAudios = refSpec?.maxAudios ?? 0
  const imageAccept = modelDef?.imageMimeTypes?.join(',') ?? 'image/*'
  const frameReferences = getFrameReferences(firstFrameId, supportsTailFrame ? lastFrameId : null)
  const metadata = useVideoMediaMetadata([...refItems.map((item) => item.id), ...frameReferences.map((item) => item.id), ...library.map((item) => item.id)])
  const editorReferences = referenceMode ? refItems : frameReferences
  const editorLibrary = library.filter((item) => referenceMode ? (item.type === 'image' ? maxImages : item.type === 'video' ? maxVideos : maxAudios) > 0 : item.type === 'image')
  const addEditorLibrary = async (item: VideoReferenceItem): Promise<VideoReferenceItem> => {
    const asset = useVideoAssetStore.getState().assets.find((candidate) => candidate.id === item.id)
    const reference = asset ? await resolveVideoAssetToMediaReference(asset) : item
    const state = useVideoStore.getState()
    const definition = getVideoModelDefinition(state.model)
    if (state.inputMode === 'reference' && definition?.modes.ref2v) {
      state.addReference(reference)
      return reference
    }
    if (reference.type !== 'image') throw new Error('文/图生视频只能引用图片')
    if (reference.id === state.firstFrameId || reference.id === state.lastFrameId) return reference
    if (!state.firstFrameId) state.setFirstFrame(reference.id)
    else if (definition?.modes.flf2v && !state.lastFrameId) state.setLastFrame(reference.id)
    else throw new Error('图片已满，请先移除一张图片')
    return reference
  }
  const secondsFor = (type: 'video' | 'audio') => refItems.filter((item) => item.type === type).reduce((sum, item) => sum + (metadata[item.id]?.duration ?? 0), 0)
  const durationText = (type: 'video' | 'audio') => {
    const unknown = refItems.some((item) => item.type === type && metadata[item.id]?.duration === undefined)
    return `${secondsFor(type).toFixed(1).replace(/\.0$/, '')}s${unknown ? '，部分时长未知' : ''}`
  }
  let missingReference = false
  try { serializeVideoPrompt(prompt, editorReferences) } catch { missingReference = true }
  const estimatedCredits = estimateVideoCredits(model, params.duration, params.resolution, refImageIds.length, 0, params.n)
  const canGenerate = (Boolean(prompt.trim()) || (modelDef?.allowsImageOnly && Boolean(firstFrameId))) && !uploadBusy && !missingReference && !(supportsTailFrame && !referenceMode && lastFrameId && !firstFrameId) && (!referenceMode || refItems.length > 0)

  const upload = (target: 'reference' | 'first' | 'last') => {
    if (uploadBusy) return
    const input = target === 'reference' ? referenceInputRef.current
      : target === 'first' ? firstFrameInputRef.current : lastFrameInputRef.current
    if (input) { input.value = ''; input.click() }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>, target: 'reference' | 'first' | 'last') => {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    if (!files.length) return
    setUploadBusy(true)
    setUploadError(null)
    setUploadMessage(null)
    try {
      const added: string[] = []
      for (const file of files) {
        if (target === 'first' || target === 'last') {
          if (!file.type.startsWith('image/')) throw new Error('请选择图片文件（image/*）')
          const id = await uploadFile(file)
          const current = useVideoStore.getState()
          if (target === 'first') current.setFirstFrame(id)
          else current.setLastFrame(id)
        } else {
          const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null
          const current = useVideoStore.getState()
          if (!type) continue
          const spec = getVideoModelDefinition(current.model)?.modes.ref2v
          const limit = (type === 'image' ? spec?.maxImages : type === 'video' ? spec?.maxVideos : spec?.maxAudios) ?? 0
          if (!limit) throw new Error('当前模型不支持该类型参考素材')
          if (current.refItems.filter((item) => item.type === type).length >= limit) throw new Error(`该类型素材最多 ${limit} 个`)
          const id = await uploadFile(file)
          if (type === 'image') current.addRefImage(id)
          if (type === 'video') current.addRefVideo(id)
          if (type === 'audio') current.addRefAudio(id)
        }
        added.push(file.name)
      }
      if (added.length) setUploadMessage(`已添加：${added.join('、')}`)
    } catch (error) {
      const message = `素材上传失败：${error instanceof Error ? error.message : String(error)}`
      setUploadError(message)
      useStore.getState().showToast(message, 'error')
    } finally {
      setUploadBusy(false)
      input.value = ''
    }
  }

  const modelOptions = getAllVideoModels().map((item) => ({
    value: item.model,
    label: (
      <span className="inline-flex min-w-0 max-w-full items-center gap-2">
        <VideoModelLogo logo={item.logo} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{item.displayName}</span>
        {item.guidance && <span data-video-model-badge className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ring-1 ring-inset ${MODEL_GUIDANCE_STYLES[item.guidance.tone].badge}`}>{item.guidance.label}</span>}
      </span>
    ),
    secondaryLabel: getVideoModelPriceLabel(item.model, params.resolution),
  }))
  const duration = modelDef?.duration ?? { min: 4, max: 15, step: 1, default: 4 }
  const ratioOptions = modelDef?.aspectRatios ?? ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

  return (
    <div data-video-creation-panel className="w-full overflow-hidden rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] shadow-[var(--app-shadow)]">
      <div className="flex items-center border-b border-[color:var(--app-border)] p-2">
        <div className="flex flex-1 items-center justify-center gap-2">
          <button type="button" onClick={() => setInputMode('create')} className={`rounded-xl px-6 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${!referenceMode ? 'bg-blue-500 text-white shadow-sm' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)] hover:text-[color:var(--app-text)]'}`}>{supportsTailFrame ? '文/图生视频' : '文生视频 / 单图生视频'}</button>
          {refSpec && <button type="button" onClick={() => setInputMode('reference')} className={`rounded-xl px-6 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${referenceMode ? 'bg-blue-500 text-white shadow-sm' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-surface-elevated)] hover:text-[color:var(--app-text)]'}`}>{maxVideos || maxAudios ? '多参考' : '参考图'}</button>}
        </div>
      </div>

      <section className="border-b border-[color:var(--app-border)] p-4">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[color:var(--app-text-muted)]"><span>提示词</span><button type="button" onClick={() => setPrompt('')} className="hover:text-[color:var(--app-text)]">一键清空</button></div>
        <VideoPromptEditor
          value={prompt} onChange={setPrompt} references={editorReferences} metadata={metadata}
          library={editorLibrary}
          onAddLibrary={addEditorLibrary}
          maxLength={modelDef?.maxPromptChars ?? 2000}
          placeholder={referenceMode ? maxVideos || maxAudios ? '描述你想生成的内容。输入 @ 选择图片、视频或音频素材' : '描述视频内容，输入 @ 选择参考图片' : supportsTailFrame ? '描述画面、主体动作和镜头运动，输入 @ 引用起始帧或结束帧' : '描述视频内容，可上传一张图片进行单图生视频'}
        />
        {missingReference && <p role="alert" className="mt-2 text-xs text-red-500">引用素材已移除或不在当前模式中，请删除标签或重新添加素材。</p>}
      </section>

      {!referenceMode ? (
        <section className="border-b border-[color:var(--app-border)] p-4">
          <div className="mb-2 text-xs font-semibold text-[color:var(--app-text-muted)]">图片 <span className="font-normal">{supportsTailFrame ? '设置首帧和末帧，控制视频开始与结束' : '可选一张图片进行单图生视频'}</span></div>
          <div className="grid grid-cols-2 gap-2">
            <FrameSlot label={supportsTailFrame ? '起始帧' : '参考图片'} id={firstFrameId} onAdd={() => upload('first')} onRemove={() => { if (supportsTailFrame && lastFrameId) { setFirstFrame(lastFrameId); setLastFrame(null) } else setFirstFrame(null) }} />
            {supportsTailFrame && <FrameSlot label="结束帧" id={lastFrameId} onAdd={() => upload('last')} onRemove={() => setLastFrame(null)} />}
          </div>
          {modelDef?.maxImageBytes && <p className="mt-2 text-xs text-[color:var(--app-text-muted)]">JPEG / JPG / PNG / WEBP，单张最多 {modelDef.maxImageBytes / (1024 * 1024)} MB</p>}
        </section>
      ) : (
        <section className="border-b border-[color:var(--app-border)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[color:var(--app-text-muted)]">
            <span>参考素材</span>
            <div className="flex flex-wrap gap-1.5 font-normal">
              {maxImages > 0 && <span aria-label={`图片 ${refImageIds.length}/${maxImages}`} className="inline-flex items-center gap-1 rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-1 text-blue-500"><VideoImageIcon className="h-3.5 w-3.5 shrink-0" />{refImageIds.length}/{maxImages}</span>}
              {maxVideos > 0 && <span aria-label={`视频 ${refVideoIds.length}/${maxVideos}`} className="inline-flex items-center gap-1 rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-1 text-purple-500" title="参考视频总时长"><VideoFilmIcon className="h-3.5 w-3.5 shrink-0" />{refVideoIds.length}/{maxVideos} ({durationText('video')})</span>}
              {maxAudios > 0 && <span aria-label={`音频 ${refAudioIds.length}/${maxAudios}`} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--app-border)] px-2 py-1"><VideoAudioIcon className="h-3.5 w-3.5 shrink-0" />{refAudioIds.length}/{maxAudios} ({durationText('audio')})</span>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => upload('reference')} className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-[color:var(--app-border)] text-2xl text-[color:var(--app-text-muted)]">+</button>
            {refItems.map((item, index) => <ReferenceTile key={item.id} index={index + 1} item={item} onRemove={() => item.type === 'image' ? removeRefImage(item.id) : item.type === 'video' ? removeRefVideo(item.id) : removeRefAudio(item.id)} />)}
          </div>
          {modelDef?.maxImageBytes && <p className="mt-2 text-xs text-[color:var(--app-text-muted)]">JPEG / JPG / PNG / WEBP，单张最多 {modelDef.maxImageBytes / (1024 * 1024)} MB</p>}
        </section>
      )}

      <section className="p-4">
          <ParamRow label="模型"><div className="min-w-0 flex-1"><Select value={model} onChange={(v) => setModel(String(v))} options={modelOptions} triggerTitle={`${modelDef?.displayName ?? model} · ${getVideoModelPriceLabel(model, params.resolution)}`} menuClassName="right-0 min-w-[min(320px,calc(100vw-4rem))]" className="w-full rounded-lg border-0 bg-[color:var(--app-input)] px-3 py-2 text-sm text-[color:var(--app-text)]" /></div></ParamRow>
          {modelDef?.guidance && <p data-testid="video-model-guidance" role="status" className={`my-2 rounded-lg px-2 py-1.5 text-xs leading-relaxed ${MODEL_GUIDANCE_STYLES[modelDef.guidance.tone].description}`}>{modelDef.guidance.description}</p>}
          <ParamRow label="分辨率"><div className="flex h-9 flex-1 rounded-lg bg-[color:var(--app-input)] p-0.5">{(modelDef?.resolutions ?? ['768p']).map((r) => <button key={r} type="button" onClick={() => setParams({ resolution: r })} className={`flex-1 rounded-md text-xs font-semibold ${params.resolution === r ? 'bg-blue-500 text-white' : 'text-[color:var(--app-text-muted)]'}`}>{formatVideoResolution(r)}</button>)}</div></ParamRow>
          <ParamRow label="时长">{duration.min === duration.max ? <span className="text-sm">{duration.default}秒</span> : <div className="flex-1 px-1"><input type="range" min={duration.min} max={duration.max} step={duration.step} value={params.duration} onChange={(e) => setParams({ duration: Number(e.target.value) })} className="w-full accent-blue-500" /><div className="flex justify-between text-[10px] text-[color:var(--app-text-subtle)]"><span>{duration.min}秒</span><b className="text-[color:var(--app-text)]">{params.duration}秒</b><span>{duration.max}秒</span></div></div>}</ParamRow>
          <ParamRow label="画面比例"><div className="flex h-9 flex-1 overflow-hidden rounded-lg bg-[color:var(--app-input)]">{ratioOptions.map((ratio) => <button key={ratio} type="button" onClick={() => setParams({ aspectRatio: ratio })} className={`flex-1 text-[10px] ${params.aspectRatio === ratio ? 'bg-blue-500 text-white' : 'text-[color:var(--app-text-muted)]'}`}>{ratio === 'auto' ? '自动' : ratio}</button>)}</div></ParamRow>
          <ParamRow label="数量">{modelDef?.fixedQuantity ? <span className="text-sm">1个</span> : <div className="flex h-9 flex-1 rounded-lg bg-[color:var(--app-input)] p-0.5">{[1, 2, 4].map((n) => <button key={n} type="button" onClick={() => setParams({ n })} className={`flex-1 rounded-md text-xs font-semibold ${params.n === n ? 'bg-blue-500 text-white' : 'text-[color:var(--app-text-muted)]'}`}>{n}个</button>)}</div>}</ParamRow>
          <button data-testid="video-submit" type="button" disabled={!canGenerate || isGenerating} onClick={generateVideo} className="mt-3 w-full rounded-xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{isGenerating ? '正在创建…' : modelDef?.pricePerRequestCredits !== undefined || modelDef?.pricePerSecondCredits ? `✈ 创建（${estimatedCredits.toFixed(1)} 积分）` : '✈ 创建'}</button>
      </section>

      {uploadBusy && <p role="status" className="px-4 text-sm text-[color:var(--app-text-muted)]">正在保存素材，请稍候…</p>}
      {uploadMessage && <p role="status" className="px-4 pb-3 text-sm text-[color:var(--app-text-muted)]">{uploadMessage}</p>}
      {uploadError && <p role="alert" className="px-4 pb-3 text-sm text-red-500">{uploadError}</p>}
      <input data-testid="video-first-file" ref={firstFrameInputRef} type="file" accept={imageAccept} onChange={(event) => handleFileChange(event, 'first')} className="hidden" />
      {supportsTailFrame && <input data-testid="video-last-file" ref={lastFrameInputRef} type="file" accept="image/*" onChange={(event) => handleFileChange(event, 'last')} className="hidden" />}
      {refSpec && <input data-testid="video-reference-file" ref={referenceInputRef} type="file" accept={[imageAccept, ...(maxVideos ? ['video/*'] : []), ...(maxAudios ? ['audio/*'] : [])].join(',')} multiple onChange={(event) => handleFileChange(event, 'reference')} className="hidden" />}
    </div>
  )
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-2"><span className="w-14 shrink-0 text-xs font-semibold text-[color:var(--app-text-muted)]">{label}</span>{children}</div>
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[color:var(--app-text-muted)]">{label}</span>{children}</label>
}

function FrameSlot({ label, id, onAdd, onRemove }: { label: string; id: string | null; onAdd: () => void; onRemove: () => void }) {
  const url = useMediaBlobUrl(id, getMediaBlobUrl)
  return <div className="relative flex min-h-24 flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-[color:var(--app-border)] bg-[color:var(--app-input)]">{url ? <img src={url} alt={label} className="absolute inset-0 h-full w-full object-cover" /> : <button type="button" onClick={onAdd} className="z-10 p-4 text-center text-xs text-[color:var(--app-text-muted)]"><span className="mb-1 block text-xl">＋</span>{label}</button>}{id && <><span className="absolute bottom-1 left-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{label}</span><button type="button" onClick={onRemove} className="absolute right-1 top-1 z-10 h-6 w-6 rounded-full bg-black/60 text-white">×</button></>}</div>
}
