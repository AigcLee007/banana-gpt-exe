import { describe, expect, it } from 'vitest'
import {
  STREAMING_FORMAT_HINT,
  STREAMING_UNSUPPORTED_HINT,
  appendStreamingFormatHint,
  appendStreamingUnsupportedHint,
  maybeAppendStreamingHint,
  normalizeBase64Image,
  detectImageOutputFormat,
  fetchImageUrlAsDataUrl,
} from './imageApiShared'

describe('actual image output format', () => {
  it('uses PNG bytes rather than the requested SVG MIME for base64 output', () => {
    expect(normalizeBase64Image('iVBORw0KGgo=', 'image/svg+xml')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(normalizeBase64Image('data:image/svg+xml;base64,iVBORw0KGgo=', 'image/svg+xml')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('preserves genuine SVG source including XML declarations and comments', () => {
    const source = btoa('<?xml version="1.0"?><!-- drawing --><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')
    expect(normalizeBase64Image(source, 'image/png')).toBe(`data:image/svg+xml;base64,${source}`)
  })

  it.each([
    '<!--' + 'x'.repeat(4000) + '--><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<!DOCTYPE svg [<!ENTITY x "label">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<s:svg xmlns:s="http://www.w3.org/2000/svg"/>',
  ])('recognizes SVG roots after XML prologs and with namespace prefixes', (source) => {
    expect(detectImageOutputFormat(`data:image/svg+xml;base64,${btoa(source)}`)).toBe('svg')
  })

  it('normalizes data URL responses without fetching or changing their bytes', async () => {
    expect(await fetchImageUrlAsDataUrl('data:image/svg+xml;base64,iVBORw0KGgo=', 'image/svg+xml'))
      .toBe('data:image/png;base64,iVBORw0KGgo=')
  })
})

describe('imageApiShared streaming hint helpers', () => {
  it('appends unsupported hint', () => {
    expect(appendStreamingUnsupportedHint('Request failed')).toBe(`Request failed${STREAMING_UNSUPPORTED_HINT}`)
  })

  it('appends format hint', () => {
    expect(appendStreamingFormatHint('Request failed')).toBe(`Request failed${STREAMING_FORMAT_HINT}`)
  })

  it('appends unsupported hint only for retryable non-auth non-not-found non-timeout non-rate-limit non-5xx statuses when streamImages is enabled', () => {
    expect(maybeAppendStreamingHint('Request failed', 400, true)).toBe(`Request failed${STREAMING_UNSUPPORTED_HINT}`)
    expect(maybeAppendStreamingHint('Request failed', 422, true)).toBe(`Request failed${STREAMING_UNSUPPORTED_HINT}`)
    expect(maybeAppendStreamingHint('Request failed', 401, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 403, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 404, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 408, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 429, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 500, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 503, true)).toBe('Request failed')
    expect(maybeAppendStreamingHint('Request failed', 400, false)).toBe('Request failed')
  })
})
