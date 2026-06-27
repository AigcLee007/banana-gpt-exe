import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApiUrl, normalizeDevProxyConfig } from './devProxy'

describe('buildApiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('keeps the v1 segment when the configured API URL does not include it', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/v1/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured proxy target to normalize same-origin proxy paths', () => {
    const proxyConfig = normalizeDevProxyConfig({
      enabled: true,
      prefix: '/api-proxy',
      target: 'https://vip.aittco.com/v1',
    })

    expect(buildApiUrl('https://vip.aittco.com', 'images/generations', proxyConfig, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses the runtime default API URL to normalize locked Docker proxy paths', () => {
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://vip.aittco.com/v1')

    expect(buildApiUrl('https://m.aittco.com/custom-prefix/v1', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses the runtime default API URL when a saved proxy base URL is missing the v1 segment', () => {
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://vip.aittco.com/v1')

    expect(buildApiUrl('https://vip.aittco.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })
})
