import { describe, expect, it } from 'vitest'
import {
  STREAMING_FORMAT_HINT,
  STREAMING_UNSUPPORTED_HINT,
  appendStreamingFormatHint,
  appendStreamingUnsupportedHint,
  maybeAppendStreamingHint,
} from './imageApiShared'

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
