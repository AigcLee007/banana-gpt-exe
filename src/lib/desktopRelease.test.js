import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { prepareRelease, validateRelease, publicationPlan } from '../../scripts/desktop-release.mjs'
import { releasePreflight } from '../../scripts/desktop-release-preflight.mjs'

const yaml = createRequire(import.meta.url)('js-yaml')
const roots = []
const version = '0.4.6-banana.20'
const hash = (data) => createHash('sha512').update(data).digest('base64')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-release-'))
  roots.push(root)
  for (const platform of ['win-x64', 'mac-arm64', 'mac-x64']) {
    const dir = join(root, platform)
    mkdirSync(dir)
    const extensions = platform === 'win-x64' ? ['exe'] : ['dmg', 'zip']
    const files = extensions.map((ext) => {
      const url = `banana-${version}-${platform}.${ext}`
      const data = Buffer.from(`fixture ${platform} ${ext}`)
      writeFileSync(join(dir, url), data)
      if (ext !== 'zip') writeFileSync(join(dir, `${url}.blockmap`), 'blockmap fixture')
      return { url, sha512: hash(data), size: data.length }
    })
    writeFileSync(join(dir, platform === 'win-x64' ? 'latest.yml' : 'latest-mac.yml'), yaml.dump({ version, files, path: files[0].url, sha512: files[0].sha512 }))
    if (platform !== 'win-x64') writeFileSync(join(dir, 'signing-verification.json'), JSON.stringify({ version, platform, signed: true, notarized: true, files: Object.fromEntries(files.map((f) => [f.url, f.sha512])) }))
  }
  return root
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('native release publication', () => {
  it('validates all three feeds and stages usable installers plus all metadata', () => {
    const root = fixture()
    const staged = join(root, 'stage')
    prepareRelease({ input: root, output: staged, version, notes: 'Release notes' })
    const legacy = JSON.parse(readFileSync(join(staged, 'version.json'), 'utf8'))
    expect(legacy.version).toBe(version)
    expect(legacy.downloads.windowsUrl).toMatch(/\.exe$/)
    expect(legacy.downloads.macosArm64Url).toMatch(/mac-arm64\.dmg$/)
    expect(JSON.parse(readFileSync(join(staged, 'release-index.json'), 'utf8')).files.length).toBeGreaterThan(10)
  })
  it('rejects a mismatched SHA512 before staging', () => {
    const root = fixture()
    writeFileSync(join(root, 'win-x64', `banana-${version}-win-x64.exe`), 'tampered')
    expect(() => validateRelease({ input: root, version })).toThrow(/SHA512/)
  })
  it('rejects a missing Mac build and unsigned Mac receipts', () => {
    const root = fixture()
    rmSync(join(root, 'mac-arm64', 'signing-verification.json'))
    expect(() => validateRelease({ input: root, version })).toThrow(/signing/)
    rmSync(join(root, 'mac-x64'), { recursive: true })
    expect(() => validateRelease({ input: root, version })).toThrow()
  })
  it.each(['../outside.exe', 'https://evil.invalid/file.exe', '%2e%2e%2foutside.exe', 'C:\\outside.exe'])('rejects unsafe metadata paths: %s', (url) => {
    const root = fixture()
    const path = join(root, 'win-x64', 'latest.yml')
    const metadata = yaml.load(readFileSync(path, 'utf8'))
    metadata.files[0].url = url
    writeFileSync(path, yaml.dump(metadata))
    expect(() => validateRelease({ input: root, version })).toThrow(/filename/)
  })
  it('rejects metadata from another version', () => {
    const root = fixture()
    expect(() => validateRelease({ input: root, version: '0.4.6-banana.21' })).toThrow(/version/)
  })
  it('accepts a separately distributed DMG when the native metadata lists only ZIP', () => {
    const root = fixture()
    for (const platform of ['mac-arm64', 'mac-x64']) {
      const path = join(root, platform, 'latest-mac.yml')
      const metadata = yaml.load(readFileSync(path, 'utf8'))
      metadata.files = metadata.files.filter((file) => file.url.endsWith('.zip'))
      metadata.path = metadata.files[0].url
      metadata.sha512 = metadata.files[0].sha512
      writeFileSync(path, yaml.dump(metadata))
    }
    expect(validateRelease({ input: root, version })).toHaveLength(3)
  })
  it('blocks publication without signing and SSH credentials before any upload', () => {
    expect(() => releasePreflight({ DESKTOP_RELEASE: 'true' })).toThrow(/MAC_CSC_LINK.*UPDATES_SSH_KNOWN_HOSTS/)
    expect(releasePreflight({ DESKTOP_RELEASE: 'false' })).toEqual({ publish: false })
  })
  it('allows electron-builder v26 to discover the imported Mac signing identity', () => {
    const workflow = yaml.load(readFileSync(join(process.cwd(), '.github', 'workflows', 'desktop-build.yml'), 'utf8'))
    expect(workflow.jobs['build-macos'].env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('true')
  })
  it('orders complete artifact transfer and verification before the atomic feed and legacy manifest switch', () => {
    expect(publicationPlan()).toEqual(['validate-local', 'upload-complete-stage', 'verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'])
  })
})

// The remote publisher targets Linux and uses a real flock; Windows packaging runs skip these.
describe.skipIf(process.platform !== 'linux')('remote atomic publication', () => {
  function remoteFixture(change) {
    const root = fixture()
    const stage = join(root, 'stage')
    prepareRelease({ input: root, output: stage, version })
    change?.(stage)
    const remote = join(root, 'remote')
    mkdirSync(join(remote, '.incoming'), { recursive: true })
    mkdirSync(join(remote, 'releases', '0.4.5'), { recursive: true })
    writeFileSync(join(remote, 'releases', '0.4.5', 'version.json'), JSON.stringify({ version: '0.4.5' }))
    symlinkSync('releases/0.4.5', join(remote, 'current'))
    const token = '0123456789abcdef01234567'
    execFileSync('tar', ['-czf', join(remote, '.incoming', `${token}.tar.gz`), '-C', stage, '.'])
    return { remote, token }
  }
  function publish({ remote, token }) {
    const code = `import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('publisher',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nroot=Path(sys.argv[2])\nprint(json.dumps(m.publish_archive(root/'.incoming'/(sys.argv[3]+'.tar.gz'),root,sys.argv[4],sys.argv[3])))`
    return JSON.parse(execFileSync('python3', ['-c', code, join(process.cwd(), 'scripts', 'publish-desktop-release.py'), remote, token, version], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  }
  it('verifies all payloads and publishes all native feeds and legacy JSON in the last pointer switch', () => {
    const context = remoteFixture()
    expect(publish(context)).toEqual(['verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'])
    expect(readlinkSync(join(context.remote, 'current'))).toBe(`releases/${version}`)
    expect(JSON.parse(readFileSync(join(context.remote, 'current', 'version.json'), 'utf8')).version).toBe(version)
    expect(readFileSync(join(context.remote, 'artifacts', 'win-x64', `banana-${version}-win-x64.exe`), 'utf8')).toContain('fixture')
    expect(readFileSync(join(context.remote, 'current', 'mac-arm64', 'latest-mac.yml'), 'utf8')).toContain(version)
  })
  it.each(['corrupt', 'missing'])('keeps all previous public metadata on %s upload', (kind) => {
    const context = remoteFixture((stage) => {
      const file = join(stage, 'mac-arm64', `banana-${version}-mac-arm64.zip`)
      if (kind === 'corrupt') writeFileSync(file, 'corrupt')
      else rmSync(file)
    })
    expect(() => publish(context)).toThrow()
    expect(readlinkSync(join(context.remote, 'current'))).toBe('releases/0.4.5')
    expect(JSON.parse(readFileSync(join(context.remote, 'current', 'version.json'), 'utf8')).version).toBe('0.4.5')
  })
})
