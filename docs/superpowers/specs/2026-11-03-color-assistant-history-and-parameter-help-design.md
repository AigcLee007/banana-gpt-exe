# Color Assistant History and Parameter Help

## Goal

Make repeated AI color adjustment rounds easy to continue and review, and make every manual color control understandable without leaving the editor. The existing proposal flow remains non-destructive: an AI proposal changes the active recipe only after the user explicitly applies it.

## User Flow

1. The user applies an AI proposal. The editor renders the updated preview and recipe; a later instruction uses that latest preview and recipe as its starting point.
2. When a valid AI proposal arrives, the app records its instruction, explanation, proposed scalar and curve changes, creation time, and `pending` outcome in local storage.
3. Apply marks the round `applied`; Discard marks it `discarded`. A proposal invalidated by a manual recipe or image change is marked `expired`. Request failures and cancellations do not create suggestion records.
4. The user opens a collapsible round history in the AI assistant section. Entries are newest first and show the request, outcome, explanation, and exact before/after values. Expanding an entry reveals its curve changes and clarification text. History is read-only; only a current, validated proposal can be applied.
5. The history is grouped by the source image lineage, so opening a saved color-edited version shows the same rounds as its source. Each row also identifies the image version that was active when the round was requested.
6. The user can hover or keyboard-focus a help control beside a color parameter to see its purpose and the effect of increasing or decreasing it. On touch devices, tapping the help control displays the same explanation.

## History Data and Persistence

Add a `ColorAssistantHistoryRecord` stored in a dedicated IndexedDB object store with an index on the source image ID. A record contains:

- A stable record ID, source image ID, active image ID, creation time, and optional decision time.
- The user's instruction, the assistant's explanation, and optional clarification.
- Scalar changes with their allowlisted path and before/after values.
- Curve changes with channel and before/after normalized point arrays.
- An outcome of `pending`, `applied`, `discarded`, or `expired`.

Do not store source images, rendered previews, credentials, or full model request/response payloads. The history contains enough adjustment detail to review a round but does not provide a re-apply action. Records are local and are included in gallery workspace export/import. When a source image is removed by gallery cleanup, its history is removed as well. Existing backups without assistant history remain valid.

Persist a completed proposal before presenting it as a candidate. Apply and Discard update the corresponding outcome. Database errors must be shown to the user; they must not silently alter the current recipe or claim that a history update was saved.

A `pending` record remains a read-only historical snapshot if the editor closes before the user decides. If saving a new record fails, keep the current candidate available for an explicit Apply or Discard action and clearly report that this round was not saved to history. If saving an outcome fails, keep the user's in-memory Apply or Discard result and report that the recorded status could not be updated; the last successfully stored status remains authoritative.

## Parameter Help

Use a shared help-description map for every numeric control and custom adjustment surface. A description states what the control affects and what moving it higher or lower does. Cover:

- Exposure, contrast, highlights, shadows, whites, blacks, saturation, and vibrance.
- White-balance temperature and tint, including the neutral-point sampler.
- Master and RGB input/output levels and gamma, plus point curves.
- Hue, saturation, and luminance for each HSL color range.
- Shadow, midtone, and highlight color wheels, balance, and blending.
- Channel-mixer output/input contributions and LUT import/removal.

Render a small help icon alongside the relevant label or group heading. Use the app's viewport-aware tooltip behavior so explanations remain onscreen near editor edges, and keep the control's accessible name and keyboard operation intact. Group-level help is acceptable for a custom control when it explains every interaction in that group.

## State and Error Handling

- A new request is based on the latest ready preview and recipe. A request in flight or candidate from a previous recipe/image cannot overwrite newer state.
- Apply updates only the in-memory color recipe and one undo step. Discard updates only history outcome and candidate state. Saving an image version or exporting remains a separate action.
- If a round becomes stale before Apply, do not apply it; mark it expired and retain it in history.
- If history persistence fails, show a recoverable error. Do not report an outcome as saved unless IndexedDB confirms the write.
- Opening, reading, or expanding history makes no network request.

## Backup Compatibility

Include assistant history only in the gallery workspace data scope. Validate records during import, keep source-image references consistent, and ignore the optional history field when reading older backups. Preserve history for retained source image lineages and remove history for lineages removed by cleanup.

## Testing

- Verify a second request after Apply uses the updated recipe and newly rendered preview.
- Verify each successful proposal is persisted as pending and transitions to applied, discarded, or expired after the corresponding user action.
- Verify a reopened editor can query history for both source and saved edited versions, with newest-first ordering and exact before/after details.
- Verify failed/canceled requests create no history and history reads do not call the API.
- Verify export/import preserves history, older backups import without it, and gallery cleanup removes only records for removed source lineages.
- Verify every slider and custom control has a non-empty explanation; hover, keyboard focus, and touch activation expose it without clipping at desktop and narrow viewport edges.
- Verify all parameter help, history, and iteration actions preserve explicit Apply, undo, save, and export boundaries.

## Alternatives Considered

- Keep round history only in React state: simplest, but closing the editor loses the user's record. Rejected because the user asked to query previous rounds.
- Store complete images or previews with each round: would duplicate large local assets and retain unnecessary data. Rejected; store adjustment details only.
- Use native `title` attributes for parameter help: quick, but placement and keyboard/touch support are inconsistent. Rejected in favor of the existing viewport-aware tooltip pattern.
- Automatically apply or re-apply a historical suggestion: faster in some cases, but bypasses the current proposal review and stale-state checks. Rejected; history is read-only.
