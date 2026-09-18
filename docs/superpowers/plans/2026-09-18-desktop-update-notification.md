# Desktop Update Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make desktop Windows and macOS clients check the self-hosted update manifest and open the Aittco download page when a newer version is available.

**Architecture:** Keep the existing shared version comparison and prompt in `App.tsx`. Parameterize manifest fetching so web builds use their local `/version.json`, while Electron builds use `https://m.aittco.com/downloads/version.json`. Add a validated download-page URL with a fixed HTTPS fallback; desktop updates remain manual browser downloads.

**Tech Stack:** React, TypeScript, Vite, Electron, Vitest.

---

### Task 1: Lock manifest routing and download-page behavior with tests

**Files:**
- Modify: `src/lib/versionCheck.test.ts`
- Modify: `src/lib/versionCheck.ts`

- [ ] Add tests for the self-hosted desktop manifest URL, an absolute cache-busted URL, and the HTTPS download-page fallback/validation.
- [ ] Run the focused test and confirm it fails because the new exports do not exist.
- [ ] Implement the smallest helpers and manifest type changes needed for the tests.
- [ ] Run the focused test and confirm it passes.

### Task 2: Route Electron checks to the self-hosted manifest and show its notes

**Files:**
- Modify: `src/App.tsx`

- [ ] Pass the desktop manifest URL to `fetchVersionManifest` only for Electron runtime; keep web checks on `/version.json`.
- [ ] Open the validated `desktop.downloadPage` or fixed Aittco download center when the user clicks the desktop update button.
- [ ] Render remote update notes in the existing update prompt when supplied.
- [ ] Preserve the existing throttling, manual check feedback, and web refresh behavior.

### Task 3: Document the website manifest contract

**Files:**
- Create: `docs/download-pages/version.json.example`
- Modify: `README.md`

- [ ] Add a copyable JSON example for the website and explain the required HTTPS/CORS response and version update process.
- [ ] State that desktop users are sent to the download page for manual installation and no automatic installer download occurs.

### Task 4: Verify and commit

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Review the diff for unintended files and commit the implementation.
