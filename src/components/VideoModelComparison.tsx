import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { VIDEO_MODELS, formatVideoResolution, getVideoDurationSpec, getVideoPricingMultiplier, type VideoModelDefinition } from '../lib/videoModels'
import { CloseIcon } from './icons'
import VideoModelLogo from './VideoModelLogo'

const COMPARISON_MODELS = ['MiniMax-H3', 'wan3.0-video-720p'] as const
const CLOSE_DELAY_MS = 220
const PANEL_BACKGROUND = 'linear-gradient(var(--app-surface-elevated), var(--app-surface-elevated)), var(--app-bg)'

function rateLabel(credits: number, unit: string) {
  return `${credits} 积分/${unit}`
}

function resolutionRates(def: VideoModelDefinition, rates: VideoModelDefinition['pricePerSecondCredits'], duration: number) {
  const multiplier = getVideoPricingMultiplier(def.model, duration)
  return def.resolutions.filter(resolution => getVideoDurationSpec(def.model, false, resolution).max >= duration)
    .map(resolution => <p key={resolution}>{`${formatVideoResolution(resolution)}：${rates?.[resolution] === undefined ? '价格待配置' : rateLabel(rates[resolution]! * multiplier, '秒')}`}</p>)
}

function pricingBands(def: VideoModelDefinition, content: (duration: number) => ReactNode) {
  const pricing = def.durationPricing
  if (!pricing) return content(def.duration.default)
  return <div className="space-y-2">
    <div><p className="mb-1 text-xs font-semibold">{`≤${pricing.thresholdSeconds} 秒`}</p>{content(pricing.thresholdSeconds)}</div>
    <div><p className="mb-1 text-xs font-semibold">{`${pricing.thresholdSeconds + 1}–${def.duration.max} 秒`}</p>{content(pricing.thresholdSeconds + 1)}</div>
  </div>
}

export function VideoModelComparisonContent({ selectedModel }: { selectedModel: string }) {
  const definitions = COMPARISON_MODELS.map(model => VIDEO_MODELS[model])
  const rows: { label: string; content: (def: VideoModelDefinition) => ReactNode }[] = [
    { label: '输出分辨率', content: def => <span className="font-semibold">{def.resolutions.map(formatVideoResolution).join(' / ')}</span> },
    { label: '生成时长', content: def => <>{def.durationByResolution ? def.resolutions.map(resolution => {
      const duration = getVideoDurationSpec(def.model, false, resolution)
      return <p key={resolution}>{`${formatVideoResolution(resolution)}：${duration.min}–${duration.max} 秒`}</p>
    }) : <p>{`${def.duration.min}–${def.duration.max} 秒`}</p>}{def.maxOutputSecondsWithVideo && <p className="mt-1 text-xs text-[color:var(--app-text-muted)]">{`含参考视频：最多 ${def.maxOutputSecondsWithVideo} 秒`}</p>}</> },
    { label: '生成价格', content: def => <div className="font-medium text-blue-600 [.dark_&]:text-blue-300">{pricingBands(def, duration => <div className="space-y-1">{resolutionRates(def, def.pricePerSecondCredits, duration)}</div>)}</div> },
    { label: '参考图片费用', content: def => def.referencePricing ? <><p className="mb-2">{`前 ${def.referencePricing.freeImages} 张免费`}</p>{pricingBands(def, duration => <p>{`超出 ${rateLabel(def.referencePricing!.imageCredits * getVideoPricingMultiplier(def.model, duration), '张')}`}</p>)}</> : '不另收费' },
    { label: '参考视频费用', content: def => def.referencePricing ? <>{pricingBands(def, duration => <div className="space-y-1">{resolutionRates(def, def.referencePricing!.videoPerSecondCredits, duration)}</div>)}<p className="mt-1 text-xs text-[color:var(--app-text-muted)]">按参考视频合计时长计费，单价取决于输出分辨率和生成时长。</p></> : '不另收费' },
    { label: '参考音频费用', content: () => '免费' },
    { label: '参考图片数量', content: def => `最多 ${def.modes.ref2v?.maxImages ?? 0} 张` },
    { label: '参考视频数量', content: def => `最多 ${def.modes.ref2v?.maxVideos ?? 0} 个` },
    { label: '参考音频数量', content: def => `最多 ${def.modes.ref2v?.maxAudios ?? 0} 个` },
    { label: '首尾帧控制', content: def => def.modes.flf2v ? '支持首尾帧' : '仅支持单张起始图' },
  ]
  const wanRefSeconds = VIDEO_MODELS['wan3.0-video-720p'].modes.ref2v?.maxRefMediaSeconds
  const h3 = VIDEO_MODELS['MiniMax-H3']

  return (
    <>
      <table className="w-full table-fixed border-collapse text-left text-xs leading-relaxed sm:text-sm">
        <caption className="sr-only">MiniMax H3 与 Wan 3.0 的价格和生成能力对比</caption>
        <colgroup><col className="w-[24%] sm:w-[22%]" /><col /><col /></colgroup>
        <thead className="sticky top-0 z-10" style={{ background: PANEL_BACKGROUND }}>
          <tr className="border-b border-[color:var(--app-border)]">
            <th scope="col" className="p-3 text-xs font-normal text-[color:var(--app-text-muted)]">对比项目</th>
            {definitions.map(def => <th scope="col" key={def.model} className="px-2 py-3 align-top sm:px-3">
              <div className="flex flex-wrap items-center gap-1.5"><VideoModelLogo logo={def.logo} className="h-4 w-4 shrink-0" /><span className="break-words">{def.displayName}</span></div>
              {selectedModel === def.model && <span className="mt-1.5 inline-block rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 [.dark_&]:text-blue-300">当前选择</span>}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={row.label} className="border-b border-[color:var(--app-border)] last:border-b-0">
            <th scope="row" className="p-3 align-top text-xs font-normal text-[color:var(--app-text-muted)]">{row.label}</th>
            {definitions.map(def => <td key={def.model} className={`break-words px-2 py-3 align-top sm:px-3 ${selectedModel === def.model ? 'bg-blue-500/[0.04]' : ''}`}>{row.content(def)}</td>)}
          </tr>)}
        </tbody>
      </table>
      <div className="space-y-2 border-t border-[color:var(--app-border)] bg-[color:var(--app-input)] p-4 text-xs leading-relaxed text-[color:var(--app-text-muted)]">
        <p>素材数量为多参考模式上限；单图生视频使用 1 张起始图，首尾帧模式使用 2 张图片。</p>
        <p>{`Wan 参考视频和音频：每个 2–${wanRefSeconds} 秒，各合计 ≤${wanRefSeconds} 秒；音频需搭配图片或视频。`}</p>
        <p>{`H3 生成超过 ${h3.durationPricing!.thresholdSeconds} 秒时，完整输出时长、参考视频及超额图片费用均按 ${h3.durationPricing!.multiplier} 倍计算；前 ${h3.referencePricing!.freeImages} 张图片和参考音频仍免费。`}</p>
        <p>生成价格按输出时长计费；H3 另加超额图片与参考视频费用。以上为单个视频价格，批量创建按数量计费，实际扣费以结算为准。</p>
      </div>
    </>
  )
}

