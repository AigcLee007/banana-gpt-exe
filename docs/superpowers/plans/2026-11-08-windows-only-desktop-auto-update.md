# Windows-only Desktop Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Windows x64 NSIS desktop updates without Apple credentials while Mac clients continue to use the website's manual download flow.

**Architecture:** Restrict native updater activation to packaged Windows x64, and let Mac clients fall back to the existing `version.json` manual-update path. Add a Windows-only artifact staging and remote publication mode that atomically switches the Windows feed and active version manifest while retaining the previous Mac download URLs and leaving Mac feed directories unchanged.

**Tech Stack:** Electron, electron-updater, Node.js ESM, GitHub Actions, Python 3 standard library, Vitest.

---

## Files and Responsibilities

- Modify `electron/main.cjs` and `electron/desktop-updater.cjs` to enable native updates only for packaged Windows x64 and to keep Mac updater calls disabled.
- Modify `src/lib/desktopUpdater.ts`, `src/hooks/useDesktopUpdater.ts`, `src/App.tsx`, and their tests so an unsupported native bridge falls back to the existing manual download check.
- Modify `scripts/desktop-release-preflight.mjs` and `src/lib/desktopRelease.test.js` to validate Windows-only publication prerequisites without Apple credentials.
- Modify `scripts/desktop-release.mjs` and `src/lib/desktopRelease.test.js` to validate and stage Windows-only artifacts.
- Modify `scripts/publish-desktop-release.py` and `scripts/test-desktop-publication.py` to validate and atomically install Windows-only releases while retaining the current Mac download URLs and Mac feeds.
- Modify `.github/workflows/desktop-build.yml` to skip Mac builds for Windows publication and pass a Windows-only publication mode to staging and publishing.
- Modify `docs/desktop-auto-update.md` to document the Windows-only release path and required owner/server setup.

## Task 1: Limit Native Updates to Windows and Preserve Mac Manual Updates

