# Input Bar Contrast and Collapse Design

## Goal

Make the floating image-generation input bar visually distinct from the gallery in light, dark, and sepia themes, and let users collapse it downward when they need more canvas space.

## Scope

This change applies to the shared `InputBar` rendered in both gallery and agent modes. It covers the input bar surface, prompt field, collapse controls, animation, page-bottom clearance, accessibility, and focused tests. It does not redesign parameter controls, task cards, or theme palettes outside the input bar.

## Selected Approach

The input bar collapses downward into a persistent bottom-center capsule. The capsule is more discoverable than leaving only a drag handle and saves more space than merely hiding the parameter row.

Alternatives considered:

- **Handle only:** uses the least space, but is easy to overlook and gives no textual explanation.
- **Partially collapsed composer:** keeps the prompt field visible and hides parameters, but does not sufficiently reduce obstruction of the gallery.

## Visual Hierarchy

The outer input card uses a dedicated elevated surface instead of inheriting the same translucent treatment as nearby cards. Theme variables provide:

- a near-opaque composer surface;
- a stronger border than ordinary gallery cards;
- a soft two-layer shadow, tinted neutrally in light and dark themes and slightly brown in sepia;
- a subtle focus accent when the prompt editor is active.

The prompt editor remains visually inset from the outer card. Its fill must differ from the composer surface by at least one visible tonal step, and its focus state uses the existing blue accent for border and glow. A restrained fade beneath the floating composer may be used to reduce interference from gallery text and thumbnails, but it must not look like a modal backdrop or block pointer input.

The treatment must remain legible in all three supported themes and at narrow mobile widths.

## Expanded State

- Desktop shows a collapse button in the upper-right area of the input card without conflicting with the prompt clear button.
- The button uses a downward chevron, has the accessible name `收起输入框`, and exposes an explanatory tooltip.
- Mobile keeps the existing top drag-handle affordance, but activating it now collapses the entire input bar rather than only the reference-image section.
- Existing prompt, image, parameter, upload, and submit interactions remain unchanged while expanded.

## Collapsed State

- The full card moves downward and out of view.
- A centered capsule remains fixed above the safe-area inset. It is approximately 44 px high and has a comfortable pointer/touch target.
- The capsule contains an upward chevron and the label `展开输入框`.
- Activating the capsule restores the full card.
- Prompt text, referenced images, mask drafts, parameters, and internal scroll positions remain intact because collapse only changes presentation; it does not unmount or reset composer state.
- The state is session-local component state. A full reload starts expanded so the primary action cannot remain hidden unexpectedly.

## Motion

Collapse and expansion use a roughly 240 ms transform-and-opacity transition with an ease-out curve. The card moves vertically; the capsule fades and translates slightly in the opposite direction. When `prefers-reduced-motion: reduce` is active, the transition is effectively immediate.

## Overlay and Focus Behavior

Before collapsing, transient input-bar overlays are dismissed, including the `@` reference menu and other menus owned by the composer. Modal workflows such as the size picker are not left visually detached from their trigger.

When collapsing from the keyboard, focus moves to the expand capsule. When expanding, focus returns to the collapse control rather than forcing focus into the prompt editor. Both controls expose `aria-expanded` and reference the composer region through `aria-controls`.

Pressing Escape does not collapse the composer; it continues to dismiss the nearest active overlay according to existing behavior.

## Layout and Clearance

The existing `--input-bar-clearance` measurement continues to reserve enough space below page content while expanded. In the collapsed state, clearance is recalculated from the capsule height and safe-area inset so users can reach the final gallery row without a large empty area.

Resize observation remains attached to the visible fixed container. Switching states, resizing the viewport, and opening the mobile keyboard must all trigger a clearance update.

## Component Boundaries

`InputBar` owns the expanded/collapsed state and the state transition because all preserved draft data already lives there or in the shared store. Styling is expressed through focused input-bar data attributes and theme variables in `src/index.css`, avoiding broad changes to generic card utilities.

Small presentational helpers may be extracted for the collapse button or capsule if this keeps `InputBar` readable, but no new global store field is required.

## Testing

Automated tests should cover any extracted pure state or layout helper, including the clearance chosen for expanded and collapsed states. Component-level coverage should verify:

- the composer starts expanded;
- collapse exposes the capsule without clearing draft state;
- expansion restores the composer and accessible state;
- overlay dismissal occurs before collapse;
- reduced-motion styling is available;
- page clearance changes with the visible composer footprint.

Manual verification should be performed in light, dark, and sepia themes at desktop and mobile widths. It must include a long prompt, reference images, the final gallery row, keyboard-only activation, mobile safe-area behavior, and reduced-motion mode.

## Acceptance Criteria

- The input bar is clearly distinguishable from the page and task cards in all supported themes.
- Desktop and mobile users can collapse the entire input bar downward.
- A visible, labeled bottom capsule always provides a way to expand it again.
- Collapsing and expanding preserves all draft input and parameters.
- No input-owned floating menu remains orphaned after collapse.
- Bottom content clearance matches the expanded or collapsed footprint.
- Collapse and expand controls are keyboard accessible and correctly labeled.
- Reduced-motion users are not forced to watch the slide animation.
