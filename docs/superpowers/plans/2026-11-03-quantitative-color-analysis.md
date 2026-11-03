# Quantitative Color Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground explicit AI image color analysis in measurable local image statistics while keeping all recipe changes user-approved.

**Architecture:** Read pixels from the already-compressed preview canvas and calculate channel, luminance, tone-region, and near-neutral Lab statistics locally. Pass the compact report with the current preview and recipe to the existing Agent request; the existing candidate/apply/history flow remains unchanged.

**Tech Stack:** TypeScript, Canvas ImageData, Vitest, existing OpenAI-compatible Responses API.

---

### Task 1: Implement deterministic color statistics

**Files:**
- Create: `src/lib/colorImageAnalysis.ts`
- Test: `src/lib/colorImageAnalysis.test.ts`

- [ ] Test RGB channel percentiles/clipping, luminance tone distribution, Lab neutral estimates, sparse neutral samples, and alpha filtering using known synthetic pixels.
- [ ] Run `npm test -- src/lib/colorImageAnalysis.test.ts` and confirm the tests fail because the analyzer is missing.
- [ ] Implement bounded histogram-based RGB and Lab statistics without adding dependencies.
- [ ] Run the focused test and confirm it passes.

### Task 2: Extract statistics with the preview payload

**Files:**
- Modify: `src/lib/colorAssistantImage.ts`
- Test: `src/lib/colorAssistantImage.test.ts`

- [x] Add a payload helper returning the compressed preview JPEG and its local statistics from the same scaled canvas.
- [x] Test dimensions, transparent-pixel handling, and analysis errors; keep the existing JPEG behavior.
- [x] Run the focused test and confirm it passes.

### Task 3: Include evidence in explicit image-analysis requests

**Files:**
- Modify: `src/components/ColorAssistantPanel.tsx`
- Test: `src/components/ColorAssistantPanel.test.tsx`
- Modify: `src/lib/agentApi.ts`
- Test: `src/lib/agentApi.test.ts`

- [x] Test that the explicit analyze action sends statistics with the preview, while opening the editor sends nothing and instruction-only requests remain compatible.
- [x] Add a localized evidence block and instructions that distinguish measurable cast evidence from scene colors and abstain when neutral evidence is insufficient.
- [x] Keep proposal validation, candidate preview, history, and explicit apply behavior unchanged.
- [x] Run focused tests, then the full test suite, production build, and `git diff --check`.
