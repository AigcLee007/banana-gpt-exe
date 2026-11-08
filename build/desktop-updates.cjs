const { build } = require('../package.json')

// Empty GitHub secrets are exported as empty strings; electron-builder treats
// CSC_LINK="" as a certificate path and resolves it to the project directory.
for (const name of [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_INSTALLER_LINK',
  'CSC_INSTALLER_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
]) {
  if (process.env[name]?.trim() === '') delete process.env[name]
}

module.exports = {
  ...build,
  ...(process.env.RELEASE_NOTES ? { releaseInfo: { releaseNotes: process.env.RELEASE_NOTES } } : {}),
  // Public versions use -banana.N; serve them on the fixed production channel.
  detectUpdateChannel: false,
  artifactName: 'aittco-${version}-${os}-${arch}.${ext}',
  win: {
    ...build.win,
    forceCodeSigning: Boolean(process.env.WIN_CSC_LINK),
    publish: { provider: 'generic', url: 'https://m.aittco.com/downloads/updates/win-${arch}/', channel: 'latest' },
  },
  mac: {
    ...build.mac,
    target: ['dmg'],
  },
}
