# Agent Text Model gpt-5.6-sol Design

## Goal

Change the fixed Agent text model from `gpt-5.5-pro` to `gpt-5.6-sol`.

## Scope

- Update the shared `AGENT_FIXED_MODEL` constant.
- Update tests that assert the fixed Agent text model.
- Keep Agent requests on the existing Responses API route.
- Keep image model selection, API base URLs, and proxy configuration unchanged.

## Verification

- Confirm Agent conversation and title requests send `model: gpt-5.6-sol`.
- Run the focused Agent API and model-routing tests.
- Run the project test suite and production build.
