# Agent Text Model Default and Reasoning Design

## Goal

Update the Agent text-model choices and make high reasoning effort the default for Agent text requests.

Supported choices:

- `gpt-6-astra` (default)
- `gpt-6.1-sol`

## Scope

- Update the Agent text-model registry and `AppSettings` type to the two supported IDs.
- Default missing, blank, unknown, and legacy model values to `gpt-6-astra` during settings normalization.
- Keep the existing Agent text-model selector and have it display the two supported models.
- Send `reasoning: { effort: "high" }` for Agent conversation, title-generation, and batch-image helper text requests.
- Preserve the existing profile credentials, Responses API route, proxy behavior, Agent image-model selection, and settings persistence/import/export behavior.

## Settings and Request Data Flow

The registry is the source of truth for selector options and model normalization. `DEFAULT_SETTINGS.agentTextModel` uses `gpt-6-astra`. Normalized settings keep either supported value and map invalid or legacy values, including `gpt-5.6-sol`, to the default. Agent request builders use the selected setting as the `model` and attach high reasoning effort to each text request.

Reasoning effort is fixed to `high`; this change does not add a separate user-facing control. The default and fallback are the same for new and existing settings.

## Compatibility and Error Handling

- Old saved or imported model IDs remain readable and normalize to `gpt-6-astra` without a migration prompt.
- API error handling, abort behavior, streaming behavior, and image generation parameters remain unchanged.
- A manually constructed or partial settings object must still use the default model and high reasoning effort after normalization.

## Testing

- Verify the exact Agent model choices, default, supported alternate, and normalization of missing, blank, unknown, and legacy values.
- Verify conversation, title-generation, and batch-image helper requests send the selected model and `reasoning.effort: "high"`.
- Run focused tests, the full test suite, and the production build.

## Non-Goals

- A configurable reasoning-effort selector.
- Per-conversation model selection or custom model IDs.
- Changes to image-model choices, Agent routing, or API profiles.
