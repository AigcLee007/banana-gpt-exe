/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
declare const __BUILD_ID__: string
declare const __GIT_COMMIT__: string
declare const __DEV_PROXY_CONFIG__: unknown
declare const __UPSTREAM_URL__: string | undefined
declare const __AITTCO_UPSTREAM_URL__: string | undefined

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_UPSTREAM_URL?: string
  readonly VITE_AITTCO_UPSTREAM_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
