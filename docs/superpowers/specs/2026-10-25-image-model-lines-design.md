# Image model and line selector

The approved design keeps one image-model entry in the composer. Its trigger shows the model family and selected line. The popover has a model-family column and a line column, with per-image credits aligned on the right. Model names, line names and configured capabilities are separate. Nano Banana 2 and Lite remain distinct families.

Families are explicit metadata on the existing registry. Saved model IDs, dispatch routes, price conversion and parameter normalization remain authoritative. Gallery and Agent use the same component, with independent local per-family line memories. Selecting a family previews its routes; selecting a line commits the original registry ID and closes the panel. The most recently used line is indicated when revisiting a family. All routes, including backups, are immediately visible in the line column without a disclosure control. No automatic failover or price escalation is introduced.

The panel uses a body portal with viewport-aware positioning to avoid composer clipping. It supports keyboard navigation, Escape, outside dismissal, narrow screens and existing light/dark theme tokens. Prices reuse the current size-dependent helpers, including Official T3. Capability labels describe existing configured features without making quality or reliability claims.

Verification covers exact visible-registry coverage, family boundaries, original request IDs, T3 size pricing, validated line memory, backup visibility, viewport bounds, component output and real-browser interaction in desktop/mobile layouts. Run the relevant tests, full test suite and production build.

The user subsequently requested simpler controls for non-Nano Banana routes. In both Gallery and Agent, remove the format, compression and moderation controls. Normalize their effective request parameters to PNG, no compression override and automatic moderation, including persisted settings and reused task parameters. Keep size, quality, count and Gallery transparent-background controls. Desktop layouts use five columns for non-Nano Gallery models and four for Agent; Nano Banana retains its four-column aspect-ratio and image-size layout.
