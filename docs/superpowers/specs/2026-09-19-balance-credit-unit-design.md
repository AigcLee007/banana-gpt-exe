# Balance Credit Unit Display Design

## Goal

Show all three API Key balance values with the diamond credit unit and exactly one decimal place.

## Scope

- Update the existing balance cards in both the desktop and mobile settings layouts.
- Render remaining, total, and used points as `<truncated one-decimal value> 💎`.
- Keep the query request, returned `ApiKeyBalanceInfo` values, and all balance calculations unchanged.

## Design

Use one local presentation helper in `SettingsModal.tsx` to truncate a numeric value toward zero to one decimal and append ` 💎`. Both repeated balance-card renderings call that helper for `remaining_points`, `total_points`, and `used_points`.

Examples: `5` becomes `5.0 💎`; `1.25` becomes `1.2 💎`; `8.75` becomes `8.7 💎`.

## Verification

Add a focused test for the helper's whole-number and truncation cases. Run the focused test, the full test suite, and the production build.
