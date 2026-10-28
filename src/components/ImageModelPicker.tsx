import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { getBananaModelCreditLabel, normalizeBananaModelId } from '../lib/bananaModels'
import {
  IMAGE_MODEL_FAMILIES, getImageModelFamily, getImageModelSelectionLabel, getPreferredImageModel,
  parseImageModelLineMemory, positionImageModelPicker, rememberImageModelLine,
  type ImageModelLineMemory,
} from '../lib/imageModelSelection'
import type { SizeTier } from '../lib/size'
import { ChevronDownIcon } from './icons'

interface PickerContentProps {
  value: string
  familyId: string
  rememberedModel?: string
  imageSize: SizeTier
  onFamilyChange: (familyId: string) => void
  onChange: (model: string) => void
}

export function ImageModelPickerContent({
  value, familyId, rememberedModel, imageSize, onFamilyChange, onChange,
}: PickerContentProps) {
  const family = IMAGE_MODEL_FAMILIES.find(item => item.id === familyId) ?? IMAGE_MODEL_FAMILIES[0]
  const selectedFamily = getImageModelFamily(value)

  const navigateColumn = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-picker-item]'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0 || !buttons.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-[44%_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-r border-[color:var(--app-border)] bg-[var(--app-bg-soft)]/40">
          <div className="flex h-10 shrink-0 items-center justify-between px-3 text-[10px] font-medium tracking-wide text-[color:var(--app-text-subtle)]">
            <span>选择模型</span><span>{IMAGE_MODEL_FAMILIES.length} 款</span>
          </div>
          <div role="group" aria-label="模型列表" onKeyDown={navigateColumn} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
            {IMAGE_MODEL_FAMILIES.map(item => {
              const browsing = item.id === family.id
              const active = item.id === selectedFamily?.id
              return (
                <button key={item.id} type="button" data-picker-item data-family-id={item.id}
                  aria-pressed={browsing} onClick={() => onFamilyChange(item.id)}
                  className={'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ' +
                    (browsing ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'text-[color:var(--app-text)] hover:bg-[var(--app-bg-soft)]')}>
                  <span className="min-w-0 flex-1 break-words leading-5">{item.label}</span>
                  {active && <span aria-label="当前模型" className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                  <ChevronDownIcon className="h-3 w-3 shrink-0 -rotate-90 opacity-50" />
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3 text-[10px] font-medium text-[color:var(--app-text-subtle)]">
            <span>选择线路</span><span className="whitespace-nowrap">积分 / 张</span>
          </div>
          <div role="radiogroup" aria-label={family.label + ' 线路'} onKeyDown={navigateColumn} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            <div className="mb-2 px-1 text-xs font-semibold leading-5 text-[color:var(--app-text)]">{family.label}</div>
            {family.lines.map(line => {
              const selected = line.model === normalizeBananaModelId(value)
              const remembered = !selected && line.model === rememberedModel
              return (
                <button key={line.model} type="button" role="radio" aria-checked={selected}
                  data-picker-item data-line-model={line.model} onClick={() => onChange(line.model)}
                  className={'mb-2 flex w-full flex-col gap-2 rounded-xl border px-2.5 py-3 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ' +
                    (selected ? 'border-blue-400/60 bg-blue-500/[0.07]' : 'border-[color:var(--app-border)] hover:border-blue-400/50 hover:bg-[var(--app-bg-soft)]')}>
                  <span className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="flex items-center gap-1.5 font-medium text-[color:var(--app-text)]">
                      <span aria-hidden="true" className={'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ' + (selected ? 'border-blue-500 bg-blue-500' : 'border-[color:var(--app-border-strong)]')}>
                        {selected && <span className="h-1 w-1 rounded-full bg-white" />}
                      </span>
                      {line.label}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-right font-medium tabular-nums text-[color:var(--app-text)]">{getBananaModelCreditLabel(line.model, imageSize)}</span>
                  </span>
                  {(line.capabilities.length > 0 || remembered) && <span className="flex flex-wrap gap-1">
                    {line.capabilities.map(tag => <span key={tag} className="rounded-md bg-[var(--app-bg-soft)] px-1.5 py-0.5 text-[10px] text-[color:var(--app-text-subtle)]">{tag}</span>)}
                    {remembered && <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">上次使用</span>}
                  </span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-[color:var(--app-border)] px-3 py-2.5 text-[10px] text-[color:var(--app-text-subtle)]">
        选择线路后生效 · 价格随图片尺寸更新
      </div>
    </>
  )
}

interface ImageModelPickerProps {
  value: string
  imageSize: SizeTier
  onChange: (model: string) => void
  className?: string
  memoryScope?: string
}

export default function ImageModelPicker({ value, imageSize, onChange, className = '', memoryScope = 'gallery' }: ImageModelPickerProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [familyId, setFamilyId] = useState(() => getImageModelFamily(value)?.id ?? IMAGE_MODEL_FAMILIES[0].id)
  const [position, setPosition] = useState<ReturnType<typeof positionImageModelPicker> | null>(null)
  const storageKey = 'image-model-lines:' + memoryScope
  const [memory, setMemory] = useState<ImageModelLineMemory>(() => {
    try { return parseImageModelLineMemory(localStorage.getItem(storageKey)) } catch { return {} }
  })
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const normalizedValue = normalizeBananaModelId(value)
  const activeFamily = getImageModelFamily(normalizedValue)
  const activeLine = activeFamily?.lines.find(line => line.model === normalizedValue)
  const family = IMAGE_MODEL_FAMILIES.find(item => item.id === familyId) ?? IMAGE_MODEL_FAMILIES[0]
  const label = getImageModelSelectionLabel(value)
  const title = label + ' · ' + getBananaModelCreditLabel(value, imageSize) + ' / 张'

  useEffect(() => {
    let stored: ImageModelLineMemory = memoryRef.current
    try { stored = parseImageModelLineMemory(localStorage.getItem(storageKey)) } catch { /* Private storage may be unavailable. */ }
    const next = rememberImageModelLine({ ...memoryRef.current, ...stored }, value)
    setMemory(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Selection also works without persistence. */ }
  }, [storageKey, value])

  const close = useCallback((restoreFocus = false) => {
    setIsOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    const update = () => {
      const anchor = triggerRef.current
      if (!anchor || !anchor.getClientRects().length) { close(); return }
      setPosition(positionImageModelPicker(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen || !position) return
    const target = panelRef.current?.querySelector<HTMLButtonElement>('[data-family-id="' + familyId + '"]')
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
    // Only move focus when the portal first appears.
  }, [isOpen, Boolean(position)])

  useEffect(() => {
    if (!isOpen) return
    const outside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) close()
    }
    const focusOutside = (event: FocusEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
    }
  }, [isOpen, close])

  const open = () => {
    setFamilyId(activeFamily?.id ?? IMAGE_MODEL_FAMILIES[0].id)
    setPosition(null)
    setIsOpen(true)
  }

  const selectLine = (model: string) => {
    const next = rememberImageModelLine(memoryRef.current, model)
    setMemory(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Persistence is optional. */ }
    onChange(model)
    close(true)
  }

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    const target = event.target as HTMLElement
    if (event.key === 'ArrowRight' && target.closest('[data-family-id]')) {
      event.preventDefault()
      const targetFamilyId = target.closest<HTMLElement>('[data-family-id]')?.dataset.familyId
      const targetFamily = IMAGE_MODEL_FAMILIES.find(item => item.id === targetFamilyId) ?? family
      const targetModel = targetFamily.id === activeFamily?.id ? normalizedValue : getPreferredImageModel(targetFamily, memory)
      setFamilyId(targetFamily.id)
      requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[data-line-model="' + targetModel + '"]')?.focus())
    } else if (event.key === 'ArrowLeft' && target.closest('[data-line-model]')) {
      event.preventDefault()
      panelRef.current?.querySelector<HTMLButtonElement>('[data-family-id="' + familyId + '"]')?.focus()
    } else if (event.key === 'Tab') {
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" aria-label={'选择生图模型：' + label} title={title}
        aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={isOpen ? id : undefined}
        onClick={() => isOpen ? close() : open()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!isOpen) open() }
          else if (event.key === 'Escape' && isOpen) { event.preventDefault(); close(true) }
        }}
        className={'flex w-full min-w-0 items-center justify-between gap-1 text-left text-[color:var(--app-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ' + className}>
        <span className="min-w-0 flex-1 truncate">{activeFamily?.label ?? value}</span>
        {activeFamily && activeFamily.lines.length > 1 && activeLine && <span data-current-line={activeLine.shortLabel}
          className="flex shrink-0 items-center gap-1 text-[10px] text-[color:var(--app-text-muted)]"><span aria-hidden="true">·</span>{activeLine.shortLabel}</span>}
        <ChevronDownIcon className={'h-3.5 w-3.5 shrink-0 text-[color:var(--app-text-subtle)] transition-transform ' + (isOpen ? 'rotate-180' : '')} />
      </button>
      {isOpen && position && createPortal(
        <div ref={panelRef} id={id} role="dialog" aria-label="选择生图模型与线路" onKeyDown={handlePanelKeyDown}
          className="fixed z-[160] flex flex-col overflow-hidden rounded-2xl border border-[color:var(--app-border)] text-[color:var(--app-text)] shadow-[0_12px_48px_rgb(0,0,0,0.16)]"
          style={{ left: position.left, top: position.top, width: position.width, height: position.height, backgroundColor: 'var(--app-bg)' }}>
          <ImageModelPickerContent value={value} familyId={familyId} rememberedModel={memory[family.id]} imageSize={imageSize}
            onFamilyChange={setFamilyId} onChange={selectLine} />
        </div>, document.body,
      )}
    </>
  )
}
