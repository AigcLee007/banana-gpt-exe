// Validate configuration before any published build or network mutation. Never print secrets.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function releasePreflight(env = process.env) {
  if (env.DESKTOP_RELEASE !== 'true') return { publish: false }
  const mode = env.DESKTOP_RELEASE_MODE || 'complete'
  if (!['complete', 'windows-only', 'manual-mac'].includes(mode)) throw new Error('Invalid desktop release mode')
  const required = [
    ...(mode === 'complete' ? ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] : []),
    'UPDATES_SSH_HOST', 'UPDATES_SSH_USER', 'UPDATES_SSH_PORT', 'UPDATES_SSH_PRIVATE_KEY', 'UPDATES_SSH_KNOWN_HOSTS',
  ]
  const missing = required.filter((name) => !env[name]?.trim())
  if (missing.length) throw new Error(`Publication blocked; configure GitHub Secrets: ${missing.join(', ')}`)
  if (!/^[A-Za-z0-9.-]+$/.test(env.UPDATES_SSH_HOST) || env.UPDATES_SSH_HOST.startsWith('-')) throw new Error('Invalid SSH host')
  if (!/^[a-z_][a-z0-9_-]*$/i.test(env.UPDATES_SSH_USER) || env.UPDATES_SSH_USER === 'root') throw new Error('Invalid SSH user; use a restricted non-root account')
  if (!/^\d+$/.test(env.UPDATES_SSH_PORT) || +env.UPDATES_SSH_PORT < 1 || +env.UPDATES_SSH_PORT > 65535) throw new Error('Invalid SSH port')
  if (mode === 'complete' && !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('Invalid Apple Team ID')
  if (Boolean(env.WIN_CSC_LINK) !== Boolean(env.WIN_CSC_KEY_PASSWORD)) throw new Error('Configure both WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD, or neither')
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag must equal v plus package.json version')
  return { publish: true, mode, version }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = releasePreflight()
  console.log(result.publish ? `Release preflight passed for ${result.version}` : 'Build-only run: live publication disabled')
}
