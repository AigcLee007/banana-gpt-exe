# AI Color Assistant Design

## Goal

Let a user describe the desired look in natural language and receive a precise, reviewable set of color adjustments for the image currently open in the color editor. The assistant uses the configured Agent text model and the current preview, while preserving the existing non-destructive editing workflow.

## User Flow

1. The user opens the color editor and enters an instruction such as “reduce the red cast, cool the image slightly, and keep skin tones natural.”
2. On explicit submit, the app sends the instruction, current adjustment recipe, and a reduced-size JPEG of the current rendered preview to the configured Agent Responses API model.
3. The model returns a short explanation and a structured adjustment patch. It does not return or generate image pixels.
4. The app validates the patch and displays each proposed parameter change with its before and after values.
5. The user chooses Apply or Discard. Apply updates only the editor's adjustment state and preview, and creates one undo step. Discard leaves the current recipe unchanged.
6. The user can continue with another natural-language instruction using the resulting current preview and recipe. Saving a version or exporting remains a separate explicit action.

The preview image is resized to a maximum edge of 768 pixels and encoded as JPEG before upload. The source-resolution image is never sent for this request. The request is made only when the user submits an instruction.

## API and Structured Output

Add a dedicated color-assistance function in `src/lib/agentApi.ts`, reusing the active Agent API profile, Agent text model, authorization, proxy selection, timeout, and abort behavior. The request uses the Responses API with one strict function tool, `propose_color_adjustments`. It does not use the image-generation tools or enter the Agent image-generation loop.

The function result contains:

- A concise Chinese explanation of the proposed correction.
- A list of scalar adjustment changes, each using an allowlisted adjustment path and a numeric value.
- Optional point-curve replacements for a specific master or RGB channel.
- An optional clarification question when the instruction is ambiguous and the model cannot make a responsible proposal.

The allowlist covers basic tone controls, white balance, master/RGB levels, eight HSL ranges, three-way color grading, channel mixer values, and point curves. LUT data is excluded: a model should not synthesize a large `.cube` table. The tool schema has no free-form parameter names and disallows additional properties.

## Validation and State

Treat the model result as untrusted input. Validate the response envelope, allowed paths, finite numeric values, curve point count, coordinate bounds, and curve ordering. Apply the candidate changes to a clone of the current recipe and pass it through `normalizeColorAdjustments` before showing it. Reject the entire proposal if any part is invalid; do not partially apply malformed output.

Keep the candidate separate from the active recipe until the user selects Apply. Applying creates a single history entry, replaces the active adjustment recipe, and lets the existing preview renderer update. Discarding clears the candidate. Undo and redo continue to operate through the editor's existing history. The assistant never calls save, export, image storage, task mutation, or generation APIs.

## UI

Add a compact AI adjustment section near the top of the color controls with a natural-language input, submit action, and busy/cancel state. Show the returned explanation and a compact before/after parameter list in the same section, with Apply and Discard actions. Keep the editor's ordinary manual controls available while a proposal is displayed; a manual adjustment invalidates a stale proposal so it cannot later overwrite newer edits.

If the active profile does not support the Responses API, show the same configuration guidance used by Agent mode. If the configured model rejects image input, report that it cannot analyze images and offer an explicit text-and-recipe-only retry. Network errors, cancellation, malformed output, and timeouts leave the active recipe unchanged and show a recoverable message.

## Privacy and Cost

Show a concise notice beside the submit action that the compressed current preview is sent to the configured Agent model for analysis. Only the user's explicit submission triggers transfer. The service uses the existing profile and its timeout/proxy behavior; no new provider credential or image-retention mechanism is introduced by the app.

## Testing

- Test request construction uses the selected Agent text model, configured profile, current recipe, compressed preview, and strict tool schema.
- Test patch validation rejects unknown paths, non-finite/out-of-range values, malformed curves, and oversized responses.
- Test valid scalar and curve proposals produce the expected candidate recipe without changing the active recipe.
- Test Apply creates one undo step, Discard does not change adjustments, and a stale proposal cannot overwrite a newer manual edit.
- Test request errors, cancellation, unsupported image input, and malformed responses leave the current recipe and source image untouched.
- Verify in a browser that preview analysis is opt-in, apply updates only the preview, and save/export remain explicit.

## Alternatives Considered

- Text and recipe only: lower image-transfer cost and more private, but the model cannot inspect the actual color cast. Keep it as an explicit fallback for models that reject image input.
- Add color grading as a mode in the general Agent conversation: this introduces image-generation tools, conversation state, and extra opportunities for unrelated actions. A dedicated one-purpose request is easier to validate and keep non-destructive.
- Automatically apply the model result as soon as it returns: this removes a confirmation step but makes unexpected model output harder to inspect. The proposal-and-apply flow keeps every visible change user-directed and undoable.
