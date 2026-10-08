import { describe, expect, it } from 'vitest'
import { encodeVideoMention, parseVideoPrompt, labelVideoReferences, serializeVideoPrompt, groupVideoReferences, visibleVideoPromptLength } from './videoPromptMentions'
import type { VideoReferenceItem } from './videoTypes'
const refs: VideoReferenceItem[] = [{ id: 'A', type: 'image' }, { id: 'V', type: 'video' }, { id: 'B', type: 'image' }, { id: 'S', type: 'audio' }]

describe('video prompt stable references', () => {
  it('separates global ordinals from type-local labels', () => {
    expect(labelVideoReferences(refs).map(r => [r.ordinal, r.label])).toEqual([[1,'图片1'],[2,'视频1'],[3,'图片2'],[4,'音频1']])
  })
  it('roundtrips tokens without changing plain legacy text', () => {
    const token = encodeVideoMention({ id: 'B', type: 'image', label: '图片2' })
    expect(parseVideoPrompt(`前${token}后`)).toHaveLength(3)
    expect(serializeVideoPrompt(`前${token}后`, refs)).toBe('前图片2后')
    expect(serializeVideoPrompt('plain @1 @2', refs)).toBe('plain @1 @2')
  })
  it('never retargets a mention when an earlier item is removed', () => {
    const token = encodeVideoMention({ id: 'B', type: 'image', label: '图片2' })
    expect(serializeVideoPrompt(token, refs.slice(1))).toBe('图片1')
    expect(parseVideoPrompt(token)[0]).toMatchObject({ mention: { id: 'B' } })
  })
  it('rejects a deleted or mismatched reference on submit, but displays its last label', () => {
    const token = encodeVideoMention({ id: 'B', type: 'image', label: '图片2' })
    expect(() => serializeVideoPrompt(token, refs.filter(r => r.id !== 'B'))).toThrow('已移除')
    expect(serializeVideoPrompt(token, [], false)).toBe('图片2')
    expect(() => serializeVideoPrompt(token, [{ id:'B',type:'video' }])).toThrow()
  })
  it('counts visible labels rather than stored UUIDs and metadata', () => {
    const token = encodeVideoMention({ id: 'B', type: 'image', label: '图片2' })
    expect(visibleVideoPromptLength(`参照${token}`, refs)).toBe(5)
  })
  it('groups current order exactly as typed multipart fields require', () => {
    expect(groupVideoReferences(refs)).toEqual({ refItems:refs, refImageIds:['A','B'],refVideoIds:['V'],refAudioIds:['S'] })
  })
  it('keeps malformed tokens as harmless text, never evaluates them', () => {
    const prompt = '⁣video-ref:invalid⁤'
    expect(parseVideoPrompt(prompt)).toEqual([{kind:'text',text:prompt}])
  })
})
