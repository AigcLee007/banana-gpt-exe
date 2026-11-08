# Windows Client Unified API Proxy Design

## Goal

Route model API requests from the packaged Windows client through Electron's main process so renderer requests do not depend on upstream browser CORS headers. Preserve the API base URL, API key, model-specific request bodies, and existing web proxy behavior.

## Scope

Included request families:

- OpenAI-compatible image generation and edits, including asynchronous task polling and artifact reads.
- Configured custom-provider image endpoints and Gemini-style model endpoints.
- FAL image model, queue, and result API requests made by the FAL SDK.
- Native Midjourney generation and task polling.
- Agent and Responses API calls, including streaming responses.
- Video task submission, polling, and content reads.
- Existing model-powered upscale requests.

Web builds keep using the existing same-origin deployment proxy and its configured lock/enable behavior. Result-image downloads keep using the existing restricted download proxy. Account billing calls, third-party media uploads, updater traffic, and site deployment are outside this change.

## Design

Add one renderer-side transport helper for API calls made by the packaged desktop app. It will detect the `app:` runtime and route the request through a same-origin app protocol endpoint. Web builds continue using their current URL construction and fetch behavior.

Electron's main process will validate and forward the request with `net.fetch`, preserving supported methods, request bodies, authorization, content type, range headers, streaming response bodies, and upstream status/headers. The renderer supplies both the request URL and the configured API base URL; the main process requires the same HTTPS origin and confines the request path to that base path. This supports user-configured custom-provider routes while keeping the proxy bound to the configured API profile. Root-scoped Midjourney routes are separately limited to the documented generation and task paths. Supported methods are GET, HEAD, POST, and PUT for FAL queue cancellation. Requests must contain no URL credentials and target a public hostname. Private, loopback, link-local, and redirect-to-other-host targets are rejected.

The renderer transport must not log API keys or request bodies. Proxy failures should return bounded, user-readable errors without exposing credentials. Abort signals and existing request timeouts should continue to cancel or bound network work where supported.

The FAL SDK must use the shared transport for its API and queue calls, retaining its `X-Fal-Target-Url` routing header for configured FAL relays. Temporary presigned object-storage uploads and result media URLs remain direct asset transfers because they are not requests to the configured model API base.

## Alternatives

1. Extend each model adapter independently. This is rejected because it duplicates transport policy and makes it easy to miss Agent streams, async polls, or new models.
2. Add a shared Electron transport used by model adapters. This is recommended because the main process can bypass renderer CORS while preserving per-profile API destinations.
3. Route desktop traffic through the public web server. This would require an online server dependency and still would not cover installations that cannot reach that proxy.

## Validation

- Unit tests verify configured-base path confinement, supported methods, HTTPS/public-host validation, redirect rejection, safe header forwarding, and response status/body preservation.
- Adapter tests verify desktop requests use the app-local proxy endpoint while web requests retain their existing URLs and proxy settings.
- Coverage includes image generation/edits, Midjourney, Agent/streaming, video submission/polling, artifact reads, and profile-specific base URLs.
- Run focused tests, the full `npm test` suite, and `npm run build`.
- Real upstream behavior still depends on network access and valid user-configured API credentials; automated tests use stubbed upstream responses.

## Security and Compatibility

The main process must not become an unrestricted URL fetch service. It must reject unsupported paths and methods, non-HTTPS destinations, credentials embedded in URLs, non-public host addresses, and cross-host redirects. Authorization is forwarded only to the configured API destination. No web server configuration or production release is included.
