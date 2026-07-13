# Additional Image Model Lines Design

## Goal

Expose `Nano Banana 2` and add two selectable image models while reusing the project's existing request routes.

## Model Registry

- Keep `Nano Banana 2` (`gemini-3.1-flash-image-preview`) in the registry and remove it from the gallery-model exclusion filter.
- Add `Nano Banana 2 Lite` (`gemini-3.1-flash-lite-image`) with route `gemini-native`.
- Add `GPT-Image-2(官转线路，支持高质量4K）` (`gpt-image-2-official`) with route `openai-images`.
- All three models support reference images and are available in both Gallery and Agent image-model selectors through `BANANA_GALLERY_MODELS`.
- Continue hiding the legacy `gpt-5.5` Agent image line.

## Request Routing

- `gemini-3.1-flash-image-preview` and `gemini-3.1-flash-lite-image` use the existing Gemini native request path: `/v1beta/models/{model}:generateContent`.
- `gpt-image-2-official` uses the existing OpenAI Images paths: `/v1/images/generations` for generation and `/v1/images/edits` when reference images are supplied.
- API base URLs, proxy settings, request payload implementations, and Agent text behavior remain unchanged.

## Ordering

- Place `Nano Banana 2 Lite` immediately after `Nano Banana 2`.
- Place the official-transfer GPT model immediately after `GPT-Image-2(4K线路）`.

## Verification

- Assert all three requested models are visible.
- Assert display names resolve to the correct model IDs.
- Assert the two new models resolve to their inherited route types.
- Exercise actual request dispatch for both new model IDs and verify their URL paths and request-body model values.
- Run the complete test suite and production build.