export default function VideoModelComparison({ selectedModel }: { selectedModel: string }) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinnedRef = useRef(false)
  const hoveredRef = useRef(false)
  const suppressFocusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const focusIsInside = () => triggerRef.current === document.activeElement || Boolean(panelRef.current?.contains(document.activeElement))
  const show = () => {
    clearTimer()
    setOpen(true)
  }
  const close = (restoreFocus = false) => {
    clearTimer()
    pinnedRef.current = false
    hoveredRef.current = false
    setOpen(false)
    setPosition(null)
    if (restoreFocus) {
      suppressFocusRef.current = true
      triggerRef.current?.focus({ preventScroll: true })
      suppressFocusRef.current = false
    }
  }
  const scheduleClose = () => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (!pinnedRef.current && !hoveredRef.current && !focusIsInside()) setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!trigger || !panel) return
      const margin = 12
      const gap = 10
      const right = trigger.right + gap
      const leftSide = trigger.left - panel.width - gap
      const preferredLeft = right + panel.width <= window.innerWidth - margin ? right
        : leftSide >= margin ? leftSide : trigger.right - panel.width
      setPosition({
        left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - panel.width - margin)),
        top: Math.max(margin, Math.min(trigger.top + trigger.height / 2 - panel.height / 2, window.innerHeight - panel.height - margin)),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(focusIsInside())
      }
    }
    document.addEventListener('pointerdown', outsideClick)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outsideClick)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef} type="button" aria-label="视频模型对比说明" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${open ? 'bg-blue-500/10 text-blue-600 [.dark_&]:text-blue-300' : 'text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-input)] hover:text-[color:var(--app-text)]'}`}
        onPointerEnter={event => { if (event.pointerType === 'mouse') { hoveredRef.current = true; show() } }}
        onPointerLeave={event => { if (event.pointerType === 'mouse') { hoveredRef.current = false; scheduleClose() } }}
        onFocus={() => { if (!suppressFocusRef.current) show() }} onBlur={scheduleClose}
        onKeyDown={event => {
          if (open && (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey))) {
            event.preventDefault()
            panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
          }
        }}
        onClick={() => { if (pinnedRef.current) close(); else { pinnedRef.current = true; show() } }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" /></svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={id} ref={panelRef} role="dialog" aria-labelledby={`${id}-title`}
          className="fixed z-[120] flex w-[min(700px,calc(100vw-24px))] max-h-[min(760px,calc(100dvh-24px))] flex-col overflow-hidden rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface-elevated)] text-[color:var(--app-text)] shadow-2xl"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden', background: PANEL_BACKGROUND }}
          onPointerEnter={event => { if (event.pointerType === 'mouse') { hoveredRef.current = true; clearTimer() } }}
          onPointerLeave={event => { if (event.pointerType === 'mouse') { hoveredRef.current = false; scheduleClose() } }}
          onFocusCapture={clearTimer} onBlurCapture={scheduleClose}
          onKeyDown={event => {
            if (event.key === 'Tab' && event.shiftKey && event.target === panelRef.current?.querySelector('button')) {
              event.preventDefault()
              triggerRef.current?.focus()
            }
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--app-border)] px-4 py-3">
            <div><h2 id={`${id}-title`} className="text-sm font-semibold">视频模型对比</h2><p className="mt-1 text-xs text-[color:var(--app-text-muted)]">价格、输出规格与参考素材限制</p></div>
            <button type="button" onClick={() => close(true)} aria-label="关闭模型说明" className="rounded-lg p-1.5 text-[color:var(--app-text-muted)] hover:bg-[color:var(--app-input)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><CloseIcon aria-hidden="true" className="h-4 w-4" /></button>
          </div>
          <div tabIndex={0} aria-label="模型对比详情，可滚动" className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400">
            <VideoModelComparisonContent selectedModel={selectedModel} />
          </div>
        </div>, document.body,
      )}
    </>
  )
}
