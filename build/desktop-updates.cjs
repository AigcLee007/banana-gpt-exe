const { build } = require('../package.json')

const release = process.env.DESKTOP_RELEASE === 'true'
const appleCredentials = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

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
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    forceCodeSigning: release,
    notarize: release || appleCredentials,
    publish: { provider: 'generic', url: 'https://m.aittco.com/downloads/updates/mac-${arch}/', channel: 'latest' },
  },
}
