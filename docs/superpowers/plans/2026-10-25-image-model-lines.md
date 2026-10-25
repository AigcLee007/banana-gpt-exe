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

Initial implementation was verified in the existing feature checkout. The user subsequently requested a GitHub push and server update commands. The release is isolated from origin/main in the managed codex/image-model-lines worktree; only selector-related changes and the 0.4.6-banana.12 version bump are included. The original uncommitted features remain untouched.

## Verification results — 2026-10-25

- Full Vitest suite: 118 files, 2047 tests passed.
- Production build: TypeScript and Vite completed successfully. Existing Browserslist and bundle-size warnings remain.
- Browser checked Gallery and Agent selection, independent route memories, persistence after reload, active/remembered backup visibility, T3 4K price update, configured Max tag, outside dismissal, Escape focus restoration and keyboard column navigation.
- Verified viewport bounds at 1280×800, 375×812, 320×568 and 900×300. Visually reviewed light and dark desktop screenshots and the mobile screenshot.
- Preview artifacts: output/playwright/image-model-lines-desktop.png, image-model-lines-dark.png and image-model-lines-mobile.png.
- Initial verification occurred before the GitHub release request. Server deployment is performed separately using the supplied update commands.
## Isolated release verification — 2026-10-25

- Base: origin/main at 59f694fb77b24c85b706af80918cc4dab6432e49.
- Release version: 0.4.6-banana.12 in package.json and package-lock.json.
- Only the image model picker, registry metadata, model-selection helpers/tests and design/plan documents are included. InputBar contains only the selector integration; unrelated local UI changes are excluded.
- Fresh npm ci completed successfully. The isolated release suite passed: 49 files, 939 tests, zero failures. The lower count compared with the original working directory excludes unrelated uncommitted feature tests.
- Fresh npm run build passed. Existing Browserslist-age and bundle-size warnings remain.
- Original working directory and its unrelated changes are preserved at D:/gpt-iamge-2.
- GitHub push is authorized by the user; server deployment commands are handed off separately. Desktop packages and download-site version.json require the separate release procedure.

## Always-visible backup routes revision — 2026-10-25

- User requested that backup routes stay visible. Removed route filtering, expansion state and the More lines / Collapse backup lines control from the shared Gallery and Agent picker.
- Preserved route IDs, prices, last-used badges, selection and keyboard navigation. Added rendering regressions for the Nano Banana Pro and GPT-Image-2 backups.
- Confirmed the updated rendering tests failed before the implementation change, then passed after it. Targeted tests: 2 files, 17 tests passed. Full suite: 49 files, 940 tests passed.
- Production build passed again with version 0.4.6-banana.13; existing Browserslist-age and bundle-size warnings remain.
- Browser verified both model families show three routes without disclosure controls. Selected the GPT-Image-2 backup and reopened it at 375×812. Screenshot: output/playwright/backup-lines-visible.png.
- GitHub delivery and server deployment remain separate. Server activation requires pulling the revision and rebuilding the Docker container using the existing deployment instructions.

## Simplified non-Nano controls revision — 2026-10-25

- [x] Add regression coverage for all seven non-Nano routes in Gallery and Agent, hidden-setting normalization, Nano Banana compatibility and desktop column counts. Confirm the requested behavior fails before implementation.
- [x] Remove format, compression and moderation controls and their unused state and hints from InputBar. Normalize non-Nano parameters to output_format=png, output_compression=null and moderation=auto in the shared normalization used by the composer, submission, retry and task reuse.
- [x] Preserve Nano Banana parameters, size, quality, count and Gallery transparent-background controls. Use five desktop columns for non-Nano Gallery and four for Agent.
- [x] Verify targeted tests (136 passed), full suite (50 files, 972 tests passed), TypeScript and production build. Version: 0.4.6-banana.14. Existing Browserslist-age and bundle-size warnings remain.
- [x] Browser-check Gallery at desktop and 375×812, restore deliberately stale WebP/compression/low values on reload, select Agent GPT-Image-2 backup and Nano Banana Pro T3. Capture and inspect desktop/mobile screenshots in output/playwright/simplified-params-*.png. External fonts were blocked in the verification browser after a screenshot font-load timeout; the only console errors are those blocked font stylesheets.
- GitHub delivery follows the user's existing push instruction. Server deployment, desktop packages and download-site version.json remain separate release steps.

## Compact parameter widths revision — 2026-10-26

- [x] Replace equal desktop grid columns with compact parameter tracks and a flexible model track. Set pixel size and ratio to 104px, quality to 88px, transparent background to 76px, count to 64px and Nano Banana image size to 160px. Keep all existing parameter values and behavior.
- [x] Give the model a full row on mobile and at 640–767px. Constrain label and input minimum widths so the count input cannot force overflow.
- [x] Update existing layout/rendering regressions, confirm 20 expected failures before implementation, then verify the targeted 115 tests pass. Full suite: 50 files, 972 tests passed. TypeScript and production build passed for 0.4.6-banana.15. Existing Browserslist-age and bundle-size warnings remain.
- [x] Browser-check Nano Banana Pro T3 and Sunburst official routes in Gallery and Agent at 1100, 980, 768, 767, 640, 375 and 320px where applicable. No parameter overflow; model names fit at 980px and above. Gallery model width is approximately 368–378px in the standard desktop composer.
- [x] Inspect screenshots at output/playwright/compact-controls-desktop.png, compact-controls-mobile.png and compact-controls-nano.png. Increase the initial ratio width after visual review to keep its icon and text visible.
- GitHub delivery follows the existing authorization. Server deployment and desktop releases remain separate.
