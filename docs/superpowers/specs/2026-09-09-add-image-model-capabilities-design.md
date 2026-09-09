# Additional Image Model Capabilities Design

## Goal

Add three selectable OpenAI Images models while preserving the existing `gpt-image-2` request contract. The two GPT Image 2.5 models support 1K, 2K, and 4K output tiers. `seedream-5-pro` supports only 1K and 2K.

## Approved Model Registry

| Display name | Model ID | Route | Size tiers | Reference images |
| --- | --- | --- | --- | --- |
| GPT-Image-2.5 Sunburst | `gpt-image-2.5-sunburst` | `openai-images` | 1K / 2K / 4K | Yes |
| GPT-Image-2.5 Flare | `gpt-image-2.5-flare` | `openai-images` | 1K / 2K / 4K | Yes |
| Seedream 5 Pro (1K/2K) | `seedream-5-pro` | `openai-images` | 1K / 2K | Yes |

The new entries will be placed after the existing `GPT-Image-2(4K线路）` entry and before the existing official-transfer and backup GPT Image entries. The same visible registry will feed Gallery and Agent image-model selectors.

## Architecture

`BANANA_MODEL_REGISTRY` remains the source of truth for model IDs, display labels, routing, reference-image support, and supported size tiers. Existing models retain their current behavior; models without an explicit capability override continue to support all existing OpenAI size tiers.

The size-tier type and pixel budgets remain centralized in `src/lib/size.ts`. The model registry exposes a helper that returns the active model's supported tiers, with the full tier list as the compatibility fallback for unknown or custom models.

## Size Selection and Normalization

`SizePickerModal` will receive the active model's supported tiers instead of using a fixed tier list. The Seedream picker will therefore show only 1K and 2K.

The shared parameter normalization path will enforce the same capability for every entry point, including Gallery submission, Agent image generation, retry, task reuse, and imported settings. For an explicit size above the active model's highest supported tier, normalization will preserve the requested aspect ratio as closely as the existing legal-size algorithm allows and reduce the pixel budget to the model's maximum tier. Custom width and height input will use the same rule. `auto` remains unchanged because it does not explicitly request a 4K tier.

Changing from a 4K-capable model to Seedream will automatically downgrade an existing explicit 4K size to a legal 2K size before submission. Changing to either GPT Image 2.5 model will not reduce an existing legal size.

## Request Routing and Payloads

All three new IDs resolve to the existing `openai-images` route. Text-to-image requests continue to use `images/generations`; requests with reference images or masks continue to use `images/edits`. The model ID and all existing parameters (`size`, `quality`, `output_format`, `moderation`, `output_compression`, and `n`) use the current `gpt-image-2` payload shape.

No new provider adapter, endpoint, or backend proxy allowlist is required in this repository. The existing OpenAI Images streaming guard remains route-based, so these models inherit the current non-streaming behavior used by registered OpenAI image models.

## Compatibility and Error Handling

- Existing persisted settings and task records remain readable without migration.
- Direct new model IDs and their display labels normalize to the registered IDs.
- Unknown/custom OpenAI-compatible models retain the current 1K/2K/4K size behavior.
- The UI prevents unsupported tier selection, while submission-time normalization protects programmatic calls and restored state.
- The client does not probe model availability; an upstream relay that does not expose one of the IDs will continue to return its normal API error.

## Verification

- Registry tests cover visibility, display-name normalization, routes, reference-image support, ordering, and supported tiers.
- Size tests cover Seedream 4K-to-2K downgrade, aspect-ratio preservation, custom-size clamping, `auto`, and unchanged behavior for the two 4K-capable models and custom models.
- API tests cover generation and edit dispatch for all three IDs and verify the model field and existing payload fields.
- Agent/store tests cover selected Agent image-model routing and persisted normalized parameters.
- Run the full Vitest suite and production TypeScript/Vite build.

## Scope

This change is limited to model registration, capability-aware size selection/normalization, request-routing regression coverage, and release documentation. It does not change the upstream service, add model availability discovery, or alter unrelated image parameters.
