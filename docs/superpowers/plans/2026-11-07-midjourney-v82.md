# Midjourney v8.2 Implementation Plan

**Goal:** Integrate Low and High in gallery and Agent, with JSON references, quality/HD, durable asynchronous tasks and all result images. Local integration only.

**Architecture:** Register a dedicated `midjourney` route and implement `midjourneyImageApi.ts`. Keep GPT parameters separate. Persist the public task ID before polling; resume the same task after interruption. Use the configured proxy for root endpoints and authenticated first-party artifacts; never send the key to result image hosts. Existing generic upscale remains a separate service.

**Tech Stack:** TypeScript, React, Zustand, IndexedDB, Vitest, Vite, Nginx, Electron.

- [x] Add failing tests for registry/line memory, root URLs, request validation and async multi-image success/failure/retry/resume.
- [x] Implement model metadata and dedicated parameter normalization and API adapter.
- [x] Add narrowly scoped root endpoint / artifact routes to development, Nginx and Electron proxies; test method/path restrictions.
- [x] Persist task metadata in gallery and Agent before polling; resume without POST; retain all Agent images; test interruption, retries and regeneration.
- [x] Add ratio, quality, HD, reference limits and generation-group labels following existing UI. Clear incompatible parameters on model changes.
- [x] Run focused tests, npm test, npm run build and inspect browser UI. The isolated browser and environment have no configured user API key, so live generation remains untested.
- [x] Review diff and report exact verified capabilities and untested limits. No deployment or installer publishing.