**Files:**
- Modify: `src/lib/desktopUpdateController.test.ts`
- Modify: `src/lib/desktopUpdater.test.ts`
- Modify: `src/hooks/useDesktopUpdater.test.tsx`
- Modify: `electron/desktop-updater.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/lib/desktopUpdater.ts`
- Modify: `src/hooks/useDesktopUpdater.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add failing platform and renderer fallback tests.**

In `src/lib/desktopUpdateController.test.ts`, change the feed table to keep only `['win32', 'x64', 'win-x64']`; assert `getUpdateFeed('darwin', 'arm64')` and `getUpdateFeed('darwin', 'x64')` are `null`. In `src/hooks/useDesktopUpdater.test.tsx`, return `{ status: 'unsupported', currentVersion: '1.0.0' }` from the mock bridge and assert the hook reports native auto-update as inactive. Keep `App.tsx`'s existing legacy-check and download-page behavior gated by that `native` value.

Run: `npx vitest run src/lib/desktopUpdateController.test.ts src/hooks/useDesktopUpdater.test.tsx`

Expected: FAIL because Mac feeds are currently returned and bridge presence currently suppresses legacy update checks.

- [ ] **Step 2: Implement Windows-only updater activation and fallback.**

Return a feed only for `win32` plus `x64`; in `electron/main.cjs`, instantiate the updater only when the app is packaged, not in development, and the platform is Windows x64. Keep the preload API stable. In the renderer, derive native updater support from the received state (`status !== 'unsupported'`) instead of bridge presence, allowing the existing legacy check to resume on Mac.

- [ ] **Step 3: Run focused tests and commit.**

Run: `npx vitest run src/lib/desktopUpdateController.test.ts src/hooks/useDesktopUpdater.test.tsx`

Expected: PASS; the Windows updater remains native and Mac falls through to the manual download flow.

## Task 2: Add Windows-only Local Release Validation and Staging

**Files:**
- Modify: `scripts/desktop-release-preflight.mjs`
- Modify: `scripts/desktop-release.mjs`
- Modify: `src/lib/desktopRelease.test.js`

- [ ] **Step 1: Add failing Windows-only preflight tests.**

Test that `releasePreflight` accepts a Windows-only publication with valid `UPDATES_SSH_*` secrets and no `MAC_CSC_LINK`, Apple ID, app-specific password, or Team ID. Keep Windows signing credentials optional but require both `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` when either is provided. Keep the existing complete-release validation contract available for compatibility.

Run: `npx vitest run src/lib/desktopRelease.test.js -t "Windows-only preflight"`

Expected: FAIL because publication currently requires Apple credentials unconditionally.

- [ ] **Step 2: Add failing artifact staging tests.**

Build a fixture with only `win-x64/latest.yml`, a versioned `.exe`, and its `.blockmap`. Assert Windows-only staging includes validated version, SHA512, size, Windows installer URL, and no Mac feed artifacts; assert the staged manifest carries forward supplied `macosArm64Url` and `macosX64Url` values. Assert missing or tampered Windows files fail before output is created.

Run: `npx vitest run src/lib/desktopRelease.test.js -t "Windows-only release"`

Expected: FAIL because current validation requires three platform directories and staging generates fresh Mac download URLs.

- [ ] **Step 3: Implement Windows-only preflight and staging.**

Add an explicit release mode to preflight and `prepareRelease`. In Windows-only mode, require SSH secrets and a valid package/tag version, validate only `win-x64`, and stage only its installer, blockmap, and `latest.yml`. The staged `version.json` contains the new Windows URL and version; leave Mac URL fields absent so the remote publisher can copy them from the active manifest without inventing values.

- [ ] **Step 4: Run release tests and commit.**

Run: `npx vitest run src/lib/desktopRelease.test.js`

Expected: PASS for both legacy complete-release fixtures and new Windows-only fixtures.

## Task 3: Make the Remote Publisher Preserve Mac URLs and Feeds

**Files:**
- Modify: `scripts/publish-desktop-release.py`
- Modify: `scripts/test-desktop-publication.py`

- [ ] **Step 1: Add failing Windows-only publication tests.**

Create a remote fixture whose active `version.json` has stable Mac URLs and whose Mac feed files contain recognizable prior contents. Publish a Windows-only archive and assert `current` switches to the new release, Windows feed and `windowsUrl` advance, both Mac URLs remain identical, and the Mac feed files carried into the new snapshot remain byte-for-byte unchanged. Add missing payload and hash-mismatch cases asserting the old `current` target remains active.

Run on Linux: `python3 -B scripts/test-desktop-publication.py`

Expected: FAIL because the publisher currently requires all three platforms and all three native feed manifests.

- [ ] **Step 2: Implement atomic Windows-only remote installation.**

Make the staged index declare the publication mode. For Windows-only mode, validate only the Windows installer, `latest.yml`, required blockmap, sizes, and SHA512. Under the existing publication lock, read the active legacy `version.json` (or the existing site manifest on the first native publication), retain any Mac URL fields, and merge them with the new Windows URL/version/notes. Copy available active Mac feed manifests byte-for-byte into the new snapshot; allow them to be absent for the first Windows-only native release. Rewrite the staged `version.json` and its SHA512/size entry in `release-index.json`, then install release metadata before switching `current`. Preserve current all-platform validation for the existing release mode.

- [ ] **Step 3: Run remote publication tests and commit.**

Run on Linux: `python3 -B scripts/test-desktop-publication.py`

Expected: PASS for complete releases, Windows-only releases, and failure cases that preserve the prior active pointer and Mac feeds.

## Task 4: Route GitHub Releases Through the Windows-only Path

**Files:**
- Modify: `.github/workflows/desktop-build.yml`
- Modify: `scripts/desktop-release-preflight.mjs`
- Modify: `scripts/desktop-release.mjs`
- Modify: `scripts/publish-desktop-release.mjs`
- Modify: `src/lib/desktopRelease.test.js`

- [ ] **Step 1: Add failing workflow contract tests.**

Assert the publish job depends on the Windows build only for the Windows-only release mode, downloads only the `desktop-windows` artifact, passes the mode to staging/publishing, and does not pass Apple secrets to that path. Assert ordinary pushes still do not publish.

Run: `npx vitest run src/lib/desktopRelease.test.js -t "workflow"`

Expected: FAIL because the current job requires and downloads both Mac artifacts.

- [ ] **Step 2: Implement Windows-only GitHub Actions flow.**

Retain verification/build behavior for ordinary pushes. For explicit publish dispatch or a version tag, build the Windows NSIS artifact, then invoke Windows-only validation, staging, and secure remote publication. Keep `WIN_CSC_LINK` and its password optional as a pair; do not expose Apple signing values to the Windows-only publication process.

- [ ] **Step 3: Run workflow and release tests and commit.**

Run: `npx vitest run src/lib/desktopRelease.test.js`

Expected: PASS with the Windows-only release job contract and existing artifact validation covered.

## Task 5: Document Setup and Run Full Verification

**Files:**
- Modify: `docs/desktop-auto-update.md`
- Review: `docs/superpowers/specs/2026-11-08-windows-only-desktop-auto-update-design.md`

- [ ] **Step 1: Update the operator guide.**

Document that the Windows-only path needs restricted SSH upload secrets and server/Nginx setup, does not need Apple Developer credentials, and still benefits from optional Windows signing. Explain the publish checkbox/tag procedure, version increment requirement, Windows feed validation, Mac manual-download behavior, and that Mac download links and feed contents carry forward unchanged.

- [ ] **Step 2: Run focused desktop tests.**

Run: `npx vitest run src/lib/desktopUpdateController.test.ts src/hooks/useDesktopUpdater.test.tsx src/components/DesktopUpdateDialog.test.tsx src/lib/desktopRelease.test.js src/lib/desktopUpdatePackaging.test.ts`

Expected: PASS.

- [ ] **Step 3: Run remote publication tests on Linux.**

Run: `python3 -B scripts/test-desktop-publication.py`

Expected: all publication tests pass, including preservation of existing Mac links and feed files.

- [ ] **Step 4: Run the full test suite and production build.**

Run: `npm test`

Expected: all tests pass; platform-specific Linux publisher tests may be skipped on Windows and must pass in the Ubuntu GitHub preflight job.

Run: `npm run build`

Expected: TypeScript and Vite production build complete successfully.

- [ ] **Step 5: Review the final changes.**

Run: `git diff --check`

Expected: no whitespace errors. Inspect the Windows/Mac update UI paths and confirm no production publish or desktop package release occurred.
