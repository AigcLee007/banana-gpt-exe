import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { safeFilename, sha512 } from './desktop-release.mjs'

if (process.platform !== 'darwin') throw new Error('macOS signing verification requires a macOS runner')
const [architecture, artifactDirectory = 'release'] = process.argv.slice(2)
if (!['arm64', 'x64'].includes(architecture)) throw new Error('Usage: node scripts/verify-mac-release.mjs <arm64|x64> [artifact-directory]')
if (!/^[A-Z0-9]{10}$/.test(process.env.APPLE_TEAM_ID || '')) throw new Error('APPLE_TEAM_ID is required to verify signing identity')
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const dir = resolve(artifactDirectory)
const yaml = createRequire(import.meta.url)('js-yaml')
const metadata = yaml.load(readFileSync(join(dir, 'latest-mac.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA })
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (metadata.version !== version) throw new Error('Mac metadata version mismatch')
const temporary = mkdtempSync(join(tmpdir(), 'verify-mac-release-'))
function verifyApp(container) {
  const names = readdirSync(container).filter((name) => name.endsWith('.app'))
  if (names.length !== 1) throw new Error('Expected exactly one application in installer')
  const app = join(container, names[0])
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  // codesign writes identity details to stderr on success.
  const result = spawnSync('codesign', ['--display', '--verbose=4', app], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Unable to inspect macOS signing identity')
  const combined = `${result.stdout}${result.stderr}`
  if (!combined.includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID}`) || !combined.includes('Authority=Developer ID Application:') || !combined.includes('(runtime)')) throw new Error('App is not hardened Developer ID signed by the configured Apple team')
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
  run('xcrun', ['stapler', 'validate', app])
  const executable = run('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')]).trim()
  safeFilename(executable)
  const architectures = run('lipo', ['-archs', join(app, 'Contents', 'MacOS', executable)]).trim().split(/\s+/)
  if (!architectures.includes(architecture === 'x64' ? 'x86_64' : 'arm64')) throw new Error('Installer application has the wrong architecture')
}
const files = {}
try {
  for (const extension of ['.zip', '.dmg']) {
    const entries = extension === '.dmg'
      ? readdirSync(dir).filter((name) => safeFilename(name).endsWith('.dmg') && name.includes(version)).map((url) => ({ url }))
      : metadata.files.filter((file) => safeFilename(file.url).endsWith(extension))
    if (entries.length !== 1) throw new Error(`Expected exactly one ${extension} payload`)
    const file = join(dir, entries[0].url)
    if (entries[0].sha512 && sha512(file) !== entries[0].sha512) throw new Error('Mac artifact SHA512 mismatch')
    const destination = join(temporary, extension.slice(1))
    mkdirSync(destination)
    if (extension === '.zip') {
      run('ditto', ['-x', '-k', file, destination])
      verifyApp(destination)
    } else {
      run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', destination, file])
      try { verifyApp(destination) } finally { run('hdiutil', ['detach', destination]) }
    }
    files[entries[0].url] = sha512(file)
  }
  writeFileSync(join(dir, 'signing-verification.json'), JSON.stringify({ version, platform: `mac-${architecture}`, teamId: process.env.APPLE_TEAM_ID, signed: true, notarized: true, files }, null, 2) + '\n')
  console.log(`Verified signed and notarized mac-${architecture} ZIP and DMG applications`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
