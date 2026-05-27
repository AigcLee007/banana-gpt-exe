import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { readRuntimeEnv } from './runtimeEnv'
import type { AppSettings } from '../types'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)

  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}

export interface ApiKeyBalanceInfo {
  success: true
  total_points: number
  used_points: number
  remaining_points: number
}

interface QueryApiKeyBalanceOptions {
  settings: AppSettings
  apiKey?: string
}

const POINTS_PER_USD = 12.5
const BALANCE_USAGE_START_DATE = '2023-01-01'

function getTomorrowDateString() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const year = tomorrow.getFullYear()
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const day = String(tomorrow.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getBalanceUpstreamBaseUrl() {
  const fromViteAittco = readRuntimeEnv(import.meta.env.VITE_AITTCO_UPSTREAM_URL)
  if (fromViteAittco) return fromViteAittco

  const fromViteUpstream = readRuntimeEnv(import.meta.env.VITE_UPSTREAM_URL)
  if (fromViteUpstream) return fromViteUpstream

  const fromBuildAittco = readRuntimeEnv(typeof __AITTCO_UPSTREAM_URL__ === 'string' ? __AITTCO_UPSTREAM_URL__ : undefined)
  if (fromBuildAittco) return fromBuildAittco

  const fromBuildUpstream = readRuntimeEnv(typeof __UPSTREAM_URL__ === 'string' ? __UPSTREAM_URL__ : undefined)
  if (fromBuildUpstream) return fromBuildUpstream

  return 'https://vip.aittco.com'
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseTotalQuotaUsd(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const record = payload as Record<string, unknown>
  const candidates = [record.hard_limit_usd, record.system_hard_limit_usd, record.soft_limit_usd, record.total_quota_usd]
  for (const item of candidates) {
    const value = ensureNumber(item)
    if (value != null && value >= 0) return value
  }
  return 0
}

function parseUsedAmountUsd(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const record = payload as Record<string, unknown>

  const usdCandidates = [record.used_amount_usd, record.total_usage_usd, record.total_amount_usd]
  for (const item of usdCandidates) {
    const value = ensureNumber(item)
    if (value != null && value >= 0) return value
  }

  const centsCandidates = [record.total_usage, record.used_amount, record.total_amount]
  for (const item of centsCandidates) {
    const value = ensureNumber(item)
    if (value != null && value >= 0) return value / 100
  }
  return 0
}

function toPoints(usd: number): number {
  return Math.max(0, Math.floor(usd * POINTS_PER_USD))
}

function redactSecret(text: string, secret: string) {
  if (!secret) return text
  return text.split(secret).join('[REDACTED]')
}

async function fetchBillingJson(url: string, apiKey: string, timeoutSeconds: number, messagePrefix: string) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: controller.signal,
    })
    const rawText = await response.text()
    let payload: unknown = null
    try {
      payload = rawText ? JSON.parse(rawText) : null
    } catch {
      payload = rawText
    }

    if (!response.ok) {
      const detail = typeof payload === 'object' && payload && 'error' in (payload as Record<string, unknown>)
        ? JSON.stringify((payload as Record<string, unknown>).error)
        : (typeof payload === 'string' && payload.trim() ? payload.trim() : response.statusText)
      throw new Error(redactSecret(`${messagePrefix}失败：${detail || `HTTP ${response.status}`}`, apiKey))
    }
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${messagePrefix}失败：请求超时`)
    }
    if (error instanceof Error) {
      throw new Error(redactSecret(error.message, apiKey))
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function queryApiKeyBalance(options: QueryApiKeyBalanceOptions): Promise<ApiKeyBalanceInfo> {
  const profile = getActiveApiProfile(options.settings)
  const apiKey = (options.apiKey ?? profile.apiKey).trim()
  if (!apiKey) throw new Error('请先填写 API Key')

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const baseUrl = getBalanceUpstreamBaseUrl()

  const usagePath = `dashboard/billing/usage?start_date=${BALANCE_USAGE_START_DATE}&end_date=${getTomorrowDateString()}`
  const subscriptionUrl = buildApiUrl(baseUrl, 'dashboard/billing/subscription', proxyConfig, useApiProxy)
  const usageUrl = buildApiUrl(baseUrl, usagePath, proxyConfig, useApiProxy)

  const [subscriptionPayload, usagePayload] = await Promise.all([
    fetchBillingJson(subscriptionUrl, apiKey, profile.timeout, '查询总额度'),
    fetchBillingJson(usageUrl, apiKey, profile.timeout, '查询已用额度'),
  ])

  const totalPoints = toPoints(parseTotalQuotaUsd(subscriptionPayload))
  const usedPoints = toPoints(parseUsedAmountUsd(usagePayload))
  const remainingPoints = Math.max(0, totalPoints - usedPoints)

  return {
    success: true,
    total_points: totalPoints,
    used_points: usedPoints,
    remaining_points: remainingPoints,
  }
}
