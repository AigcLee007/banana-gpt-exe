import type { ApiProfile, AppSettings } from '../types'
import { DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS, mergePortalProfile } from './apiProfiles'

// Portal connections use their own gateway; the desktop fixed endpoint only
// applies when the application is running without a Portal shell.
export function normalizeEditorProfile(profile: ApiProfile, portal: boolean): ApiProfile {
  const preserveAddress = portal || profile.locked || profile.provider === 'fal'
  return {
    ...profile,
    baseUrl: preserveAddress
      ? profile.baseUrl.trim().replace(/\/+$/, '') || (profile.provider === 'fal' ? DEFAULT_FAL_BASE_URL : DEFAULT_SETTINGS.baseUrl)
      : DEFAULT_SETTINGS.baseUrl,
    apiProxy: profile.locked ? false : profile.apiProxy,
  }
}

export async function loadPortalConnection(settings: AppSettings, fetcher: typeof fetch = fetch): Promise<AppSettings> {
  const response = await fetcher('/_portal/api/bootstrap', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('站点连接暂不可用，请重试或重新登录。')
  const bootstrap = await response.json()
  if (!bootstrap || typeof bootstrap.baseUrl !== 'string' || !bootstrap.baseUrl.trim()
    || typeof bootstrap.key !== 'string' || !bootstrap.key.trim()) {
    throw new Error('站点连接尚未准备好，请重试或重新登录。')
  }
  return mergePortalProfile(settings, bootstrap)
}
