import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { releasePreflight } from './desktop-release-preflight.mjs'
import { safeFilename, sha512 } from './desktop-release.mjs'

const result = releasePreflight()
if (!result.publish) throw new Error('Publication requires DESKTOP_RELEASE=true and all release secrets')
const [stageArgument] = process.argv.slice(2)
if (!stageArgument) throw new Error('Usage: node scripts/publish-desktop-release.mjs <validated-stage-directory>')
const stage = resolve(stageArgument)
const index = JSON.parse(readFileSync(join(stage, 'release-index.json'), 'utf8'))
if (index.version !== result.version || (index.mode || 'complete') !== result.mode) throw new Error('Staged version or mode does not match publication configuration')
for (const item of index.files) {
  const parts = item.path.split('/')
  if (parts.length > 2) throw new Error('Unsafe staging filename')
  parts.forEach(safeFilename)
  const path = join(stage, ...parts)
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || sha512(path) !== item.sha512 || lstatSync(path).size !== item.size) throw new Error('Staging artifact changed after validation')
}
const temporary = mkdtempSync(join(tmpdir(), 'desktop-publish-'))
const token = randomBytes(12).toString('hex')
const root = '/www/wwwroot/m.aittco.com/downloads/desktop-updates'
try {
  const identity = join(temporary, 'identity')
  const knownHosts = join(temporary, 'known_hosts')
  writeFileSync(identity, process.env.UPDATES_SSH_PRIVATE_KEY.replace(/\r\n/g, '\n') + '\n', { mode: 0o600 })
  writeFileSync(knownHosts, process.env.UPDATES_SSH_KNOWN_HOSTS + '\n', { mode: 0o600 })
  const common = ['-i', identity, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'ConnectTimeout=20']
  const target = `${process.env.UPDATES_SSH_USER}@${process.env.UPDATES_SSH_HOST}`
  const ssh = ['-p', process.env.UPDATES_SSH_PORT, ...common, target]
  const run = (command, args, options = {}) => execFileSync(command, args, { stdio: ['pipe', 'inherit', 'inherit'], ...options })
  const bundle = join(temporary, 'release.tar.gz')
  run('tar', ['-czf', bundle, '-C', stage, '.'])
  // Remote shell text contains only fixed paths and a generated hexadecimal token.
  run('ssh', [...ssh, `test -d ${root} && test ! -L ${root} && mkdir -p ${root}/.incoming && test ! -L ${root}/.incoming`])
  run('scp', ['-P', process.env.UPDATES_SSH_PORT, ...common, bundle, `${target}:${root}/.incoming/${token}.tar.gz`])
  const remote = readFileSync(new URL('./publish-desktop-release.py', import.meta.url))
  run('ssh', [...ssh, `python3 - ${token} ${result.version} ${result.mode}`], { input: remote })
  console.log(`Published ${result.version} (${result.mode}); verified feeds and version.json switched together.`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
