import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
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
    expect(config.mac.publish).toBeUndefined()
    expect(config.mac.target).toEqual(['dmg'])
    expect(config.files).toContain('electron/**/*')
  })
  it('removes blank signing variables before electron-builder reads certificate paths', () => {
    const names = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']
    const output = execFileSync(process.execPath, ['-e', `require('./build/desktop-updates.cjs'); process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, process.env[name]]))))`], {
      cwd: process.cwd(),
      env: { ...process.env, ...Object.fromEntries(names.map(name => [name, ''])) },
      encoding: 'utf8',
    })
    expect(JSON.parse(output)).toEqual({})
  })
  it('preserves configured signing credentials', () => {
    const output = execFileSync(process.execPath, ['-e', `require('./build/desktop-updates.cjs'); process.stdout.write(String(process.env.CSC_LINK === 'configured.p12' && process.env.CSC_KEY_PASSWORD === 'test-password'))`], {
      cwd: process.cwd(),
      env: { ...process.env, CSC_LINK: 'configured.p12', CSC_KEY_PASSWORD: 'test-password' },
      encoding: 'utf8',
    })
    expect(output).toBe('true')
  })
})
