import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const config = require('../../build/desktop-updates.cjs')

describe('desktop update packaging', () => {
  it('keeps updater dependency in the shipped app and only builds NSIS on Windows', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.dependencies['electron-updater']).toBeTruthy()
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    for (const script of Object.values(pkg.scripts) as string[]) {
      if (script.includes('electron-builder')) expect(script).toContain('--config build/desktop-updates.cjs')
    }
  })
  it('builds latest metadata and architecture-isolated fixed HTTPS feeds', () => {
    expect(config.detectUpdateChannel).toBe(false)
    expect(config.win.publish).toMatchObject({ provider: 'generic', channel: 'latest', url: 'https://m.aittco.com/downloads/updates/win-${arch}/' })
    expect(config.mac.publish).toMatchObject({ provider: 'generic', channel: 'latest', url: 'https://m.aittco.com/downloads/updates/mac-${arch}/' })
    expect(config.mac.target).toEqual(['dmg', 'zip'])
    expect(config.mac.hardenedRuntime).toBe(true)
    expect(config.files).toContain('electron/**/*')
  })
})
