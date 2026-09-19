# Model Credit Pricing Design

## Goal

Show the cost of each selectable image model directly in the model selector. Use a diamond icon to mean credits, for example: `Nano Banana Pro（优惠线路） · 5 💎`.

The source prices are fixed reference prices from `https://vip.aittco.com/pricing`; `¥1 = 12.5 💎`.

## Price data and model identity

Add an optional RMB price-per-image field to each image-model registry entry. A shared helper converts RMB to credits and formats whole and fractional values without trailing zeroes.

The configured mappings are:

| Display name | Request model ID | RMB / image | Credits / image |
| --- | --- | ---: | ---: |
| Nano Banana Pro（优惠线路） | `gemini-3-pro-image-preview` | 0.40 | 5 |
| GPT-Image-2.5 Sunburst | `gpt-image-2.5-sunburst` | 0.30 | 3.75 |
| GPT-Image-2.5 Sunburst(官渠，支持max） | `gpt-image-2.5-sunburst-官渠（支持max）` | 0.70 | 8.75 |
| GPT-Image-2.5 Flare | `gpt-image-2.5-flare` | 0.30 | 3.75 |
| GPT-Image-2(4K线路） | `gpt-image-2` | 0.30 | 3.75 |
| Seedream 5 Pro (1K/2K) | `seedream-5-pro` | 0.25 | 3.125 |
| Nano Banana 2 | `gemini-3.1-flash-image-preview` | 0.20 | 2.5 |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | 0.10 | 1.25 |
| GPT-Image-2(官转线路，支持高质量4K） | `gpt-image-2-official` | 0.80 | 10 |
| Nano Banana Pro（备选） | `nano-banana-pro` | 0.40 | 5 |
| GPT-Image-2（备用） | `gpt-image-2-svip` | 0.30 | 3.75 |

The hidden legacy `gpt-5.5` entry remains out of the selectable image-model list and is out of scope for price display.

## Official T3 route

Keep one user-facing option, `Nano Banana Pro（官方T3）`. Its registry value, `nano-banana-pro-official-t3`, is an internal route-selection key rather than an upstream model ID. The existing request path already resolves the actual request model from the selected image-size tier; price display must reuse that same mapping:

| Selected tier | Request model ID | RMB / image | Credits / image |
| --- | --- | ---: | ---: |
| 1K | `Nano-banana-pro-1K` | 0.50 | 6.25 |
| 2K | `Nano-banana-pro-2K` | 0.60 | 7.5 |
| 4K | `Nano-banana-pro-4K` | 0.70 | 8.75 |

This option supports 1K, 2K, and 4K. When its size changes, both the already-resolved request model ID and visible diamond amount change together. The existing `banana-t3-images` request routing and dynamic upstream-ID resolution remain unchanged.

## UI behavior

- Both Gallery and Agent image-model selectors render the option label as `display name · formatted credits 💎`.
- The closed selector shows the same label for the active model, so the price remains visible after selection.
- The official-T3 label is derived from the current selected size tier and refreshes immediately when that tier changes.
- Prices use up to three decimal places because the stated conversion produces `3.125 💎` for Seedream 5 Pro. Whole numbers do not show decimal places.
- A selectable model without a configured price displays `价格待配置`; it never displays `0 💎`.
- No separate price table, balance deduction, checkout, or live remote pricing synchronization is included.

## Architecture

1. Extend the existing `BananaGalleryModel` metadata and add narrowly scoped pure helpers for model-price lookup, RMB-to-credit conversion, and formatted option labels.
2. Move or expose the existing official-T3 size-to-request-ID mapping from a shared pricing-safe location, then derive the matching price from it. Preserve the display registry key as the saved selection and leave API dispatch behavior unchanged.
3. Build selector options from the shared helpers in `InputBar`, so Gallery and Agent use the same labels and no duplicated pricing logic.

## Error handling and compatibility

- Unknown model IDs, missing price entries, and unsupported size values return an unavailable-price state rather than throwing or inventing a price.
- Existing selections normalize as before. The official-T3 API path continues submitting its existing valid size-specific model ID.
- Other providers, parameter compatibility, stored credit balances, and API settings are untouched.

## Verification

- Unit-test all configured ID-to-price mappings and conversion/formatting behavior, including `3.125 💎`.
- Unit-test official-T3 mappings for 1K, 2K, and 4K: exact request ID and exact displayed credits.
- Update selector tests to assert the price text appears in Gallery and Agent options and active labels.
- Retain and run the existing API dispatch tests that assert the official-T3 route sends the size-specific ID; no API-dispatch behavior changes.
- Run the full test suite and production build.
