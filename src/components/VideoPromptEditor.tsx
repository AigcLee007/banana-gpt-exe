import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { VideoMediaMetadata } from '../hooks/useVideoMediaMetadata'
import { encodeVideoMention, labelVideoReferences, parseVideoPrompt, serializeVideoPrompt, type VideoMention } from '../lib/videoPromptMentions'
import type { VideoReferenceItem } from '../lib/videoTypes'
import VideoMentionPicker, { VideoMentionThumbnail, type VideoMentionPickerHandle } from './VideoMentionPicker'

export interface VideoPromptEditorProps {
  value: string
  onChange: (value: string) => void
  references: VideoReferenceItem[]
  metadata: Record<string, VideoMediaMetadata>
  library?: VideoReferenceItem[]
  /** Resolve after the item has been added to current references; reject to keep the picker open. */
  onAddLibrary?: (item: VideoReferenceItem) => Promise<void | VideoReferenceItem>
  maxLength?: number
  placeholder?: string
}

interface Bookmark { start: number; end: number; backward?: boolean }
interface Chip { element: HTMLSpanElement; mention: VideoMention; raw: string; key: string }
interface PickerSession {
  range: Bookmark
  /** Captured storage substring, checked again after asynchronous library imports. */
  original: string
  anchor: { left: number; top: number; bottom: number }
  query: string
}

const editorCss = `
.vpe-shell{position:relative;border:1px solid var(--app-border,#394150);border-radius:12px;background:var(--app-input,#171d27);color:var(--app-text,#f3f4f6)}
.vpe-shell:focus-within{border-color:#4ade80}
.vpe-content{position:relative;min-height:132px;max-height:320px;overflow-y:auto;box-sizing:border-box;padding:12px 12px 28px;outline:none;font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;caret-color:var(--app-text,#f3f4f6)}
.vpe-placeholder{position:absolute;top:12px;left:12px;right:12px;pointer-events:none;font-size:14px;line-height:1.9;color:var(--app-text-subtle,#7c8798)}
.vpe-counter{position:absolute;bottom:6px;right:12px;pointer-events:none;font-size:10px;color:var(--app-text-subtle,#7c8798)}
.vpe-chip{display:inline-flex;align-items:center;vertical-align:middle;gap:4px;max-width:100%;margin:0 2px;padding:1px 6px 1px 2px;border-radius:6px;border:1px solid #22c55e66;background:#22c55e20;color:#4ade80;line-height:22px;white-space:nowrap;user-select:all}
.vpe-chip[aria-disabled=true]{border-color:#f8717166;background:#f871711c;color:#f87171}
.vpe-chip-body{display:inline-flex;align-items:center;gap:4px;max-width:100%;pointer-events:none}
.vpe-chip-thumb{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;overflow:hidden;border-radius:4px;background:#0002}
.vpe-chip-label{overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600}
.vpe-error{margin:5px 2px;font-size:12px;color:#f87171}
`

/** Never read chip text/React thumbnails into the stored prompt. */
function readDOM(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return root.nodeValue ?? ''
  if (root instanceof HTMLElement) {
    if (root.dataset.token !== undefined) return root.dataset.token
    if (root.dataset.caretEnd !== undefined) return ''
    if (root.tagName === 'BR') return '\n'
  }
  let result = ''
  for (const child of Array.from(root.childNodes)) {
    const block = child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName)
    if (block && result && !result.endsWith('\n')) result += '\n'
    result += readDOM(child)
    if (block && child.nextSibling && !(child.nextSibling instanceof HTMLElement && /^(DIV|P)$/.test(child.nextSibling.tagName)) && !result.endsWith('\n')) result += '\n'
  }
  return result
}

function captureSelection(root: HTMLElement): Bookmark | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const offset = (node: Node, position: number) => {
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(node, position)
    return readDOM(prefix.cloneContents()).length
  }
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
    backward: !range.collapsed && selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset,
  }
}

