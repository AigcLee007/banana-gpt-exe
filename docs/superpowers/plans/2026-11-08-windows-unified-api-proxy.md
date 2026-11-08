# Windows Client Unified API Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all model API traffic from the packaged Windows client through Electron's main process to avoid renderer CORS failures while preserving web behavior and per-profile API configuration.

**Architecture:** Add a shared renderer transport which rewrites API fetches to the app-local protocol only in packaged Electron. Extend the main-process proxy to validate and forward model endpoints under each configured HTTPS API base path with `net.fetch`, keeping the existing Midjourney and image-download routes intact. Migrate all model adapters to the shared fetch transport; web builds continue to call their existing URLs.

**Tech Stack:** TypeScript, Electron custom protocol, Node CommonJS, Vitest, Vite.

---

## File Map

- Modify `electron/midjourney-proxy.cjs`: add general model API route validation bound to a configured HTTPS API base URL without weakening the image-download host restriction.
- Modify `electron/main.cjs`: dispatch the new app-local API route through the general proxy.
- Create `src/lib/desktopApiFetch.ts`: route API fetches through Electron only when `window.location.protocol === 'app:'`.
- Modify `src/lib/openaiCompatibleImageApi.ts`, `src/lib/midjourneyImageApi.ts`, `src/lib/falAiImageApi.ts`, `src/lib/agentApi.ts`, `src/lib/upscaleApi.ts`, and `src/lib/videoApi.ts`: replace model API `fetch` calls with the shared transport.
- Modify `src/lib/videoTransport.ts`: preserve each profile's base URL and existing web proxy decisions when building URLs.
- Modify `src/lib/midjourneyProxy.test.ts` and create `src/lib/desktopApiFetch.test.ts`: verify proxy validation, forwarding, desktop routing, and web behavior.

### Task 1: Add and test the main-process model API proxy

**Files:**
- Modify: `src/lib/midjourneyProxy.test.ts`
- Modify: `electron/midjourney-proxy.cjs`

- [ ] **Step 1: Add failing tests for accepted model endpoint families**

Add tests calling the exported proxy handler with an injected fetch function. Cover `POST /v1/images/generations`, `POST /v1/images/edits`, `POST /v1/responses`, `POST /v1/videos`, `GET /v1/videos/{id}`, `GET /v1/tasks/{id}/artifacts/{name}/content`, `POST /v1beta/models/{model}:generateContent`, an arbitrary custom-provider route under its configured base path, and root-scoped Midjourney submit/poll paths. Assert same-origin/base-path validation, method, body, authorization, content type, status, and response bytes are preserved.

- [ ] **Step 2: Verify the new proxy tests fail before implementation**

Run `npm test -- src/lib/midjourneyProxy.test.ts`. Expected: the new handler export or model routes are missing and the new cases fail.

- [ ] **Step 3: Implement the validated forwarder**

In `electron/midjourney-proxy.cjs`, add a model API handler which accepts an absolute HTTPS target and configured API base from dedicated request headers. Require matching origins and a target pathname under the configured base pathname; allow `GET`, `HEAD`, `POST`, and `PUT`; separately allow the documented root-scoped Midjourney routes. Reject URL credentials, private/loopback/link-local destinations, and query control characters, then call the injected fetch implementation with `redirect: 'error'`. Forward only `Authorization`, `Content-Type`, `Accept`, `Range`, and the FAL relay routing header. Return the upstream body as a stream with status and only safe response headers. Keep the current Midjourney handler as a compatibility path and keep `handleImageDownload` unchanged.

- [ ] **Step 4: Verify all proxy tests pass**

Run `npm test -- src/lib/midjourneyProxy.test.ts`. Expected: accepted routes forward once and invalid targets, methods, paths, and missing credentials receive 4xx responses without calling upstream.

### Task 2: Add a shared renderer transport and migrate model APIs

