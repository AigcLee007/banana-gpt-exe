# Native desktop auto-update implementation plan

**Goal:** Installed Windows NSIS and signed macOS apps detect releases, download in the background, show progress, and install only after explicit confirmation with no active work.

**Architecture:** A testable Electron main-process controller uses electron-updater with a fixed HTTPS generic feed per OS/architecture. A context-isolated preload exposes only bounded update operations and state subscription. A React dialog replaces legacy desktop download-page prompts when the native bridge is present; Web and older-client fallback stay available. Release automation validates complete platform artifacts, uploads immutable version directories, and publishes feed metadata only after all files are present.

**External prerequisites:** Apple Developer certificate/notarization credentials, optional Windows signing certificate, and restricted SSH deployment credentials are configured in GitHub Secrets by the owner. Do not invent or embed credentials, deploy incomplete unsigned Mac feeds, or change live download manifests during implementation.

- [x] Main process: tests first for check/download/error/retry, deduplication, install guards and per-platform feeds; implement updater controller, trusted IPC and preload.
- [x] Renderer: add typed bridge and update dialog, manual checks and busy tracking across image, Agent and video work; keep Web behavior; test states and install blocking.
- [x] Packaging: add electron-updater dependency and architecture-aware generic publish config, keep NSIS-only Windows and dmg+zip Mac; configure latest channel for banana prerelease versions.
- [x] Release: tests for artifact validation and SHA512; add gated signed builds and secure SSH publishing, server feed config and operator setup instructions.
- [x] Integration: run relevant tests, npm test, npm run build, package Windows where possible, inspect updater UI with a simulated bridge, review diff.
- [x] Report evidence and prerequisites still preventing real signing, uploading or installed-to-installed live update validation.

## Verification evidence

- npm test: 99 files passed; 1518 tests passed, 3 Linux-only tests skipped on Windows.
- WSL Ubuntu: Python atomic publication integration tests, 3 passed.
- npm run build passed; Windows NSIS installer and blockmap generated for 0.4.6-banana.20.
- Packaged Windows startup verified context-isolated preload, trusted IPC and premature-install blocking; installer SHA512 and fixed update feed verified.
- Download progress, background download and install notification checked in browser with a simulated native bridge; desktop and narrow layouts inspected.
- Actual online installed-to-installed update, signed Windows distribution and macOS signing/notarization remain untested until owner-provided credentials and server configuration are ready. No production publication performed.
