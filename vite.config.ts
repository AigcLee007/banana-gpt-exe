import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { execSync } from 'node:child_process'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const buildTime = new Date().toISOString()
const buildId = buildTime
const gitCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
})()
const versionManifest = {
  version: pkg.version,
  buildId,
  commit: gitCommit,
  force: true,
  desktop: {
    windowsUrl: '',
    macosUrl: '',
    notes: '',
  },
}

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [
      react(),
      {
        name: 'app-version-manifest',
        configureServer(server) {
          server.middlewares.use('/version.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify(versionManifest, null, 2))
          })
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify(versionManifest, null, 2),
          })
        },
      },
    ],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __BUILD_ID__: JSON.stringify(buildId),
      __GIT_COMMIT__: JSON.stringify(gitCommit),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
      __UPSTREAM_URL__: JSON.stringify(process.env.UPSTREAM_URL || ''),
      __AITTCO_UPSTREAM_URL__: JSON.stringify(process.env.AITTCO_UPSTREAM_URL || ''),
    },
    server: {
      host: true,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
  }
})
