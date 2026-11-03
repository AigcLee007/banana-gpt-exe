# AI Image Color Analysis Design

## Goal

Let users request a visual color assessment of the image being edited and receive a validated color recipe proposal that they can preview and apply with one explicit action.

## Context

The color editor already renders a preview from the source image and current recipe. The AI color assistant can send a compressed preview to the configured OpenAI-compatible Agent profile, accepts only the `propose_color_adjustments` structured function call, validates each recipe path and range, renders proposals as candidates, and records candidate decisions in source-image history.

The editor also supports continued adjustment from an accepted recipe. The new flow should use that current edited preview and recipe so a second analysis builds on the user's current state.

## User Flow

1. The user opens the color editor for a generated or uploaded image.
2. Nothing is sent to the model until the user clicks **Analyze image colors**.
3. The app sends the current rendered preview and current editable recipe with a fixed analysis request. It asks the model to describe visible color issues and propose conservative, targeted changes. If the image is already balanced, the model may recommend keeping the current recipe.
4. The app validates the result through the existing proposal contract and renders it as a candidate. The candidate explains its visual observations and lists parameter before/after values.
5. The user can apply the candidate to the live preview in one click, keep the current recipe when the proposal contains no changes, or discard the proposal. Applying never saves or exports the image automatically.
6. The request and its outcome appear in the existing source-image history and remain available after reopening the editor.

## Interaction and State

- Add an explicit **Analyze image colors** action beside the existing natural-language request action.
- The analysis action does not require text in the instruction field. It uses a fixed, localized analysis instruction and sends the preview image.
- Both request modes share request cancellation, stale-image/recipe checks, structured proposal validation, candidate rendering, and history persistence.
- A new request expires any unresolved prior candidate, matching current behavior.
- A candidate with parameter changes uses the existing **Apply suggestion** and **Discard suggestion** actions.
- A valid no-change result shows its explanation and offers **Keep current recipe** and **Discard suggestion**. Keeping the recipe marks the recommendation accepted without changing any color parameter.
- No proposal is applied automatically, and no image is saved or exported as a side effect.

## Image and Privacy Boundaries

- Send only the current rendered preview, compressed to JPEG with a maximum edge of 768 px, plus the current editable recipe and the fixed analysis instruction.
- The preview reflects current in-memory adjustments, including adjustments from earlier accepted rounds.
- Preserve the existing explicit-send privacy notice and configured Agent profile requirements.
- Do not send the source-resolution image, API settings, LUT data, or unrelated gallery contents.
- Do not trigger analysis on editor open, image change, or recipe change.

## Failure Handling

- Disable both request actions while the image preview is not ready, the Agent profile is invalid, or another request is running.
- Keep the current recipe unchanged if image preparation, network access, response parsing, or proposal validation fails.
- Preserve existing cancellation and stale-result protections.
- Keep the existing user-facing error for models that reject image input and offer the existing text-only retry only for the natural-language flow; image analysis itself requires an image-capable model.
- If history persistence fails, leave the candidate available for an explicit user decision and state that this round was not saved.

## Validation

- Unit-test that image analysis can run with an empty user instruction, sends the compressed image, and supplies the fixed diagnostic prompt with the current recipe.
- Test the candidate lifecycle for changed and no-change proposals, including apply/keep-current, discard, history outcome, stale recipe invalidation, and no automatic save/export.
- Verify the editor at desktop and narrow widths, including an explicit no-send-on-open check.
- Run the complete test suite, production build, and whitespace checks.

## Scope

Reuse the existing Agent API, proposal schema, image compressor, candidate preview, and history database. Do not introduce a separate model endpoint, background image analysis, automatic recipe changes, image saving, or export behavior.
