# Model Credit One Decimal Design

## Goal

Render every configured image-model credit amount with exactly one decimal place, truncating toward zero rather than rounding.

## Formatting rules

- `5` renders as `5.0 💎`.
- `1.25` renders as `1.2 💎`.
- `8.75` renders as `8.7 💎`.
- `3.125` renders as `3.1 💎`.
- `价格待配置` remains unchanged.

## Architecture and verification

Keep credit calculation unchanged. Change only `getBananaModelCreditLabel` to use one shared truncating formatter. Update all existing label expectations and add direct formatter cases. Run the full test suite and production build.
