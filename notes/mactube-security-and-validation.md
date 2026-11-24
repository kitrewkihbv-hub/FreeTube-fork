# MacTube security and validation notes

Review date: 2026-11-24. This is not a complete security audit or a guarantee of safety.

- `pnpm audit --prod` reported no known vulnerabilities in the production dependency graph.
- `pnpm audit` reported 55 advisories in the development/build dependency graph: 1 critical, 28 high, 22 moderate and 4 low at the time of the check. Examples include tar and undici in build tooling. These are not virus detections, and they were not patched as part of this UI change.
- The account code sends OAuth requests to YouTube endpoints and uses Electron safeStorage for credentials when available; it falls back to unencrypted on-disk storage when encryption is unavailable. Tokens are also made available to the renderer for authenticated API requests.
- The inherited FreeTube window configuration disables Electron `webSecurity`. This is a security tradeoff and was not changed without compatibility testing. Treat untrusted content and a compromised renderer as a risk, particularly with account tokens present.
- The release workflow is configured to download both macOS app ZIPs, extract their app bundles and ASAR contents, update ClamAV signatures, and scan them before publishing. A successful scan checks for known signatures, not every possible threat. Inspect the actual workflow run to know whether it succeeded.
- The rebrand keeps the existing FreeTube data directory in packaged builds; installing side by side therefore shares the same data. Back up your library before upgrading. macOS Keychain behavior and an upgrade from the previous app have not been tested on a Mac; signing in again may be necessary.

Validation includes mocked subscription pagination, fallback and failures (`node tests/youtube-account-subscriptions.cjs`), project lint, and production webpack packs. These tests do not establish live authenticated subscription completeness, macOS installer behavior, or playback against YouTube.
