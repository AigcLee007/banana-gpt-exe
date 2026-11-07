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
export function validateRelease({ input, version }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version')
  const result = []
  for (const platform of platforms) {
    const dir = join(resolve(input), platform)
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error(`Missing platform directory: ${platform}`)
    const manifest = platform === 'win-x64' ? 'latest.yml' : 'latest-mac.yml'
    const metadata = yaml.load(readFileSync(regularFile(dir, manifest), 'utf8'), { schema: yaml.JSON_SCHEMA })
    if (!metadata || metadata.version !== version) throw new Error(`${platform}: metadata version does not match package version`)
    if (!Array.isArray(metadata.files) || metadata.files.length === 0) throw new Error(`${platform}: no files in manifest`)
    const files = new Set()
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
    if (platform !== 'win-x64') {
      const installers = readdirSync(dir).filter((name) => name.endsWith('.dmg'))
      if (installers.length !== 1 || !installers[0].includes(version)) throw new Error(`${platform}: missing or ambiguous .dmg installer for version`)
      regularFile(dir, installers[0])
      files.add(installers[0])
    }
    const extensions = platform === 'win-x64' ? ['.exe'] : ['.zip']
    for (const ext of extensions) if (![...files].some((name) => name.endsWith(ext))) throw new Error(`${platform}: missing ${ext} payload`)
    if (platform === 'win-x64' && [...files].some((name) => !name.endsWith('.exe'))) throw new Error('Windows feed must contain only NSIS .exe installers')
    for (const name of [...files]) {
      if (platform === 'win-x64' || existsSync(join(dir, `${name}.blockmap`))) {
        regularFile(dir, `${name}.blockmap`)
        files.add(`${name}.blockmap`)
      }
    }
    // Include additional builder-generated blockmaps, never arbitrary build outputs.
    for (const name of readdirSync(dir)) if (name.endsWith('.blockmap')) {
      safeFilename(name)
      if (!files.has(name.replace(/\.blockmap$/, ''))) throw new Error(`${platform}: orphan blockmap`)
      regularFile(dir, name)
      files.add(name)
    }
    if (platform !== 'win-x64') {
      const receiptPath = join(dir, 'signing-verification.json')
      if (!existsSync(receiptPath)) throw new Error(`${platform}: missing signing verification receipt`)
      const receipt = JSON.parse(readFileSync(regularFile(dir, 'signing-verification.json'), 'utf8'))
      if (receipt.version !== version || receipt.platform !== platform || receipt.signed !== true || receipt.notarized !== true) throw new Error(`${platform}: invalid signing verification receipt`)
      for (const name of files) if (!name.endsWith('.blockmap') && receipt.files?.[name] !== sha512(join(dir, name))) throw new Error(`${platform}: signing receipt hash mismatch`)
      files.add('signing-verification.json')
    }
    files.add(manifest)
    result.push({ platform, dir, manifest, files: [...files], installer: [...files].find((name) => name.endsWith(platform === 'win-x64' ? '.exe' : '.dmg')) })
  }
  return result
}
export function prepareRelease({ input, output, version, notes = '' }) {
  const feeds = validateRelease({ input, version })
  if (existsSync(output)) throw new Error('Staging output already exists; choose a new directory')
  mkdirSync(output, { recursive: true })
  const index = { version, files: [] }
  const add = (name) => index.files.push({ path: name, sha512: sha512(join(output, name)), size: lstatSync(join(output, name)).size })
  for (const feed of feeds) {
    mkdirSync(join(output, feed.platform))
    for (const name of feed.files) {
      copyFileSync(join(feed.dir, name), join(output, feed.platform, name))
      add(`${feed.platform}/${name}`)
    }
  }
  const url = (platform) => `/downloads/updates/${platform}/${feeds.find((feed) => feed.platform === platform).installer}`
  writeFileSync(join(output, 'version.json'), JSON.stringify({ version, notes, desktop: { downloadPage: 'https://m.aittco.com/downloads/' }, downloads: { windowsUrl: url('win-x64'), macosArm64Url: url('mac-arm64'), macosX64Url: url('mac-x64') } }, null, 2) + '\n')
  add('version.json')
  writeFileSync(join(output, 'release-index.json'), JSON.stringify(index, null, 2) + '\n')
  return index
}
export function publicationPlan() { return ['validate-local', 'upload-complete-stage', 'verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'] }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/desktop-release.mjs <platform-artifact-root> <new-stage-directory>')
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const notes = process.env.RELEASE_NOTES || ''
  const index = prepareRelease({ input, output, version, notes })
  console.log(`Validated and staged ${version}: ${index.files.length} files. No live feeds changed.`)
}