/** Restore into canonical text/chip DOM; never put a caret inside a noneditable chip. */
function restoreSelection(root: HTMLElement, bookmark: Bookmark) {
  const locate = (requested: number): [Node, number] => {
    let remaining = Math.max(0, requested)
    for (let index = 0; index < root.childNodes.length; index++) {
      const child = root.childNodes[index]
      const length = readDOM(child).length
      if (child.nodeType === Node.TEXT_NODE && remaining <= length) return [child, remaining]
      if (child instanceof HTMLElement && child.dataset.token !== undefined && remaining < length) {
        return [root, remaining === 0 ? index : index + 1]
      }
      if (remaining === 0) return [root, index]
      remaining -= length
    }
    return [root, root.childNodes.length]
  }
  const start = locate(bookmark.start)
  const end = locate(bookmark.end)
  const selection = window.getSelection()
  if (!selection) return
  if (bookmark.backward && selection.setBaseAndExtent) {
    selection.setBaseAndExtent(end[0], end[1], start[0], start[1])
  } else {
    const range = document.createRange()
    range.setStart(start[0], start[1])
    range.setEnd(end[0], end[1])
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

function mentionSpans(prompt: string) {
  let offset = 0
  return parseVideoPrompt(prompt).flatMap(part => {
    const length = part.kind === 'text' ? part.text.length : part.raw.length
    const start = offset
    offset += length
    return part.kind === 'mention' ? [{ start, end: offset }] : []
  })
}

function atomicRange(prompt: string, range: Bookmark): Bookmark {
  let { start, end } = range
  for (const span of mentionSpans(prompt)) {
    if (start > span.start && start < span.end) start = range.start === range.end ? span.end : span.start
    if (end > span.start && end < span.end) end = span.end
  }
  return { start, end: Math.max(start, end), backward: range.backward }
}

/** Limits the visible prompt, not opaque token bytes. Mentions are indivisible. */
function visibleLength(prompt: string) {
  return parseVideoPrompt(prompt).reduce((length, part) => length + (part.kind === 'text' ? part.text.length : part.mention.label.length), 0)
}

function limitPrompt(prompt: string, maxLength: number) {
  let result = ''
  let remaining = Math.max(0, maxLength)
  for (const part of parseVideoPrompt(prompt)) {
    if (part.kind === 'mention') {
      const length = part.mention.label.length
      if (length > remaining) break
      result += part.raw
      remaining -= length
    } else {
      let text = part.text.slice(0, remaining)
      // Do not truncate an astral character between its UTF-16 surrogate pair.
      if (text.length < part.text.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
      result += text
      remaining -= text.length
      if (text.length < part.text.length) break
    }
  }
  return result
}

function mapBookmark(previous: string, next: string, bookmark: Bookmark): Bookmark {
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  const map = (offset: number) => offset <= prefix ? offset : offset >= previous.length - suffix
    ? Math.max(prefix, offset + next.length - previous.length) : next.length - suffix
  return atomicRange(next, { start: map(bookmark.start), end: map(bookmark.end), backward: bookmark.backward })
}

export default function VideoPromptEditor({
  value, onChange, references, metadata, library = [], onAddLibrary,
  maxLength = 7000, placeholder = '描述视频内容，输入 @ 引用素材',
}: VideoPromptEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<VideoMentionPickerHandle>(null)
  const pickerId = `video-prompt-picker-${useId()}`
  const [chips, setChips] = useState<Chip[]>([])
  const chipPool = useRef<Chip[]>([])
  const chipSequence = useRef(0)
  const [picker, setPicker] = useState<PickerSession | null>(null)
  const pickerSession = useRef<PickerSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const composing = useRef(false)
  const compositionVersion = useRef(0)
  const lastBookmark = useRef<Bookmark>({ start: 0, end: 0 })
  const pendingBookmark = useRef<Bookmark | null>(null)
  const pendingExternal = useRef<string | null>(null)
  const renderedValue = useRef<string | null>(null)
  const localValue = useRef(value)
  const mounted = useRef(true)
  const pickInFlight = useRef(false)
  const propsRef = useRef({ value, references, onAddLibrary, onChange, maxLength })
  propsRef.current = { value, references, onAddLibrary, onChange, maxLength }
  const currentById = useMemo(() => new Map(labelVideoReferences(references).map(item => [item.id, item])), [references])
  const [displayValue, setDisplayValue] = useState(value)
  const [compositionTick, setCompositionTick] = useState(0)

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const updatePicker = useCallback((next: PickerSession | null) => {
    pickerSession.current = next
    setPicker(next)
  }, [])
  const closePicker = useCallback(() => {
    const session = pickerSession.current
    if (session) lastBookmark.current = { start: session.range.end, end: session.range.end }
    updatePicker(null)
    setError('')
    const root = rootRef.current
    if (root && document.activeElement?.closest(`#${CSS.escape(pickerId)}`) && !composing.current) {
      restoreSelection(root, lastBookmark.current)
    }
  }, [updatePicker, pickerId])

  const buildDOM = useCallback((prompt: string, bookmark: Bookmark | null) => {
    const root = rootRef.current
    if (!root) return
    const fragment = document.createDocumentFragment()
    const nextChips: Chip[] = []
    const available = [...chipPool.current]
    for (const part of parseVideoPrompt(prompt)) {
      if (part.kind === 'text') fragment.append(document.createTextNode(part.text))
      else {
        // Keep portal containers and their URL hooks alive across ordinary typing.
        const existingIndex = available.findIndex(chip => chip.raw === part.raw)
        const existing = existingIndex >= 0 ? available.splice(existingIndex, 1)[0] : undefined
        const element = existing?.element ?? document.createElement('span')
        element.className = 'vpe-chip'
        element.contentEditable = 'false'
        element.dataset.token = part.raw
        element.dataset.mediaId = part.mention.id
        element.setAttribute('role', 'img')
        fragment.append(element, document.createTextNode(''))
        nextChips.push(existing ?? { element, mention: part.mention, raw: part.raw, key: `chip-${chipSequence.current++}` })
      }
    }
    chipPool.current = nextChips
    if (!fragment.lastChild || fragment.lastChild.nodeType !== Node.TEXT_NODE) fragment.append(document.createTextNode(''))
    if (!prompt || prompt.endsWith('\n')) {
      const end = document.createElement('br')
      end.dataset.caretEnd = 'true'
      fragment.append(end)
    }
    root.replaceChildren(fragment)
    renderedValue.current = prompt
    localValue.current = prompt
    setDisplayValue(prompt)
    setChips(nextChips)
    if (bookmark) {
      lastBookmark.current = atomicRange(prompt, bookmark)
      restoreSelection(root, lastBookmark.current)
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (composing.current) {
      if (value !== localValue.current) pendingExternal.current = value
      return
    }
    if (renderedValue.current !== value) {
      const previous = localValue.current
      const ownUpdate = pendingBookmark.current
      const focused = document.activeElement === root
      const saved = ownUpdate ?? (focused ? captureSelection(root) : lastBookmark.current)
      const bookmark = saved ? mapBookmark(previous, value, saved) : null
      if (previous !== value) updatePicker(null)
      buildDOM(value, focused || ownUpdate ? bookmark : null)
      if (bookmark) lastBookmark.current = bookmark
    }
    pendingBookmark.current = null
  }, [value, compositionTick, buildDOM, updatePicker])

  // Updating reference order/metadata changes chip labels, never their raw token or target ID.
  useLayoutEffect(() => {
    for (const chip of chips) {
      const current = currentById.get(chip.mention.id)
      const removed = !current || current.type !== chip.mention.type
      const label = removed ? `${chip.mention.label}（已移除）` : current.label
      chip.element.setAttribute('aria-label', `@${label}`)
      chip.element.setAttribute('aria-disabled', String(removed))
      chip.element.title = metadata[chip.mention.id]?.filename || `@${label}`
    }
  }, [chips, currentById, metadata])

  const emit = (next: string, bookmark: Bookmark, rebuild = true) => {
    pendingBookmark.current = bookmark
    localValue.current = next
    lastBookmark.current = bookmark
    if (rebuild) buildDOM(next, bookmark)
    else {
      renderedValue.current = next
      setDisplayValue(next)
    }
    propsRef.current.onChange(next)
  }

  const caretAnchor = () => {
    const root = rootRef.current!
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null
    range?.collapse(false)
    const rect = range?.getClientRects()[0]
    if (rect && (rect.width || rect.height)) return { left: rect.left, top: rect.top, bottom: rect.bottom }
    // Empty text nodes and chip boundaries can have a zero-sized range rectangle.
    const box = root.getBoundingClientRect()
    const adjacent = range?.startContainer instanceof HTMLElement
      ? range.startContainer.childNodes[Math.max(0, range.startOffset - 1)]
      : range?.startContainer.previousSibling ?? range?.startContainer.parentElement
    const fallback = adjacent instanceof HTMLElement && adjacent !== root ? adjacent.getBoundingClientRect() : box
    return { left: fallback.left + (adjacent === root ? 12 : 0), top: fallback.top, bottom: fallback.bottom }
  }

  const openPicker = (range: Bookmark, query = '') => {
    const root = rootRef.current
    if (!root) return
    lastBookmark.current = range
    setError('')
    updatePicker({ range, query, original: localValue.current.slice(range.start, range.end), anchor: caretAnchor() })
  }

  const replaceRange = (range: Bookmark, insertion: string, allowTruncation = false) => {
    const prompt = localValue.current
    const safe = atomicRange(prompt, range)
    const head = prompt.slice(0, safe.start)
    const tail = prompt.slice(safe.end)
    const budget = Math.max(0, propsRef.current.maxLength - visibleLength(head + tail))
    const text = allowTruncation ? limitPrompt(insertion, budget) : insertion
    if (visibleLength(text) > budget) {
      setError(`提示词最多 ${propsRef.current.maxLength} 字，无法插入该引用`)
      return false
    }
    const next = head + text + tail
    const offset = head.length + text.length
    rootRef.current?.focus({ preventScroll: true })
    emit(next, { start: offset, end: offset })
    return true
  }

  const pick = async (item: VideoReferenceItem, source: 'current' | 'library') => {
    const session = pickerSession.current
    if (!session || pickInFlight.current || composing.current) return
    pickInFlight.current = true
    setBusy(true)
    setError('')
    try {
      let chosen = item
      if (source === 'library') {
        const add = propsRef.current.onAddLibrary
        if (!add) throw new Error('暂不支持添加素材库引用')
        chosen = (await add(item)) || item
      }
      if (!mounted.current || pickerSession.current !== session) return
      if (localValue.current.slice(session.range.start, session.range.end) !== session.original) {
        closePicker()
        return
      }
      const labeled = labelVideoReferences(propsRef.current.references)
      const current = labeled.find(candidate => candidate.id === chosen.id && candidate.type === chosen.type)
      // A React state update from onAddLibrary may not yet have committed. Preserve the
      // returned ID/type; the parent will supply the definitive label on its next render.
      if (!current && source === 'current') throw new Error('该素材已移除，请重新选择')
      const fallback = labelVideoReferences([...propsRef.current.references.filter(candidate => candidate.id !== chosen.id), chosen]).find(candidate => candidate.id === chosen.id)!
      const mention: VideoMention = { id: chosen.id, type: chosen.type, label: (current ?? fallback).label }
      if (replaceRange(session.range, encodeVideoMention(mention))) updatePicker(null)
    } catch (cause) {
      if (mounted.current && pickerSession.current === session) setError(cause instanceof Error ? cause.message : '添加素材失败，请重试')
    } finally {
      pickInFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const synchronizeInput = () => {
    const root = rootRef.current
    if (!root || composing.current) return
    const raw = readDOM(root)
    const bookmark = captureSelection(root) ?? lastBookmark.current
    const next = limitPrompt(raw, propsRef.current.maxLength)
    const limited = atomicRange(next, { start: Math.min(bookmark.start, next.length), end: Math.min(bookmark.end, next.length), backward: bookmark.backward })
    emit(next, limited)
    const session = pickerSession.current
    if (session) {
      // Typing after @ searches without losing the original replacement bookmark.
      const caret = limited.end
      const query = next.slice(session.range.start + 1, caret)
      if (limited.start !== limited.end || next[session.range.start] !== '@' || caret < session.range.start + 1 || /[\n\r]/.test(query)) closePicker()
      else updatePicker({ ...session, range: { start: session.range.start, end: caret }, original: next.slice(session.range.start, caret), query, anchor: caretAnchor() })
    }
  }

  const rememberSelection = () => {
    if (composing.current || pickerSession.current) return
    const root = rootRef.current
    const bookmark = root && captureSelection(root)
    if (bookmark) lastBookmark.current = bookmark
  }

  const deleteAtomic = (key: 'Backspace' | 'Delete') => {
    const root = rootRef.current
    const captured = root && captureSelection(root)
    if (!captured) return false
    const prompt = localValue.current
    let range = atomicRange(prompt, captured)
    if (range.start !== range.end) {
      if (!mentionSpans(prompt).some(span => span.start < range.end && span.end > range.start)) return false
    } else {
      const span = mentionSpans(prompt).find(candidate => key === 'Backspace' ? candidate.end === range.start : candidate.start === range.start)
      if (!span) return false
      range = span
    }
    updatePicker(null)
    return replaceRange(range, '')
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (pickerSession.current && pickerRef.current?.handleKeyDown(event)) return
    if (event.key === '@' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const range = captureSelection(event.currentTarget) ?? lastBookmark.current
      const safe = atomicRange(localValue.current, range)
      if (replaceRange(safe, '@')) openPicker({ start: safe.start, end: safe.start + 1 })
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && deleteAtomic(event.key)) {
      event.preventDefault()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      replaceRange(captureSelection(event.currentTarget) ?? lastBookmark.current, '\n', true)
    }
  }

  const count = visibleLength(displayValue)
  const counterId = `video-prompt-count-${useId()}`
  const errorId = `video-prompt-error-${useId()}`
  const style: CSSProperties = { position: 'relative' }
  return (
    <div className="vpe-root" style={style}>
      <style>{editorCss}</style>
      <div className="vpe-shell">
        <div ref={rootRef} className="vpe-content" contentEditable suppressContentEditableWarning role="textbox"
          aria-label="视频提示词" aria-multiline="true" aria-autocomplete="list" aria-expanded={!!picker}
          aria-controls={picker ? pickerId : undefined} aria-describedby={`${counterId}${error ? ` ${errorId}` : ''}`}
          spellCheck={false} onKeyDown={keyDown} onInput={event => {
            const native = event.nativeEvent as InputEvent
            const insertedAt = !composing.current && native.data === '@' && !pickerSession.current
            synchronizeInput()
            if (insertedAt) {
              const bookmark = captureSelection(event.currentTarget)
              if (bookmark && bookmark.start === bookmark.end && localValue.current[bookmark.end - 1] === '@') {
                openPicker({ start: bookmark.end - 1, end: bookmark.end })
              }
            }
          }} onKeyUp={rememberSelection}
          onMouseUp={() => { if (pickerSession.current) closePicker(); rememberSelection() }} onFocus={rememberSelection}
          onBeforeInput={event => {
            const native = event.nativeEvent as InputEvent
            if (composing.current || native.isComposing) return
            if (native.inputType === 'insertText' && native.data === '@') {
              event.preventDefault()
              const safe = atomicRange(localValue.current, captureSelection(event.currentTarget) ?? lastBookmark.current)
              if (replaceRange(safe, '@')) openPicker({ start: safe.start, end: safe.start + 1 })
            } else if (native.inputType === 'insertParagraph' || native.inputType === 'insertLineBreak') {
              event.preventDefault()
              replaceRange(captureSelection(event.currentTarget) ?? lastBookmark.current, '\n', true)
            } else if (native.inputType === 'deleteContentBackward' || native.inputType === 'deleteContentForward') {
              if (deleteAtomic(native.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete')) event.preventDefault()
            }
          }}
          onCompositionStart={() => {
            composing.current = true
            compositionVersion.current++
            pendingExternal.current = null
            updatePicker(null)
          }}
          onCompositionEnd={event => {
            const composedText = event.data
            const version = compositionVersion.current
            // Browsers may emit a final input after compositionend; defer normalization
            // until that event has finished, never replace nodes owned by a live IME.
            queueMicrotask(() => {
              if (!mounted.current || version !== compositionVersion.current) return
              composing.current = false
              if (pendingExternal.current !== null) {
                const external = pendingExternal.current
                pendingExternal.current = null
                buildDOM(external, { start: external.length, end: external.length })
              } else {
                synchronizeInput()
                if (composedText === '@' && rootRef.current) {
                  const bookmark = captureSelection(rootRef.current)
                  if (bookmark && bookmark.start === bookmark.end && localValue.current[bookmark.end - 1] === '@') {
                    openPicker({ start: bookmark.end - 1, end: bookmark.end })
                  }
                }
              }
              setCompositionTick(tick => tick + 1)
            })
          }}
          onPaste={event => {
            event.preventDefault()
            if (composing.current) return
            updatePicker(null)
            replaceRange(captureSelection(event.currentTarget) ?? lastBookmark.current, event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'), true)
          }}
          onCopy={event => {
            const selection = captureSelection(event.currentTarget)
            if (!selection || selection.start === selection.end) return
            event.preventDefault()
            const safe = atomicRange(localValue.current, selection)
            event.clipboardData.setData('text/plain', serializeVideoPrompt(localValue.current.slice(safe.start, safe.end), references, false))
          }}
          onCut={event => {
            if (composing.current) return
            const selection = captureSelection(event.currentTarget)
            if (!selection || selection.start === selection.end) return
            event.preventDefault()
            const safe = atomicRange(localValue.current, selection)
            event.clipboardData.setData('text/plain', serializeVideoPrompt(localValue.current.slice(safe.start, safe.end), references, false))
            updatePicker(null)
            replaceRange(safe, '')
          }}
          onDragStart={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault()
            if (composing.current) return
            const text = event.dataTransfer.getData('text/plain')
            if (!text) return
            updatePicker(null)
            replaceRange(captureSelection(event.currentTarget) ?? lastBookmark.current, text.replace(/\r\n?/g, '\n'), true)
          }}
          onScroll={() => { if (pickerSession.current) closePicker() }}
        />
        {!displayValue && <span className="vpe-placeholder">{placeholder}</span>}
        <span id={counterId} className="vpe-counter">{count}/{maxLength}</span>
      </div>
      {chips.map(chip => {
        const current = currentById.get(chip.mention.id)
        const removed = !current || current.type !== chip.mention.type
        const label = removed ? `${chip.mention.label}（已移除）` : current.label
        return createPortal(<span className="vpe-chip-body">
          <span className="vpe-chip-thumb"><VideoMentionThumbnail item={chip.mention} removed={removed} /></span>
          <span className="vpe-chip-label">{label}</span>
        </span>, chip.element, chip.key)
      })}
      {error && !picker && <p id={errorId} role="alert" className="vpe-error">{error}</p>}
      {picker && <VideoMentionPicker ref={pickerRef} id={pickerId} anchor={picker.anchor} query={picker.query}
        onQueryChange={query => { const session = pickerSession.current; if (session) updatePicker({ ...session, query }) }}
        references={references} metadata={metadata} library={library} onPick={pick} onClose={closePicker}
        canAddLibrary={!!onAddLibrary} busy={busy} error={error} editorElement={rootRef.current} />}
    </div>
  )
}
