# Windows-only Desktop Auto-Update Design

## Goal

Enable automatic update checks and downloads for the installed Windows x64 NSIS client. Keep macOS automatic updates disabled for now and preserve its existing manual download experience. No Apple Developer account, Mac signing, or notarization is required for a Windows release.

## Approaches

1. **Recommended: publish Windows independently through the existing update server.** Build and publish only the Windows installer and feed. Atomically update the Windows feed and Windows download link while carrying forward the current macOS download links. This reuses the current secure publisher and avoids coupling Windows releases to unavailable Apple credentials.
2. Keep the existing all-platform release gate. This would still require successful signed and notarized Mac builds, so it does not meet the current constraint.
3. Move Windows updates to a separate hosting service. This adds a new service and credentials without improving the existing updater flow.

## Design

### Windows client

- Keep the existing electron-updater controller, fixed HTTPS Windows feed, background download, progress reporting, and explicit install confirmation.
- Continue to limit native auto-update support to packaged Windows x64 NSIS clients.
- macOS clients must not contact an automatic update feed. Keep the preload bridge and renderer fallback behavior needed to offer the existing manual download page.
- Web builds and older desktop clients retain their existing update behavior.

### Build and publication

- Add a Windows-only release path to GitHub Actions. Ordinary pushes continue to run verification/build jobs without publishing. Explicit publish dispatch or a matching version tag builds and publishes only Windows artifacts.
- Publication preflight requires the restricted SSH publishing credentials. Windows code-signing credentials remain optional and paired; Apple signing credentials are not required by this path.
- Validate the NSIS installer, `latest.yml`, blockmap files, version, SHA512, and sizes locally before upload. Keep the existing immutable artifact paths and atomic `current` pointer switch.
- On the server, validate the staged Windows release and preserve the active `version.json` macOS URLs when creating the new active manifest. Leave macOS update feed files and pointers untouched. Publish the Windows feed and version manifest together only after all files verify.
- Reject version reuse and unsafe or incomplete artifacts. Failed publication leaves the previous active manifest in place.

### Download page and operator setup

- Keep the current download page and its Windows URL contract. Windows releases update `downloads.windowsUrl`; existing `downloads.macosArm64Url` and `downloads.macosX64Url` remain unchanged.
- Update the operator guide to document Windows-only GitHub secrets and release steps, explain that Apple credentials are not needed, and identify the remaining server-side SSH/Nginx prerequisites.
- Do not publish to production or change live server configuration as part of implementation.

## Error handling and compatibility

- Retain current updater error messages and retry behavior on Windows.
- macOS must not show native-download progress or installation actions while the updater is disabled; users continue through the manual download link.
- Existing installed clients continue using the same Windows feed URL. Existing Mac feed URLs remain valid and unchanged.
- A publisher validation or upload error must not switch the active manifest. Never print secrets in logs.

## Tests and acceptance

- Test platform enablement: Windows x64 uses its feed; macOS and unsupported builds do not enable native updates.
- Test publication staging and remote installation with Windows-only artifacts, preserving both existing Mac URLs and Mac feeds.
- Test that invalid manifests, missing payloads, hash mismatches, and failed publication leave the active release unchanged.
- Run focused desktop update/publication tests, `npm test`, and `npm run build`.
- Inspect the desktop update UI to confirm Windows update states work and macOS still exposes manual download.
- Document that actual GitHub publication and installed-to-installed Windows update remain unverified until the owner configures SSH publishing credentials and the server is ready.
