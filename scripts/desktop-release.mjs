import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const yaml = createRequire(import.meta.url)('js-yaml')
export const platforms = ['win-x64', 'mac-arm64', 'mac-x64']
export function sha512(file) { return createHash('sha512').update(readFileSync(file)).digest('base64') }
export function safeFilename(value) {
  if (typeof value !== 'string' || !value || value !== basename(value) || /[\\/:%\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..') throw new Error(`Unsafe filename: ${String(value)}`)
  return value
}
function regularFile(dir, name) {
  safeFilename(name)
  const path = join(dir, name)
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || !realpathSync(path).startsWith(realpathSync(dir) + sep)) throw new Error(`Not a regular artifact: ${name}`)
  if (info.size === 0) throw new Error(`Empty artifact: ${name}`)
  return path
}
export function validateRelease({ input, version, mode = 'complete' }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version')
  if (!['complete', 'windows-only', 'manual-mac'].includes(mode)) throw new Error('Invalid release mode')
  const result = []
  const selectedPlatforms = mode === 'windows-only' ? ['win-x64'] : platforms
  for (const platform of selectedPlatforms) {
    const dir = join(resolve(input), platform)
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error(`Missing platform directory: ${platform}`)
    const files = new Set()
    let manifest = null
    if (platform === 'win-x64') {
      manifest = 'latest.yml'
      const metadata = yaml.load(readFileSync(regularFile(dir, manifest), 'utf8'), { schema: yaml.JSON_SCHEMA })
      if (!metadata || metadata.version !== version) throw new Error(`${platform}: metadata version does not match package version`)
      if (!Array.isArray(metadata.files) || metadata.files.length === 0) throw new Error(`${platform}: no files in manifest`)
      for (const entry of metadata.files) {
        const name = safeFilename(entry.url)
        if (!name.includes(version)) throw new Error(`${platform}: artifact filename must contain version`)
        if (files.has(name)) throw new Error(`${platform}: duplicate artifact`)
        const file = regularFile(dir, name)
        if (typeof entry.sha512 !== 'string' || sha512(file) !== entry.sha512) throw new Error(`${platform}: SHA512 mismatch: ${name}`)
        if (entry.size !== undefined && entry.size !== lstatSync(file).size) throw new Error(`${platform}: size mismatch: ${name}`)
        files.add(name)
      }
      if (metadata.path !== undefined) {
        const name = safeFilename(metadata.path)
        if (!files.has(name) || (metadata.sha512 && sha512(regularFile(dir, name)) !== metadata.sha512)) throw new Error(`${platform}: legacy manifest path or SHA512 mismatch`)
      }
      for (const name of [...files]) {
        if (!name.endsWith('.exe')) throw new Error('Windows feed must contain only NSIS .exe installers')
        regularFile(dir, `${name}.blockmap`)
        files.add(`${name}.blockmap`)
      }
      for (const name of readdirSync(dir)) if (name.endsWith('.blockmap')) {
        safeFilename(name)
        if (!files.has(name.replace(/\.blockmap$/, ''))) throw new Error(`${platform}: orphan blockmap`)
        regularFile(dir, name)
        files.add(name)
      }
      files.add(manifest)
    } else if (mode === 'manual-mac') {
      const installers = readdirSync(dir).filter((name) => name.endsWith('.dmg'))
      if (installers.length !== 1 || !installers[0].includes(version)) throw new Error(`${platform}: missing or ambiguous .dmg installer for version`)
      regularFile(dir, installers[0])
      files.add(installers[0])
    } else {
      manifest = 'latest-mac.yml'
      const metadata = yaml.load(readFileSync(regularFile(dir, manifest), 'utf8'), { schema: yaml.JSON_SCHEMA })
      if (!metadata || metadata.version !== version || !Array.isArray(metadata.files) || metadata.files.length === 0) throw new Error(`${platform}: invalid Mac update metadata`)
      for (const entry of metadata.files) {
        const name = safeFilename(entry.url)
        if (!name.includes(version)) throw new Error(`${platform}: artifact filename must contain version`)
        const file = regularFile(dir, name)
        if (typeof entry.sha512 !== 'string' || sha512(file) !== entry.sha512) throw new Error(`${platform}: SHA512 mismatch: ${name}`)
        if (entry.size !== undefined && entry.size !== lstatSync(file).size) throw new Error(`${platform}: size mismatch: ${name}`)
        files.add(name)
      }
      if (![...files].some((name) => name.endsWith('.zip'))) throw new Error(`${platform}: missing .zip update payload`)
      const installers = readdirSync(dir).filter((name) => name.endsWith('.dmg'))
      if (installers.length !== 1 || !installers[0].includes(version)) throw new Error(`${platform}: missing or ambiguous .dmg installer for version`)
      regularFile(dir, installers[0])
      files.add(installers[0])
      const receipt = JSON.parse(readFileSync(regularFile(dir, 'signing-verification.json'), 'utf8'))
      if (receipt.version !== version || receipt.platform !== platform || receipt.signed !== true || receipt.notarized !== true) throw new Error(`${platform}: invalid signing verification receipt`)
      for (const name of files) if (receipt.files?.[name] !== sha512(join(dir, name))) throw new Error(`${platform}: signing receipt hash mismatch`)
      files.add('signing-verification.json')
      files.add(manifest)
    }
    result.push({ platform, dir, manifest, files: [...files], installer: [...files].find((name) => name.endsWith(platform === 'win-x64' ? '.exe' : '.dmg')) })
  }
  return result
}
export function prepareRelease({ input, output, version, notes = '', mode = 'complete' }) {
  const feeds = validateRelease({ input, version, mode })
  if (existsSync(output)) throw new Error('Staging output already exists; choose a new directory')
  mkdirSync(output, { recursive: true })
  const index = { version, mode, files: [] }
  const add = (name) => index.files.push({ path: name, sha512: sha512(join(output, name)), size: lstatSync(join(output, name)).size })
  for (const feed of feeds) {
    mkdirSync(join(output, feed.platform))
    for (const name of feed.files) {
      copyFileSync(join(feed.dir, name), join(output, feed.platform, name))
      add(`${feed.platform}/${name}`)
    }
  }
  const url = (platform) => `/downloads/updates/${platform}/${feeds.find((feed) => feed.platform === platform).installer}`
  const downloads = { windowsUrl: url('win-x64') }
  if (mode !== 'windows-only') {
    downloads.macosArm64Url = url('mac-arm64')
    downloads.macosX64Url = url('mac-x64')
  }
  writeFileSync(join(output, 'version.json'), JSON.stringify({ version, notes, desktop: { downloadPage: 'https://m.aittco.com/downloads/' }, downloads }, null, 2) + '\n')
  add('version.json')
  writeFileSync(join(output, 'release-index.json'), JSON.stringify(index, null, 2) + '\n')
  return index
}
export function publicationPlan() { return ['validate-local', 'upload-complete-stage', 'verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'] }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, mode = 'complete'] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/desktop-release.mjs <platform-artifact-root> <new-stage-directory>')
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const notes = process.env.RELEASE_NOTES || ''
  const index = prepareRelease({ input, output, version, notes, mode })
  console.log(`Validated and staged ${version}: ${index.files.length} files. No live feeds changed.`)
}
