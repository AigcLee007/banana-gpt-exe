import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { useStore, ensureImageCached } from '../store'
import { getColorEditRecord, getColorEditVersions, getImage, storeColorEditedImage } from '../lib/db'
import { resolveColorEditSession } from '../lib/colorEditVersions'
import {
  createDefaultColorAdjustments,
  getNeutralWhiteBalance,
  normalizeColorAdjustments,
  parseCubeLut,
  type ColorAdjustments,
  type ColorChannel,
  type ColorHistogram,
  type HueRange,
} from '../lib/colorGrading'
import { createColorGradingRenderer, type ColorGradingRenderer, type ImageDimensions } from '../lib/colorGradingRenderer'
import ColorAssistantPanel from './ColorAssistantPanel'
import ColorParameterHelp from './ColorParameterHelp'
import { CloseIcon } from './icons'
import { getColorParameterHelp } from '../lib/colorParameterHelp'
import './ColorGradingEditor.css'

type ImageFormat = 'image/png' | 'image/jpeg' | 'image/webp'
type RenderState = 'idle' | 'loading' | 'ready' | 'error'

const CHANNELS: ColorChannel[] = ['master', 'red', 'green', 'blue']
const QUICK_PREVIEW_EDGE = 640
const HIGH_QUALITY_PREVIEW_DELAY_MS = 450
const CHANNEL_LABELS: Record<ColorChannel, string> = { master: '总通道', red: '红色', green: '绿色', blue: '蓝色' }
const HUE_RANGES: HueRange[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']
const HUE_LABELS: Record<HueRange, string> = {
  red: '红色', orange: '橙色', yellow: '黄色', green: '绿色', cyan: '青色', blue: '蓝色', purple: '紫色', magenta: '洋红',
}
const BASIC_CONTROLS: Array<{ key: keyof ColorAdjustments['basic']; label: string; min: number; max: number; step: number; suffix?: string }> = [
  { key: 'exposure', label: '曝光', min: -5, max: 5, step: 0.01, suffix: ' EV' },
  { key: 'contrast', label: '对比度', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: '高光', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: '阴影', min: -100, max: 100, step: 1 },
  { key: 'whites', label: '白场', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: '黑场', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: '饱和度', min: -100, max: 100, step: 1 },
  { key: 'vibrance', label: '自然饱和度', min: -100, max: 100, step: 1 },
]
const LEVEL_CONTROLS = [
  { key: 'inputBlack', label: '输入黑场', min: 0, max: 254, step: 1 },
  { key: 'inputWhite', label: '输入白场', min: 1, max: 255, step: 1 },
  { key: 'gamma', label: '伽马', min: 0.01, max: 9.99, step: 0.01 },
  { key: 'outputBlack', label: '输出黑场', min: 0, max: 255, step: 1 },
  { key: 'outputWhite', label: '输出白场', min: 0, max: 255, step: 1 },
] as const

export default function ColorGradingEditor() {
  const imageId = useStore((state) => state.colorGradingImageId)
  const setImageId = useStore((state) => state.setColorGradingImageId)
  const showToast = useStore((state) => state.showToast)
  const [renderState, setRenderState] = useState<RenderState>('idle')
  const [error, setError] = useState('')
  const [sourceImageId, setSourceImageId] = useState('')
  const [parentImageId, setParentImageId] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewRecipeKey, setPreviewRecipeKey] = useState('')
  const [previewImageId, setPreviewImageId] = useState('')
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  const [histogram, setHistogram] = useState<ColorHistogram | null>(null)
  const [adjustments, setAdjustments] = useState<ColorAdjustments>(() => createDefaultColorAdjustments())
  const [undoStack, setUndoStack] = useState<ColorAdjustments[]>([])
  const [redoStack, setRedoStack] = useState<ColorAdjustments[]>([])
  const [versions, setVersions] = useState<Array<{ id: string; createdAt: number }>>([])
  const [showOriginal, setShowOriginal] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [curveChannel, setCurveChannel] = useState<ColorChannel>('master')
  const [selectedCurvePoint, setSelectedCurvePoint] = useState<number | null>(null)
  const [dragCurvePoint, setDragCurvePoint] = useState<number | null>(null)
  const [sampleMode, setSampleMode] = useState(false)
  const [imageFormat, setImageFormat] = useState<ImageFormat>('image/png')
  const [quality, setQuality] = useState(92)
  const [isRendering, setIsRendering] = useState(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [lutLabel, setLutLabel] = useState('')
  const rendererRef = useRef<ColorGradingRenderer | null>(null)
  const exportAbortRef = useRef<AbortController | null>(null)
  const sourceImageRef = useRef<HTMLImageElement>(null)
  const previewRevisionRef = useRef(0)
  const adjustmentsRef = useRef(adjustments)
  const adjustmentKey = JSON.stringify(adjustments)
  adjustmentsRef.current = adjustments

  const close = useCallback(() => {
    exportAbortRef.current?.abort()
    setSampleMode(false)
    setImageId(null)
  }, [setImageId])

  useEffect(() => {
    if (!imageId) {
      setRenderState('idle')
      return
    }

    let cancelled = false
    let createdRenderer: ColorGradingRenderer | null = null
    setRenderState('loading')
    setError('')
    setPreviewUrl('')
    setPreviewRecipeKey('')
    setPreviewImageId('')
    setHistogram(null)
    setSampleMode(false)
    setUndoStack([])
    setRedoStack([])
    setShowOriginal(false)

    void (async () => {
      const selectedImage = await getImage(imageId)
      if (!selectedImage) throw new Error('图片已从本地图库中移除')
      const record = await getColorEditRecord(imageId)
      const session = resolveColorEditSession(imageId, record)
      const sourceImage = await getImage(session.sourceImageId)
      if (!sourceImage) throw new Error('调色版本的原图已不存在')
      createdRenderer = createColorGradingRenderer()
      const sourceBlob = await (await fetch(sourceImage.dataUrl)).blob()
      const imageDimensions = await createdRenderer.load(sourceBlob)
      if (cancelled) {
        createdRenderer.dispose()
        return
      }
      rendererRef.current = createdRenderer
      setSourceImageId(session.sourceImageId)
      setParentImageId(session.parentImageId)
      setSourceUrl(sourceImage.dataUrl)
      setDimensions(imageDimensions)
      adjustmentsRef.current = session.adjustments
      setAdjustments(session.adjustments)
      setVersions((await getColorEditVersions(session.sourceImageId)).map(({ id, createdAt }) => ({ id, createdAt })))
      setLutLabel(session.adjustments.lut?.title ?? '')
      setRenderState('ready')
    })().catch((cause: unknown) => {
      if (cancelled) return
      setError(cause instanceof Error ? cause.message : '图片载入失败')
      setRenderState('error')
    })

    return () => {
      cancelled = true
      createdRenderer?.dispose()
      if (rendererRef.current === createdRenderer) rendererRef.current = null
    }
  }, [imageId])

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    if (renderState !== 'ready' || !rendererRef.current) return
    let cancelled = false
    const revision = ++previewRevisionRef.current
    const renderedRecipeKey = adjustmentKey
    let finalTimeout = 0
    const renderPreview = (maxEdge: number) => {
      setIsRendering(true)
      return rendererRef.current!.renderPreview(adjustments, maxEdge).then(async ({ bitmap, histogram: nextHistogram }) => {
        const nextUrl = await imageBitmapToObjectUrl(bitmap)
        bitmap.close()
        if (cancelled || revision !== previewRevisionRef.current) {
          URL.revokeObjectURL(nextUrl)
          return false
        }
        setPreviewUrl(nextUrl)
        setPreviewRecipeKey(renderedRecipeKey)
        setPreviewImageId(imageId ?? '')
        setHistogram(nextHistogram)
        setIsRendering(false)
        return true
      }).catch((cause: unknown) => {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return false
        setError(cause instanceof Error ? cause.message : '预览渲染失败')
        setIsRendering(false)
        return false
      })
    }
    const quickTimeout = window.setTimeout(() => {
      void renderPreview(QUICK_PREVIEW_EDGE).then((rendered) => {
        if (rendered && !cancelled && revision === previewRevisionRef.current) {
          finalTimeout = window.setTimeout(() => { void renderPreview(1200) }, HIGH_QUALITY_PREVIEW_DELAY_MS)
        }
      })
    }, 40)
    return () => {
      cancelled = true
      window.clearTimeout(quickTimeout)
      if (finalTimeout) window.clearTimeout(finalTimeout)
    }
  }, [adjustments, adjustmentKey, imageId, renderState])

  useEffect(() => {
    if (!imageId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [close, imageId])

  const versionsByDate = useMemo(() => [...versions].sort((a, b) => b.createdAt - a.createdAt), [versions])

  const changeAdjustments = useCallback((change: (next: ColorAdjustments) => void) => {
    const next = structuredClone(adjustments)
    change(next)
    setUndoStack((stack) => [...stack.slice(-49), adjustments])
    setRedoStack([])
    adjustmentsRef.current = next
    setAdjustments(next)
  }, [adjustments])

  const undo = useCallback(() => {
    if (undoStack.length === 0) return
    setRedoStack([...redoStack, adjustments])
    const next = undoStack[undoStack.length - 1]
    adjustmentsRef.current = next
    setAdjustments(next)
    setUndoStack(undoStack.slice(0, -1))
  }, [adjustments, redoStack, undoStack])

  const redo = useCallback(() => {
    if (redoStack.length === 0) return
    setUndoStack([...undoStack.slice(-49), adjustments])
    const next = redoStack[redoStack.length - 1]
    adjustmentsRef.current = next
    setAdjustments(next)
    setRedoStack(redoStack.slice(0, -1))
  }, [adjustments, redoStack, undoStack])

  const resetAll = () => {
    changeAdjustments((next) => Object.assign(next, createDefaultColorAdjustments()))
    setLutLabel('')
  }

  const sampleNeutralPoint = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!sampleMode) return
    event.stopPropagation()
    const image = sourceImageRef.current
    if (!image?.complete || !image.naturalWidth) {
      showToast('原图仍在读取，请稍后取样', 'info')
      return
    }
    const rect = image.getBoundingClientRect()
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
    const displayedWidth = image.naturalWidth * scale
    const displayedHeight = image.naturalHeight * scale
    const left = rect.left + (rect.width - displayedWidth) / 2
    const top = rect.top + (rect.height - displayedHeight) / 2
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor((event.clientX - left) / scale)))
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor((event.clientY - top) / scale)))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      showToast('当前浏览器无法读取采样像素', 'error')
      return
    }
    try {
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1)
      const sample = context.getImageData(0, 0, 1, 1).data
      const whiteBalance = getNeutralWhiteBalance([sample[0], sample[1], sample[2]])
      changeAdjustments((next) => { next.whiteBalance = whiteBalance })
      setSampleMode(false)
      showToast('已应用手动中性点取样', 'success')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '中性点取样失败', 'error')
    }
  }

  const saveVersion = async () => {
    if (!rendererRef.current || !sourceImageId || !parentImageId) return
    try {
      const blob = await renderFullResolution()
      const dataUrl = await blobToDataUrl(blob)
      const savedId = await storeColorEditedImage(dataUrl, sourceImageId, parentImageId, normalizeColorAdjustments(adjustments))
      await ensureImageCached(savedId)
      setParentImageId(savedId)
      setVersions((await getColorEditVersions(sourceImageId)).map(({ id, createdAt }) => ({ id, createdAt })))
      showToast('已保存为独立调色版本', 'success')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : '保存版本失败')
      showToast(cause instanceof Error ? cause.message : '保存版本失败', 'error')
    } finally {
      setExportProgress(null)
      exportAbortRef.current = null
    }
  }

  const exportImage = async () => {
    try {
      const blob = await renderFullResolution()
      const extension = imageFormat.split('/')[1]
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `color-grade-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
      anchor.click()
      URL.revokeObjectURL(url)
      showToast('已导出原尺寸调色图片', 'success')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : '导出失败')
      showToast(cause instanceof Error ? cause.message : '导出失败', 'error')
    } finally {
      setExportProgress(null)
      exportAbortRef.current = null
    }
  }

  const renderFullResolution = async () => {
    if (!rendererRef.current) throw new Error('图片尚未载入')
    const controller = new AbortController()
    exportAbortRef.current = controller
    setExportProgress(0)
    return rendererRef.current.exportImage(
      normalizeColorAdjustments(adjustments), imageFormat, quality / 100,
      (progress) => setExportProgress(progress), controller.signal,
    )
  }

  const loadVersion = async (versionId: string) => {
    try {
      const record = await getColorEditRecord(versionId)
      if (!record) throw new Error('调色版本记录已不存在')
      const session = resolveColorEditSession(versionId, record)
      setSourceImageId(session.sourceImageId)
      setParentImageId(session.parentImageId)
      changeAdjustments((next) => Object.assign(next, session.adjustments))
      setShowOriginal(false)
      setLutLabel(session.adjustments.lut?.title ?? '')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '载入版本失败', 'error')
    }
  }

  const importLut = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const lut = parseCubeLut(await file.text())
      if (!lut.title) lut.title = file.name
      changeAdjustments((next) => { next.lut = lut })
      setLutLabel(lut.title ?? file.name)
      showToast('已载入 3D LUT', 'success')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'LUT 文件无效', 'error')
    }
  }

  const updateCurvePoint = (index: number, x: number, y: number) => {
    const current = curvePoints(adjustments.curves[curveChannel])
    const sorted = [...current].sort((a, b) => a.x - b.x)
    const minimumX = index === 0 ? 0 : sorted[index - 1].x + 0.005
    const maximumX = index === sorted.length - 1 ? 1 : sorted[index + 1].x - 0.005
    const nextX = index === 0 || index === sorted.length - 1 ? sorted[index].x : clamp(x, minimumX, maximumX)
    const nextY = clamp(y, 0, 1)
    changeAdjustments((next) => {
      const points = curvePoints(next.curves[curveChannel])
      points[index] = { x: nextX, y: nextY }
      next.curves[curveChannel] = points
    })
  }

  const beginCurvePointDrag = (index: number) => {
    setSelectedCurvePoint(index)
    setDragCurvePoint(index)
    setUndoStack((stack) => [...stack.slice(-49), adjustments])
    setRedoStack([])
  }

  const moveCurvePoint = (index: number, x: number, y: number) => {
    const points = curvePoints(adjustments.curves[curveChannel])
    const minimumX = index === 0 ? 0 : points[index - 1].x + 0.005
    const maximumX = index === points.length - 1 ? 1 : points[index + 1].x - 0.005
    const nextX = index === 0 || index === points.length - 1 ? points[index].x : clamp(x, minimumX, maximumX)
    points[index] = { x: nextX, y: clamp(y, 0, 1) }
    const next = structuredClone(adjustments)
    next.curves[curveChannel] = points
    adjustmentsRef.current = next
    setAdjustments(next)
  }

  const removeCurvePoint = (index: number) => {
    const points = curvePoints(adjustments.curves[curveChannel])
    if (index === 0 || index === points.length - 1 || points.length <= 2) return
    points.splice(index, 1)
    changeAdjustments((next) => { next.curves[curveChannel] = points })
    setSelectedCurvePoint(null)
  }

  const assistantPreviewReady = renderState === 'ready'
    && Boolean(previewUrl)
    && previewImageId === imageId
    && previewRecipeKey === adjustmentKey
    && !isRendering
    && !showOriginal
    && !sampleMode

  const applyAssistantProposal = (next: ColorAdjustments, base: ColorAdjustments, candidateImageId: string) => {
    const previous = adjustmentsRef.current
    if (candidateImageId !== imageId || JSON.stringify(previous) !== JSON.stringify(base)) return false
    changeAdjustments((current) => Object.assign(current, structuredClone(next)))
    setShowOriginal(false)
    setSampleMode(false)
    setSelectedCurvePoint(null)
    setDragCurvePoint(null)
    setLutLabel(next.lut?.title ?? '')
    return true
  }

  if (!imageId) return null

  return (
    <div className="color-editor-backdrop">
      <section className="color-editor" role="dialog" aria-modal="true" aria-label="图片调色器">
        <header className="color-editor-header">
          <div className="color-editor-title">
            <strong>图片调色</strong>
            {dimensions && <span>{dimensions.width.toLocaleString()} × {dimensions.height.toLocaleString()} px</span>}
          </div>
          <div className="color-editor-actions">
            <button type="button" title="撤销" aria-label="撤销" disabled={!undoStack.length || renderState !== 'ready'} onClick={undo}>↶</button>
            <button type="button" title="重做" aria-label="重做" disabled={!redoStack.length || renderState !== 'ready'} onClick={redo}>↷</button>
            <button type="button" className="color-editor-secondary" disabled={renderState !== 'ready'} onClick={resetAll}>重置</button>
            <button type="button" className="color-editor-secondary" disabled={renderState !== 'ready' || exportProgress !== null} onClick={() => void exportImage()}>{exportProgress === null ? '导出原尺寸' : `${Math.round(exportProgress * 100)}%`}</button>
            <button type="button" className="color-editor-primary" disabled={renderState !== 'ready' || exportProgress !== null} onClick={() => void saveVersion()}>保存版本</button>
            <button type="button" className="color-editor-close" title="关闭调色器" aria-label="关闭调色器" onClick={close}><CloseIcon className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="color-editor-body">
          <main className={`color-editor-preview ${sampleMode ? 'is-sampling' : ''}`}>
            {renderState === 'loading' && <div className="color-editor-state">正在读取图片</div>}
            {renderState === 'error' && <div className="color-editor-state color-editor-error">{error}</div>}
            {renderState === 'ready' && (
              <>
                <div className="color-editor-preview-stage" onClick={(event) => event.stopPropagation()}>
                  <img
                    ref={sourceImageRef}
                    src={showOriginal || sampleMode ? sourceUrl : previewUrl || sourceUrl}
                    alt="调色预览"
                    className="color-editor-preview-image"
                    style={{ transform: `scale(${zoom / 100})`, cursor: sampleMode ? 'crosshair' : 'default' }}
                    onClick={sampleNeutralPoint}
                  />
                  {sampleMode && <div className="color-editor-sample-hint">点击画面中的中性区域取样 <button type="button" onClick={(event) => { event.stopPropagation(); setSampleMode(false) }}>取消</button></div>}
                  {isRendering && <div className="color-editor-rendering">更新预览…</div>}
                </div>
                <div className="color-editor-preview-toolbar">
                  <button type="button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? '返回调色预览' : '查看原图'}</button>
                  <label>缩放
                    <select aria-label="预览缩放" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
                      {[50, 75, 100, 125, 150, 200].map((value) => <option key={value} value={value}>{value}%</option>)}
                    </select>
                  </label>
                  <span>{showOriginal ? '原图' : '调色预览'}</span>
                </div>
              </>
            )}
          </main>

          <aside className="color-editor-controls">
            <ColorAssistantPanel
              imageId={imageId}
              sourceImageId={sourceImageId || imageId}
              adjustments={adjustments}
              previewUrl={previewUrl}
              ready={assistantPreviewReady}
              onApply={applyAssistantProposal}
            />
            {renderState === 'ready' ? (
              <>
                {histogram && <HistogramPanel histogram={histogram} />}
                <details open>
                  <summary>基础调整</summary>
                  <div className="color-editor-control-list">
                    {BASIC_CONTROLS.map(({ key, ...control }) => <NumericSlider
                      key={key} {...control} help={getColorParameterHelp(`basic.${key}`)} value={adjustments.basic[key]}
                      onChange={(value) => changeAdjustments((next) => { next.basic[key] = value })}
                      onReset={() => changeAdjustments((next) => { next.basic[key] = 0 })}
                    />)}
                  </div>
                </details>

                <details open>
                  <summary>白平衡</summary>
                  <div className="color-editor-control-list">
                    <NumericSlider label="色温" help={getColorParameterHelp('whiteBalance.temperature')} min={2000} max={12000} step={10} suffix=" K" value={adjustments.whiteBalance.temperature}
                      onChange={(value) => changeAdjustments((next) => { next.whiteBalance.temperature = value })}
                      onReset={() => changeAdjustments((next) => { next.whiteBalance = createDefaultColorAdjustments().whiteBalance })} />
                    <NumericSlider label="色调" help={getColorParameterHelp('whiteBalance.tint')} min={-100} max={100} step={1} value={adjustments.whiteBalance.tint}
                      onChange={(value) => changeAdjustments((next) => { next.whiteBalance.tint = value })}
                      onReset={() => changeAdjustments((next) => { next.whiteBalance = createDefaultColorAdjustments().whiteBalance })} />
                    <div className="color-editor-tool-row">
                      <button type="button" className="color-editor-wide-button" onClick={() => { setShowOriginal(false); setSampleMode(true) }}>取样中性点</button>
                      <ColorParameterHelp label="取样中性点" description={getColorParameterHelp('whiteBalance.neutralSampler')} />
                    </div>
                  </div>
                </details>

                <details>
                  <summary>色阶与曲线</summary>
                  <div className="color-editor-subheading">色阶通道</div>
                  {CHANNELS.map((channel) => <details className="color-editor-nested" key={channel}>
                    <summary>{CHANNEL_LABELS[channel]}</summary>
                    <div className="color-editor-control-list">
                      {LEVEL_CONTROLS.map(({ key, label, min, max, step }) => <NumericSlider
                        key={key} label={label} help={getColorParameterHelp(`levels.${key}`, CHANNEL_LABELS[channel])} min={min} max={max} step={step} value={adjustments.levels[channel][key]}
                        onChange={(value) => changeAdjustments((next) => {
                          const level = next.levels[channel]
                          if (key === 'inputBlack') level.inputBlack = Math.min(value, level.inputWhite - 1)
                          else if (key === 'inputWhite') level.inputWhite = Math.max(value, level.inputBlack + 1)
                          else if (key === 'outputBlack') level.outputBlack = Math.min(value, level.outputWhite)
                          else if (key === 'outputWhite') level.outputWhite = Math.max(value, level.outputBlack)
                          else level.gamma = value
                        })}
                        onReset={() => changeAdjustments((next) => { next.levels[channel] = createDefaultColorAdjustments().levels[channel] })}
                      />)}
                    </div>
                  </details>)}
                  <div className="color-editor-subheading color-editor-subheading-help"><span>点曲线</span><ColorParameterHelp label="点曲线" description={getColorParameterHelp('curves.points')} /></div>
                  <div className="color-editor-channel-tabs" role="group" aria-label="曲线通道">
                    {CHANNELS.map((channel) => <button type="button" key={channel} aria-pressed={curveChannel === channel} onClick={() => setCurveChannel(channel)}>{CHANNEL_LABELS[channel]}</button>)}
                  </div>
                  <div className="color-editor-curve-reset">
                    <button type="button" onClick={() => {
                      changeAdjustments((next) => { next.curves[curveChannel] = [] })
                      setSelectedCurvePoint(null)
                    }}>重置{CHANNEL_LABELS[curveChannel]}曲线</button>
                  </div>
                  <CurveEditor
                    channel={curveChannel}
                    points={curvePoints(adjustments.curves[curveChannel])}
                    selectedIndex={selectedCurvePoint}
                    onAdd={(x, y) => {
                      const points = [...curvePoints(adjustments.curves[curveChannel]), { x, y }].sort((a, b) => a.x - b.x)
                      changeAdjustments((next) => { next.curves[curveChannel] = points })
                    }}
                    onPointerDown={beginCurvePointDrag}
                    onPointerMove={(event) => {
                      if (dragCurvePoint === null) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      moveCurvePoint(dragCurvePoint, (event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height)
                    }}
                    onPointerUp={() => setDragCurvePoint(null)}
                    onSelect={setSelectedCurvePoint}
                    onKeyPoint={(index, x, y) => updateCurvePoint(index, x, y)}
                    onRemove={removeCurvePoint}
                  />
                  <p className="color-editor-help">选择控制点后用方向键微调，Delete 删除中间控制点。</p>
                </details>

                <details>
                  <summary>HSL 混色</summary>
                  {HUE_RANGES.map((range) => <details className="color-editor-nested" key={range}>
                    <summary>{HUE_LABELS[range]}</summary>
                    <div className="color-editor-control-list">
                      <NumericSlider label="色相" help={getColorParameterHelp('hsl.hue', `${HUE_LABELS[range]}范围`)} min={-180} max={180} step={1} suffix="°" value={adjustments.hsl[range].hue}
                        onChange={(value) => changeAdjustments((next) => { next.hsl[range].hue = value })}
                        onReset={() => changeAdjustments((next) => { next.hsl[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                      <NumericSlider label="饱和度" help={getColorParameterHelp('hsl.saturation', `${HUE_LABELS[range]}范围`)} min={-100} max={100} step={1} value={adjustments.hsl[range].saturation}
                        onChange={(value) => changeAdjustments((next) => { next.hsl[range].saturation = value })}
                        onReset={() => changeAdjustments((next) => { next.hsl[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                      <NumericSlider label="明度" help={getColorParameterHelp('hsl.luminance', `${HUE_LABELS[range]}范围`)} min={-100} max={100} step={1} value={adjustments.hsl[range].luminance}
                        onChange={(value) => changeAdjustments((next) => { next.hsl[range].luminance = value })}
                        onReset={() => changeAdjustments((next) => { next.hsl[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                    </div>
                  </details>)}
                </details>

                <details>
                  <summary>色轮分级</summary>
                  {(['shadows', 'midtones', 'highlights'] as const).map((range) => {
                    const label = range === 'shadows' ? '阴影' : range === 'midtones' ? '中间调' : '高光'
                    const wheel = adjustments.colorGrading[range]
                    return <details className="color-editor-nested" key={range}>
                      <summary><span className="color-editor-wheel-swatch" style={{ background: `hsl(${wheel.hue}, ${wheel.saturation}%, 50%)` }} />{label}</summary>
                      <div className="color-editor-control-list">
                        <ColorWheelPicker label={`${label}色轮`} hue={wheel.hue} saturation={wheel.saturation}
                          onChange={(hue, saturation) => changeAdjustments((next) => {
                            next.colorGrading[range].hue = hue
                            next.colorGrading[range].saturation = saturation
                          })} />
                        <NumericSlider label="色相" help={getColorParameterHelp('colorGrading.hue', `${label}区域`)} min={-180} max={180} step={1} suffix="°" value={wheel.hue}
                          onChange={(value) => changeAdjustments((next) => { next.colorGrading[range].hue = value })}
                          onReset={() => changeAdjustments((next) => { next.colorGrading[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                        <NumericSlider label="饱和度" help={getColorParameterHelp('colorGrading.saturation', `${label}区域`)} min={0} max={100} step={1} value={wheel.saturation}
                          onChange={(value) => changeAdjustments((next) => { next.colorGrading[range].saturation = value })}
                          onReset={() => changeAdjustments((next) => { next.colorGrading[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                        <NumericSlider label="亮度" help={getColorParameterHelp('colorGrading.luminance', `${label}区域`)} min={-100} max={100} step={1} value={wheel.luminance}
                          onChange={(value) => changeAdjustments((next) => { next.colorGrading[range].luminance = value })}
                          onReset={() => changeAdjustments((next) => { next.colorGrading[range] = { hue: 0, saturation: 0, luminance: 0 } })} />
                      </div>
                    </details>
                  })}
                  <div className="color-editor-control-list">
                    <NumericSlider label="平衡" help={getColorParameterHelp('colorGrading.balance')} min={-100} max={100} step={1} value={adjustments.colorGrading.balance}
                      onChange={(value) => changeAdjustments((next) => { next.colorGrading.balance = value })}
                      onReset={() => changeAdjustments((next) => { next.colorGrading.balance = 0 })} />
                    <NumericSlider label="混合" help={getColorParameterHelp('colorGrading.blending')} min={0} max={100} step={1} value={adjustments.colorGrading.blending}
                      onChange={(value) => changeAdjustments((next) => { next.colorGrading.blending = value })}
                      onReset={() => changeAdjustments((next) => { next.colorGrading.blending = 50 })} />
                  </div>
                </details>

                <details>
                  <summary>通道混合</summary>
                  {(['red', 'green', 'blue'] as const).map((outputChannel) => <details className="color-editor-nested" key={outputChannel}>
                    <summary>输出 {CHANNEL_LABELS[outputChannel]}</summary>
                    <div className="color-editor-control-list">
                      {(['red', 'green', 'blue'] as const).map((inputChannel, index) => <NumericSlider
                        key={inputChannel} label={`输入${CHANNEL_LABELS[inputChannel]}`} help={getColorParameterHelp('channelMixer.contribution', `输出${CHANNEL_LABELS[outputChannel]}与输入${CHANNEL_LABELS[inputChannel]}`)} min={-200} max={200} step={1}
                        value={adjustments.channelMixer[outputChannel][index]}
                        onChange={(value) => changeAdjustments((next) => { next.channelMixer[outputChannel][index] = value })}
                        onReset={() => changeAdjustments((next) => { next.channelMixer[outputChannel] = createDefaultColorAdjustments().channelMixer[outputChannel] })}
                      />)}
                    </div>
                  </details>)}
                </details>

                <details>
                  <summary>3D LUT</summary>
                  <div className="color-editor-control-list">
                    <div className="color-editor-subheading color-editor-subheading-help"><span>色彩映射</span><ColorParameterHelp label="3D LUT" description={getColorParameterHelp('lut')} /></div>
                    <label className="color-editor-file-button">导入 .cube<input type="file" accept=".cube,text/plain" onChange={(event) => void importLut(event)} /></label>
                    <span className="color-editor-lut-name">{lutLabel || '未载入 LUT'}</span>
                    {adjustments.lut && <button type="button" className="color-editor-wide-button" onClick={() => { changeAdjustments((next) => { next.lut = null }); setLutLabel('') }}>移除 LUT</button>}
                  </div>
                </details>

                <details>
                  <summary>原尺寸导出</summary>
                  <div className="color-editor-control-list">
                    <label className="color-editor-field">格式
                      <select value={imageFormat} onChange={(event) => setImageFormat(event.target.value as ImageFormat)}>
                        <option value="image/png">PNG · 无损</option>
                        <option value="image/webp">WebP</option>
                        <option value="image/jpeg">JPEG</option>
                      </select>
                    </label>
                    {imageFormat !== 'image/png' && <NumericSlider label="质量" help={getColorParameterHelp('export.quality')} min={50} max={100} step={1} value={quality} suffix="%" onChange={setQuality} />}
                    <p className="color-editor-help">导出与保存都使用当前配方重新处理原始分辨率像素。</p>
                    {exportProgress !== null && <div className="color-editor-progress"><progress max={1} value={exportProgress} /><button type="button" onClick={() => exportAbortRef.current?.abort()}>取消</button></div>}
                  </div>
                </details>

                <details>
                  <summary>已保存版本 <span className="color-editor-count">{versionsByDate.length}</span></summary>
                  <div className="color-editor-version-list">
                    {versionsByDate.length === 0 ? <span>尚无已保存版本</span> : versionsByDate.map((version) => <div className="color-editor-version" key={version.id}>
                      <span>{new Date(version.createdAt).toLocaleString()}</span>
                      <button type="button" onClick={() => void loadVersion(version.id)}>载入</button>
                    </div>)}
                  </div>
                </details>
              </>
            ) : renderState === 'error' ? <div className="color-editor-state color-editor-error">{error}</div> : <div className="color-editor-empty" />}
          </aside>
        </div>
      </section>
    </div>
  )
}

function NumericSlider({
  label, help, value, min, max, step, suffix = '', onChange, onReset,
}: {
  label: string
  help: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
  onReset?: () => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commitDraft = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) {
      const normalized = clamp(parsed, min, max)
      setDraft(String(normalized))
      onChange(normalized)
    } else {
      setDraft(String(value))
    }
  }
  return (
    <div className="color-editor-slider">
      <div className="color-editor-slider-head">
        <div className="color-editor-slider-label"><label>{label}</label><ColorParameterHelp label={label} description={help} /></div>
        <div>
          <input aria-label={`${label}数值`} type="number" min={min} max={max} step={step} value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          <span>{suffix}</span>
          {onReset && <button type="button" title={`重置${label}`} aria-label={`重置${label}`} onClick={onReset}>↺</button>}
        </div>
      </div>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => { setDraft(event.target.value); onChange(Number(event.target.value)) }} />
    </div>
  )
}

function ColorWheelPicker({ label, hue, saturation, onChange }: {
  label: string
  hue: number
  saturation: number
  onChange: (hue: number, saturation: number) => void
}) {
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)
    const y = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)
    const radius = Math.min(1, Math.hypot(x, y))
    const degrees = ((Math.atan2(y, x) * 180 / Math.PI + 90 + 540) % 360) - 180
    onChange(Math.round(degrees), Math.round(radius * 100))
  }
  const angle = (hue - 90) * Math.PI / 180
  const radius = saturation * 0.45
  const markerX = 50 + Math.cos(angle) * radius
  const markerY = 50 + Math.sin(angle) * radius
  return (
    <div className="color-editor-wheel-row">
      <div className="color-editor-wheel"
        role="slider" tabIndex={0} aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={saturation}
        aria-valuetext={`色相 ${hue} 度，饱和度 ${saturation}%`}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event) }}
        onPointerMove={(event) => { if (event.buttons === 1) updateFromPointer(event) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            onChange(clamp(hue + (event.key === 'ArrowRight' ? 1 : -1), -180, 180), saturation)
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            onChange(hue, clamp(saturation + (event.key === 'ArrowUp' ? 1 : -1), 0, 100))
          }
        }}>
        <span className="color-editor-wheel-marker" style={{ left: `${markerX}%`, top: `${markerY}%` }} />
      </div>
      <span>色相 {hue}° · 饱和度 {saturation}%</span>
      <ColorParameterHelp label={label} description={getColorParameterHelp('colorGrading.wheelPicker', label)} />
    </div>
  )
}

function HistogramPanel({ histogram }: { histogram: ColorHistogram }) {
  const polyline = (values: number[]) => values.map((value, index) => `${index},${63 - (histogram.maxCount ? value / histogram.maxCount * 61 : 0)}`).join(' ')
  return (
    <div className="color-editor-histogram" aria-label="RGB 直方图">
      <div><strong>RGB 直方图</strong><span>0–255</span></div>
      <svg viewBox="0 0 256 64" preserveAspectRatio="none" role="img" aria-label="红绿蓝通道直方图">
        <polyline points={polyline(histogram.red)} stroke="#e34e4e" />
        <polyline points={polyline(histogram.green)} stroke="#37a76f" />
        <polyline points={polyline(histogram.blue)} stroke="#4c7fdf" />
      </svg>
    </div>
  )
}

function CurveEditor({
  channel, points, selectedIndex, onAdd, onPointerDown, onPointerMove, onPointerUp, onSelect, onKeyPoint, onRemove,
}: {
  channel: ColorChannel
  points: Array<{ x: number; y: number }>
  selectedIndex: number | null
  onAdd: (x: number, y: number) => void
  onPointerDown: (index: number) => void
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
  onPointerUp: () => void
  onSelect: (index: number | null) => void
  onKeyPoint: (index: number, x: number, y: number) => void
  onRemove: (index: number) => void
}) {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const coordinates = sorted.map(({ x, y }) => `${x * 256},${(1 - y) * 256}`).join(' ')
  const keyDown = (event: KeyboardEvent<SVGCircleElement>, index: number) => {
    const point = sorted[index]
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onRemove(index)
      return
    }
    const direction = event.key === 'ArrowLeft' ? [-1, 0] : event.key === 'ArrowRight' ? [1, 0] : event.key === 'ArrowUp' ? [0, 1] : event.key === 'ArrowDown' ? [0, -1] : null
    if (!direction) return
    event.preventDefault()
    const step = event.shiftKey ? 0.05 : 0.01
    onKeyPoint(index, point.x + direction[0] * step, point.y + direction[1] * step)
  }
  return (
    <svg className="color-editor-curve" viewBox="0 0 256 256" role="group" aria-label={`${CHANNEL_LABELS[channel]}点曲线`}
      onClick={(event) => {
        if (event.target instanceof SVGCircleElement) return
        const rect = event.currentTarget.getBoundingClientRect()
        onAdd(clamp((event.clientX - rect.left) / rect.width, 0.005, 0.995), clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1))
      }}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {[0, 1, 2, 3].map((index) => <line key={index} x1={index * 256 / 3} y1="0" x2={index * 256 / 3} y2="256" />)}
      {[0, 1, 2, 3].map((index) => <line key={`h-${index}`} x1="0" y1={index * 256 / 3} x2="256" y2={index * 256 / 3} />)}
      <line className="color-editor-curve-identity" x1="0" y1="256" x2="256" y2="0" />
      <polyline className={`curve-${channel}`} points={coordinates} />
      {sorted.map((point, index) => <circle key={`${point.x}-${index}`} cx={point.x * 256} cy={(1 - point.y) * 256} r={index === selectedIndex ? 6 : 4.5}
        tabIndex={0} role="slider" aria-label={`${CHANNEL_LABELS[channel]}曲线点 ${index + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(point.y * 100)}
        className={index === selectedIndex ? 'is-selected' : ''}
        onFocus={() => onSelect(index)} onBlur={() => onSelect(null)} onClick={(event) => { event.stopPropagation(); onSelect(index) }}
        onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(index); onPointerDown(index) }}
        onKeyDown={(event) => keyDown(event, index)} />)}
    </svg>
  )
}

function curvePoints(points: Array<{ x: number; y: number }>) {
  return points.length >= 2 ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

async function imageBitmapToObjectUrl(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建预览画布')
  context.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('预览生成失败')), 'image/png'))
  return URL.createObjectURL(blob)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片数据读取失败'))
    reader.readAsDataURL(blob)
  })
}
