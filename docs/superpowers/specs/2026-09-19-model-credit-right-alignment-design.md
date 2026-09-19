# Model Credit Right Alignment Design

## Goal

Align each model option's credit amount and diamond icon to the right edge of the model selector dropdown, while keeping the model name on the left.

## UI behavior

- A standard model option is rendered as two visual regions: a left, truncatable model-name region and a right, non-shrinking `积分 💎` region.
- The right region is right-aligned across every option, including `价格待配置`.
- The diamond icon stays attached to its credit value and never wraps independently.
- Long model names truncate before they can push the price region out of alignment.
- The currently closed selector remains unchanged; this layout applies to the open option list only.

## Architecture

Extend the existing `Select` option type with an opt-in price metadata field. `InputBar` supplies the model display name as the label and the existing credit label as that metadata. Other selects retain their current layout because the new rendering path is used only when price metadata is present.

## Verification

- Add pure selector-layout tests covering an option with a short name, a long name, and `价格待配置` price text.
- Run the full test suite and production build.
- Manually check the open Gallery and Agent model lists at desktop and narrow widths: all values and diamonds share the same right edge.
