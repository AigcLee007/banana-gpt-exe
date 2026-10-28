# Image Model and Line Selector Implementation Plan

**Goal:** Replace duplicated image-model dropdown entries with a single family-and-line picker.

**Architecture:** Add UI metadata to the existing registry, pure grouping/memory/positioning helpers, and one shared React picker for Gallery and Agent. Preserve each stored model ID and the existing request and pricing helpers.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest, Vite.

## Tasks

- [x] Add failing tests in `src/lib/imageModelSelection.test.ts` for exact registry coverage, distinct model families, dynamic T3 prices, line-memory validation, backup visibility and viewport positioning. Run `npm test -- src/lib/imageModelSelection.test.ts` and confirm missing helper failures.
- [x] Extend `src/lib/bananaModels.ts` with explicit family, line and capability metadata; implement pure helpers in `src/lib/imageModelSelection.ts` and rerun the tests.
- [x] Add failing rendering tests in `src/components/ImageModelPicker.test.tsx` for the compact trigger, family list, per-family routes, prices, capabilities, backup disclosure and accessibility. Run the new test file before adding the component.
- [x] Implement `src/components/ImageModelPicker.tsx` with separate model and line columns, a viewport-positioned portal, remembered routes, keyboard and pointer interaction, and themed responsive styles. Replace only the two image selectors in `src/components/InputBar.tsx`, retaining their existing callbacks.
- [x] Run the targeted tests, full suite and `npm run build`. Verify the live UI at desktop and mobile widths, including current backup selection, T3 price changes, memory restoration, keyboard dismissal and selection in Gallery and Agent. Record observed results.

The user's request authorizes implementation in this session. Work in the existing feature checkout because the active UI includes uncommitted work; avoid overwriting unrelated changes. Do not commit or publish as part of this change.

## Verification results — 2026-10-25

- Full Vitest suite: 118 files, 2047 tests passed.
- Production build: TypeScript and Vite completed successfully. Existing Browserslist and bundle-size warnings remain.
- Browser checked Gallery and Agent selection, independent route memories, persistence after reload, active/remembered backup visibility, T3 4K price update, configured Max tag, outside dismissal, Escape focus restoration and keyboard column navigation.
- Verified viewport bounds at 1280×800, 375×812, 320×568 and 900×300. Visually reviewed light and dark desktop screenshots and the mobile screenshot.
- Preview artifacts: output/playwright/image-model-lines-desktop.png, image-model-lines-dark.png and image-model-lines-mobile.png.
- Changes remain in the existing local feature checkout; no commit or deployment performed.