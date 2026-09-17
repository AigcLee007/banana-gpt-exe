# Agent Text Model Selection Design

## Goal

Allow users to choose the global text model used by Agent mode from the Agent settings page.

The supported choices are:

- `gpt-5.6-sol` (default)
- `gpt-6-astra`

## Scope

- Add an `agentTextModel` field to `AppSettings`.
- Normalize missing or unsupported values to `gpt-5.6-sol` so existing saved settings and imported settings remain valid.
- Add a text-model selector to the existing Agent settings tab.
- Persist the choice through the existing settings store and include it in the existing settings import/export flow.
- Use the selected model for Agent conversation requests, conversation-title requests, and batch-image helper requests.
- Preserve the existing Responses API route, API profile credentials, API proxy behavior, and Agent image-model selection.

## Model Registry

Define a small Agent text-model registry in the existing Agent/model configuration module. Each option has a stable model ID and a user-facing label. The registry is the source for both normalization and the settings selector, preventing the UI and request validation from drifting apart.

The default model remains `gpt-5.6-sol` for backward compatibility with the current fixed-model behavior.

## Settings and Data Flow

1. `DEFAULT_SETTINGS.agentTextModel` is initialized to `gpt-5.6-sol`.
2. `normalizeSettings` accepts only supported model IDs and falls back to `gpt-5.6-sol` for missing, blank, or unknown values.
3. The Agent settings selector updates the draft settings through the existing `commitSettings` path, so the normal Zustand persistence behavior is reused.
4. Imported settings pass through the same normalization path, and exported settings include the field automatically as part of the `AppSettings` object.
5. Agent API request builders read `settings.agentTextModel` and send it as the Responses API `model` value.

The existing `AGENT_FIXED_MODEL` constant remains available as the default-model compatibility constant, but it is no longer the runtime source for a user-selected Agent text model.

## UI

Add a compact select control to the Agent settings tab, adjacent to the existing Agent preferences. The label should clearly identify it as the Agent text model, and the two visible options should be `GPT-5.6-sol` and `GPT-6-astra`. Changing the selection takes effect for subsequent Agent requests and does not alter existing conversations.

## Error Handling and Compatibility

- Unknown persisted or imported model IDs silently normalize to the default model.
- No migration prompt is needed because the current runtime model is already the default option.
- Existing API errors and abort behavior remain unchanged.
- If a settings object is constructed manually without the new field, API-facing normalization or a defensive request fallback must still send `gpt-5.6-sol`.

## Testing

- Add model-registry and normalization tests for the default, supported alternate, blank, and unsupported values.
- Update Agent API tests to verify the selected model is sent for conversation, title, and batch-image requests, while omitted/legacy settings use `gpt-5.6-sol`.
- Keep existing fixed-model regression coverage aligned with the default-model constant.
- Run the focused tests, the full test suite, and the production build.

## Non-Goals

- Per-conversation or per-message model selection.
- Adding arbitrary custom text-model IDs.
- Changing image-model choices or API profile selection.
- Changing the Agent endpoint, request format, or streaming behavior.
