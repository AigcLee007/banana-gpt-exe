import type { InputImage } from '../types'

const MENTION_START = '\u2063'
const MENTION_END = '\u2064'
const SELECTED_IMAGE_MENTION_RE = /\u2063@图(\d+)\u2064/g

export interface AtImageQuery {
  start: number
  query: string
}

export function getImageMentionLabel(index: number) {
  return `@图${index + 1}`
}

export function getSelectedImageMentionLabel(index: number) {
  return `${MENTION_START}${getImageMentionLabel(index)}${MENTION_END}`
}

export function stripImageMentionMarkers(prompt: string): string {
  return prompt.replace(/[\u2063\u2064]/g, '')
}

export function getPromptIndexFromVisibleIndex(prompt: string, visibleIndex: number): number {
  let visible = 0
  for (let i = 0; i < prompt.length; i++) {
    if (prompt[i] === MENTION_START || prompt[i] === MENTION_END) continue
    if (visible >= visibleIndex) return i
    visible++
  }
  return prompt.length
}

export function getAtImageQuery(prompt: string, cursor: number, inputImages: InputImage[]): AtImageQuery | null {
  if (inputImages.length === 0) return null

  const visiblePrompt = stripImageMentionMarkers(prompt)
  const visibleCursor = stripImageMentionMarkers(prompt.slice(0, cursor)).length
  const beforeCursor = visiblePrompt.slice(0, visibleCursor)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return null

  const query = beforeCursor.slice(atIndex + 1)
  if (/\s/.test(query)) return null
  return { start: atIndex, query }
}

export function imageMentionMatches(query: string, index: number) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const oneBasedIndex = String(index + 1)
  const label = `图${oneBasedIndex}`
  return oneBasedIndex.includes(normalized) || label.toLowerCase().includes(normalized)
}

export function insertImageMentionAtVisibleRange(prompt: string, start: number, cursor: number, imageIndex: number) {
  const promptStart = getPromptIndexFromVisibleIndex(prompt, start)
  const promptCursor = getPromptIndexFromVisibleIndex(prompt, cursor)
  const mention = getSelectedImageMentionLabel(imageIndex)
  const visibleMention = getImageMentionLabel(imageIndex)
  return {
    prompt: `${prompt.slice(0, promptStart)}${mention}${prompt.slice(promptCursor)}`,
    cursor: promptStart + mention.length,
    visibleCursor: start + visibleMention.length,
  }
}

export function remapImageMentionsForOrder(
  prompt: string,
  previousImages: InputImage[],
  nextImages: InputImage[],
  equivalentImageIds: Record<string, string> = {},
): string {
  return prompt.replace(SELECTED_IMAGE_MENTION_RE, (text, n) => {
    const previousImage = previousImages[Number(n) - 1]
    if (!previousImage) return text

    const nextImageId = equivalentImageIds[previousImage.id] ?? previousImage.id
    const nextIndex = nextImages.findIndex((img) => img.id === nextImageId)
    return nextIndex >= 0 ? getSelectedImageMentionLabel(nextIndex) : '@已移除图片'
  })
}

export function replaceImageMentionsForApi(prompt: string, imageCount?: number): string {
  return prompt.replace(SELECTED_IMAGE_MENTION_RE, (text, n) => {
    const index = Number(n) - 1
    if (imageCount != null && (index < 0 || index >= imageCount)) return stripImageMentionMarkers(text)
    return `[image ${n}]`
  })
}