**Files:**
- Create: `src/lib/desktopApiFetch.ts`
- Create: `src/lib/desktopApiFetch.test.ts`
- Modify: `electron/main.cjs`
- Modify: `src/lib/openaiCompatibleImageApi.ts`
- Modify: `src/lib/midjourneyImageApi.ts`
- Modify: `src/lib/agentApi.ts`
- Modify: `src/lib/upscaleApi.ts`
- Modify: `src/lib/videoApi.ts`
- Modify: `src/lib/videoTransport.ts`
- Modify: `src/lib/falAiImageApi.ts`
- Modify: `src/lib/falAiImageApi.test.ts`

- [ ] **Step 1: Add failing transport tests**

Test that `desktopApiFetch(url, init, baseUrl)` rewrites an absolute HTTPS API URL to `/desktop-api-proxy` and supplies the original URL and configured base URL in headers when the location protocol is `app:`. Test that it leaves the URL and options untouched for `https:` web builds, data URLs, and download-proxy calls. Assert the API key remains only in the forwarded request headers and is never appended to the app-local URL.

- [ ] **Step 2: Verify transport tests fail before implementation**

Run `npm test -- src/lib/desktopApiFetch.test.ts`. Expected: the helper is not present and the desktop-routing tests fail.

- [ ] **Step 3: Implement the shared transport and Electron route**

Implement `desktopApiFetch` as a thin wrapper around `fetch`. On packaged Electron only, set `X-Desktop-Api-Target` and `X-Desktop-Api-Base` to the absolute request and configured base URLs and fetch `/desktop-api-proxy` with the original `RequestInit`; on web, call `fetch(url, init)` unchanged. In `electron/main.cjs`, dispatch `/desktop-api-proxy` to the validated handler from Task 1, passing `net.fetch` and the incoming target/base headers. Do not route image download, upload, update, or same-origin web proxy URLs through this handler.

- [ ] **Step 4: Migrate every model API fetch call**

Replace direct model-request `fetch` calls in `openaiCompatibleImageApi.ts`, `midjourneyImageApi.ts`, `agentApi.ts`, `upscaleApi.ts`, and `videoApi.ts` with `desktopApiFetch`. Configure the FAL SDK with a desktop-aware fetch callback that routes its `fal.run`, queue, REST API, and configured FAL relay calls through the same helper, preserving `X-Fal-Target-Url`; leave presigned storage uploads and generated media downloads direct. Keep local data URL reads, other generated-image downloads, uploader requests, and the account billing API outside this migration. Ensure video content requests authenticated against a configured API profile use the same helper.

- [ ] **Step 5: Verify transport and adapter tests**

Run `npm test -- src/lib/desktopApiFetch.test.ts src/lib/midjourneyImageApi.test.ts src/lib/videoAdapters`. Expected: all new transport cases and existing model adapter regressions pass.

### Task 3: Verify coverage and build compatibility

**Files:**
- Review: `src/lib/openaiCompatibleImageApi.ts`
- Review: `src/lib/midjourneyImageApi.ts`
- Review: `src/lib/agentApi.ts`
- Review: `src/lib/upscaleApi.ts`
- Review: `src/lib/videoApi.ts`
- Review: `electron/main.cjs`

- [ ] **Step 1: Check every model API call site**

Run `rg -n "fetch\(" src/lib/openaiCompatibleImageApi.ts src/lib/midjourneyImageApi.ts src/lib/falAiImageApi.ts src/lib/agentApi.ts src/lib/upscaleApi.ts src/lib/videoApi.ts`. Confirm every upstream model API request uses `desktopApiFetch` or the FAL desktop-aware fetch callback, and remaining native `fetch` calls are limited to local data, temporary object storage, images, upload, or non-model URLs.

- [ ] **Step 2: Run the full test suite**

Run `npm test`. Expected: Vitest completes with exit code 0 and no failed tests.

- [ ] **Step 3: Run the production build**

Run `npm run build`. Expected: TypeScript project build and Vite production build complete successfully.

- [ ] **Step 4: Review the final change set**

Run `git diff --check` and `git status --short`. Confirm no credentials, unrelated changes, or generated installers are included.
