# Wan Video + Uguu Implementation Plan

> For agentic workers: use subagent-driven-development for the isolated adapter implementation and review. Execute integration in this session without further approval gates; the user approved the design.

**Goal:** Add Wan 720P with local references automatically uploaded to Uguu before video submission.

**Architecture:** Keep media local and validate the complete request before uploads. A dedicated Wan adapter calls an isolated Uguu multipart uploader; fixed-target web and Electron transports return upload JSON. Existing video lifecycle saves authenticated output locally.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Vite Connect middleware, Nginx, Electron.

## Task 1: Adapter and local references

- [x] Create `src/lib/videoAdapters/wan.test.ts`, `src/lib/uguuUpload.test.ts`, `src/lib/videoFrameRate.test.ts`; assert JSON whitelist, ordered mentions, no paid POST after invalid media/upload failures, authenticated query/download, unknown retry, signed URL parsing, FPS bounds.
- [x] Run `npm test -- src/lib/videoAdapters/wan.test.ts src/lib/uguuUpload.test.ts src/lib/videoFrameRate.test.ts` and verify expected missing functionality.
- [x] Implement `wan.ts`, `uguuUpload.ts`, `videoFrameRate.ts`. Uploader uses `/media-upload/uguu` (web) or `app://local/media-upload/uguu` (desktop), `FormData.append('files[]', blob, filename)`, `credentials: 'omit'`, an AbortSignal timeout, and accepts `success === true` with one HTTPS Uguu file URL. Wan builds only model/prompt/aspect_ratio/resolution/seconds and reference fields, after all input validation succeeds.
- [x] Repeat focused tests until passing; review implementation against the attached API contract.

## Task 2: Upload transports

- [x] Add server proxy tests and Electron handler tests for a fixed Uguu destination, no credential forwarding, preserved multipart boundary, timeouts/errors, allowed methods and body limits.
- [x] Implement `server/uguuProxy.ts`, register `/media-upload/uguu` before generic Vite middleware, and add an equivalent fixed Nginx location. Implement `electron/uguu-upload.cjs` and route the same app URL in `electron/main.cjs`.
- [x] Run `npm test -- server/uguuProxy.test.ts server/videoProxy.test.ts`.

## Task 3: Model, UI, store

- [x] Add failing model/store/UI tests: fixed 720p and one output; defaults 8 seconds and 16:9; video references reduce max duration to 15; removing them restores max 30; model switching clears unsupported tails; media accepts and third-party notice.
- [x] Register adapter/model/logo in `videoModels.ts`, `videoApi.ts`, `VideoModelLogo.tsx`; extend capability fields for reference formats/sizes/duration bounds and temporary upload notice.
- [x] Add `getVideoDurationSpec(model, hasReferenceVideo)` and use it in UI and store normalization. Limit Wan referenced video duration at generation without uploading inactive draft references. Keep existing models unchanged.
- [x] Add readable reference limits and upload notice to `VideoInputBar.tsx`, preserve mandatory prompts and mode-specific references.
- [x] Run focused registration/store/UI tests.

## Task 4: Verification and delivery

- [x] Test a synthetic PNG against Uguu and verify direct download bytes without authentication.
- [x] Document the model and automatic uploads in README, including 3-hour expiry and new web proxy requirement.
- [x] Run `npm test`, `npm run build`, and `git diff --check`.
- [x] Request independent spec review followed by code-quality review; fix identified issues and repeat affected checks.
- [x] Deliver local changes on `codex/wan-video-uguu` and state paid generation/deployment verification limits.

## Verification results

- Final checks: 44 test files / 781 tests passed; TypeScript and Vite production build passed; tracked diff whitespace check passed.
- Browser: real synthetic-image upload through the same-origin route, mocked Wan creation JSON, and unknown polling state passed without video credentials in the upload.
- Desktop: Electron main-process net.fetch uploaded the synthetic PNG successfully. A packaged desktop build was not exercised.
- Uguu: anonymous direct download returned identical PNG bytes.
- Independent spec and quality reviews found no remaining blocking issues. The uploader survives removal of the Nginx API proxy block; direct file launches now stop before upload with an actionable message.
- Docker daemon was unavailable, so the Nginx container was not run. Paid generation, deployment, and publishing were not performed.
- Local changes are on codex/wan-video-uguu and remain uncommitted.

## Follow-up: Wan Logo, order, and confirmed price

The user requests the Wan brand Logo, second place in the model dropdown after MiniMax H3, and a confirmed price of 5 credits per second.

- [x] Bundle the official wan.video favicon in `src/assets/wan-logo.ico` and reference it from `VideoModelLogo.tsx` with the accessible label `Wan Logo`; record its source.
- [x] Move the Wan entry after MiniMax H3 in `videoModels.ts`, add `pricePerSecondCredits: { '720p': 5 }`, and update the existing price expectation and README.
- [x] Verify related tests, production build, and browser rendering of the second option, Logo, and default 8-second / 40-credit estimate.

Follow-up verification: 76 related tests passed and the production build passed. Browser inspection confirmed both Wan images loaded from the bundled local asset, Wan was the second dropdown option, and the 8-second creation label was 40.0 credits. Screenshot: output/playwright/wan-logo-price-order.png.
