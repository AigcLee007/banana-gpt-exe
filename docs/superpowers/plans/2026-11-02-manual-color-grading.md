# Manual Color Grading Implementation Plan

> **For agentic workers:** Implement this plan inline, task by task, using test-first development. Each task must preserve the explicit rule that image colors change only after a user action in the editor.

**Goal:** Add a precise, non-destructive color editor for generated and uploaded images, with full-resolution export and reusable saved versions.

**Architecture:** Put deterministic color transforms in a pure TypeScript module and run preview/export work in a Web Worker. Keep the source image immutable; save each explicit edit as a new local image plus its recipe, and include those records in local workspace backups. Open the editor only from user-triggered controls in image preview or image context menus.

**Tech Stack:** React 19, TypeScript, Canvas 2D, Web Worker, IndexedDB, Vitest.

---

### Task 1: Color adjustment model and pixel pipeline

**Files:**
- Create `src/lib/colorGrading.ts`
- Create `src/lib/colorGrading.test.ts`
- Modify `src/types.ts`

- [x] Define a serializable adjustment recipe for white balance, exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance, master/RGB levels, master/RGB point curves, eight HSL ranges, three-way color grading, channel mixer, and an optional validated 3D LUT.
- [x] Add tests first for identity output, alpha preservation, levels/gamma boundaries, curve interpolation, hue wrapping, channel isolation, LUT parsing/sampling, histogram counts, and adjustment reset.
- [x] Implement one deterministic transform pipeline with floating-point intermediates and a single final 8-bit quantization.
- [x] Run `npx vitest run src/lib/colorGrading.test.ts` after each red-green cycle.

### Task 2: Worker preview and original-resolution renderer

**Files:**
- Create `src/lib/colorGrading.worker.ts`
- Create `src/lib/colorGradingRenderer.ts`
- Create `src/lib/colorGradingRenderer.test.ts`

- [x] Define worker messages for loading a source, rendering a bounded preview, exporting at source dimensions, reporting progress, and canceling obsolete work.
- [x] Test request ordering, cancellation, dimensions, MIME selection, and failure propagation through a worker adapter.
- [x] Implement a worker-owned source bitmap and OffscreenCanvas renderer; downsample previews while keeping export at the original dimensions.
- [x] Process large exports in tiles, preserve alpha, and return a Blob without a base64 round trip.
- [x] Provide a main-thread canvas fallback when OffscreenCanvas is unavailable, with an explicit maximum pixel limit and visible error state.

### Task 3: Version persistence and local backup compatibility

**Files:**
- Modify `src/types.ts`
- Modify `src/lib/db.ts`
- Modify `src/lib/localWorkspaceData.ts`
- Create `src/lib/colorEditVersions.test.ts`
- Modify relevant local workspace data tests

- [x] Add a distinct edited-image source and optional recipe metadata that links each saved output to its source image and adjustment values.
- [x] Test that saving creates a new image ID, never overwrites the source, and reopening an edited version restores the original source and recipe.
- [x] Add database helpers for saving and resolving version lineage without changing existing image IDs or hashes.
- [x] Include edited outputs and their source references in gallery workspace archives; validate imported lineage and retain version assets during cleanup.
- [x] Verify old backups without recipe metadata continue to import unchanged.

### Task 4: Editor controls and entry points

**Files:**
- Create `src/components/ColorGradingEditor.tsx`
- Create `src/components/ColorGradingEditor.css`
- Modify `src/store.ts`
- Modify `src/App.tsx`
- Modify `src/components/Lightbox.tsx`
- Modify `src/components/ImageContextMenu.tsx`
- Create `src/components/ColorGradingEditor.test.tsx`

- [x] Add an explicit color-edit action to the large-image preview and image context menu; support stored generated images and uploaded reference images.
- [x] Build a responsive editor with a central before/after image canvas, zoom and compare controls, undo/redo, reset, export, and save-version actions.
- [x] Add grouped, collapsible controls for basic adjustments, white balance and manual neutral-point sampling, RGB histogram/levels/curves, HSL, color wheels, channel mixer, and `.cube` LUT import.
- [x] Use paired sliders and numeric inputs, per-control reset, keyboard-operable curve points, and clear busy/error/progress states.
- [x] Tests and browser checks prove the editor is opt-in, source pixels remain unchanged on open, and edits are saved only after explicit user action.

### Task 5: Verification and responsive review

**Files:**
- No new files unless verification reveals a defect.

- [x] Run the focused color-processing, persistence, backup, editor, and context-menu tests.
- [x] Run `npm run build` and the full `npm test` suite.
- [x] Start the dev server and use Playwright at desktop and mobile widths to verify controls fit, canvas renders, edits update only the preview, and explicit save/export works.
- [x] Review the final diff and confirm no generation request, generated image, or original stored image is color-adjusted automatically.
