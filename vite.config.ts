import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { execSync } from 'node:child_process'
import { request } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

const DOWNLOAD_PROXY_ALLOWED_HOSTS = new Set([
  'file1.aitohumanize.com',
  'file2.aitohumanize.com',
  'file4.aitohumanize.com',
  'file5.aitohumanize.com',
  'visionary.beer',
])

function isAllowedDownloadProxyUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    if (!DOWNLOAD_PROXY_ALLOWED_HOSTS.has(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

function proxyDownloadUrl(targetUrl: URL, req: IncomingMessage, res: ServerResponse, redirectCount = 0) {
  if (redirectCount > 5) {
    res.statusCode = 508
    res.end('Download proxy redirect loop')
    return
  }

  const authorization = targetUrl.hostname === 'visionary.beer' && typeof req.headers.authorization === 'string'
    ? req.headers.authorization
    : undefined
  const upstream = request(targetUrl, {
    method: 'GET',
    headers: authorization ? { Authorization: authorization } : undefined,
  }, (upstreamRes) => {
    const statusCode = upstreamRes.statusCode ?? 502
    const location = upstreamRes.headers.location
    if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
      upstreamRes.resume()
      const redirectedUrl = isAllowedDownloadProxyUrl(new URL(location, targetUrl).toString())
      if (!redirectedUrl) {
        res.statusCode = 403
        res.end('Forbidden redirect')
        return
      }
      proxyDownloadUrl(redirectedUrl, req, res, redirectCount + 1)
      return
    }

    if (statusCode >= 400) {
      upstreamRes.resume()
      res.statusCode = statusCode
      res.end('Download proxy upstream error')
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', upstreamRes.headers['content-type'] ?? 'application/octet-stream')
    res.setHeader('Content-Disposition', 'attachment')
    upstreamRes.pipe(res)
  })
  upstream.on('error', () => {
    res.statusCode = 502
    res.end('Download proxy failed')
  })
  upstream.end()
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
          server.middlewares.use('/download-proxy', (req, res) => {
            const requestUrl = new URL(req.url ?? '', 'http://localhost')
            const targetUrl = isAllowedDownloadProxyUrl(requestUrl.searchParams.get('url') ?? '')
            if (!targetUrl) {
              res.statusCode = 403
              res.end('Forbidden')
              return
            }

            proxyDownloadUrl(targetUrl, req, res)
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
