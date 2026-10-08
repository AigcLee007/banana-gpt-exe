import type { VideoReferenceItem, VideoReferenceType } from './videoTypes'

export interface VideoMention { id: string; type: VideoReferenceType; label: string }
const TOKEN = /⁣video-ref:([^⁤]+)⁤/g
const TYPE_NAMES = { image: '图片', video: '视频', audio: '音频' } as const

export function labelVideoReferences(items: readonly VideoReferenceItem[]) {
  const counts = { image: 0, video: 0, audio: 0 }
  return items.map((item, index) => {
    const typeOrdinal = ++counts[item.type]
    return { ...item, label: `${TYPE_NAMES[item.type]}${typeOrdinal}`, ordinal: index + 1, typeOrdinal }
  })
}

export function encodeVideoMention(mention: VideoMention): string {
  return `⁣video-ref:${encodeURIComponent(JSON.stringify(mention))}⁤`
}

export function parseVideoPrompt(prompt: string): Array<{ kind: 'text'; text: string } | { kind: 'mention'; mention: VideoMention; raw: string }> {
  const parts: ReturnType<typeof parseVideoPrompt> = []
  let offset = 0
  for (const match of prompt.matchAll(TOKEN)) {
    if (match.index! > offset) parts.push({ kind: 'text', text: prompt.slice(offset, match.index) })
    try {
      const mention = JSON.parse(decodeURIComponent(match[1])) as VideoMention
      if (!mention.id || !['image', 'video', 'audio'].includes(mention.type) || typeof mention.label !== 'string') throw new Error('invalid mention')
      parts.push({ kind: 'mention', mention, raw: match[0] })
    } catch { parts.push({ kind: 'text', text: match[0] }) }
    offset = match.index! + match[0].length
  }
  if (offset < prompt.length) parts.push({ kind: 'text', text: prompt.slice(offset) })
  return parts
}

export function getFrameReferences(firstFrameId?: string | null, lastFrameId?: string | null): VideoReferenceItem[] {
  const ids = [firstFrameId, lastFrameId].filter((id): id is string => Boolean(id))
  return [...new Set(ids)].map((id) => ({ id, type: 'image' }))
}

/** UI token IDs never go upstream. This is readable context, not an undocumented H3 tag protocol. */
export function serializeVideoPrompt(prompt: string, references: readonly VideoReferenceItem[], requireReferences = true): string {
  const labels = labelVideoReferences(references)
  return parseVideoPrompt(prompt).map((part) => {
    if (part.kind === 'text') return part.text
    const ref = labels.find((item) => item.id === part.mention.id && item.type === part.mention.type)
    if (!ref && requireReferences) throw new Error(`引用的${part.mention.label}已移除，请删除标签或重新添加素材`)
    return ref?.label ?? part.mention.label
  }).join('')
}

export function visibleVideoPromptLength(prompt: string, references: readonly VideoReferenceItem[]): number {
  return serializeVideoPrompt(prompt, references, false).length
}

export function groupVideoReferences(items: readonly VideoReferenceItem[]) {
  return {
    refItems: items.map((item) => ({ ...item })),
    refImageIds: items.filter((item) => item.type === 'image').map((item) => item.id),
    refVideoIds: items.filter((item) => item.type === 'video').map((item) => item.id),
    refAudioIds: items.filter((item) => item.type === 'audio').map((item) => item.id),
  }
}
