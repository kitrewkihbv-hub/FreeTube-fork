# MacTube security and validation notes

Review date: 2026-11-24. This is not a complete security audit or a guarantee of safety.

- `pnpm audit --prod` reported no known vulnerabilities in the production dependency graph.
- `pnpm audit` reported 55 advisories in the development/build dependency graph: 1 critical, 28 high, 22 moderate and 4 low at the time of the check. Examples include tar and undici in build tooling. These are not virus detections, and they were not patched as part of this UI change.
- The account code sends OAuth requests to YouTube endpoints and uses Electron safeStorage for credentials when available; it falls back to unencrypted on-disk storage when encryption is unavailable. Tokens are also made available to the renderer for authenticated API requests.
- The inherited FreeTube window configuration disables Electron `webSecurity`. This is a security tradeoff and was not changed without compatibility testing. Treat untrusted content and a compromised renderer as a risk, particularly with account tokens present.
- The release workflow is configured to download both macOS app ZIPs, extract their app bundles and ASAR contents, update ClamAV signatures, and scan them before publishing. A successful scan checks for known signatures, not every possible threat. Inspect the actual workflow run to know whether it succeeded.
- The rebrand keeps the existing FreeTube data directory in packaged builds; installing side by side therefore shares the same data. Back up your library before upgrading. macOS Keychain behavior and an upgrade from the previous app have not been tested on a Mac; signing in again may be necessary.

Validation includes mocked subscription pagination, fallback and failures (`node tests/youtube-account-subscriptions.cjs`), project lint, and production webpack packs. These tests do not establish live authenticated subscription completeness, macOS installer behavior, or playback against YouTube.

### Discover and Live update

Discover requests YouTube's home browse (`FEwhat_to_watch`) and advances through continuations on refresh, mixing and deduplicating available videos. It prefers a signed-in TV feed when available, otherwise public TV and web feeds. Results can repeat and YouTube may limit or change its responses. Live uses YouTube's `FEtopics_live` browse and only displays items marked live, falling back to a live-filtered search. A private/restricted-mode session uses public requests rather than signed-in recommendations. Subscriptions remain a separate feed; neither discovery feed mutates subscriptions. The palette links to the existing color theme settings, with a separate light/dark button. Both pages can be selected as a startup tab.

Mocked feed/continuation/fallback tests, existing account and player regressions, lint, and production packaging were run locally. YouTube-wide Live, authenticated recommendations, and the Mac application have not been manually tested against a live account or on macOS; YouTube availability and formats can change. ClamAV and a production dependency audit are useful checks but do not establish that an installer is safe. Builds are ad-hoc signed and not notarized.

### Discover refresh follow-up

The dedicated Live discovery page was removed; existing live playback, chat and the subscribed-channel Live view remain. Discover combines YouTube home results with three rotating, randomly selected public topic searches per refresh. This sends those topic queries to YouTube and is not purely personalized recommendations. Results are deduplicated, recent videos are deprioritized, and each source has a 12-second wait limit. YouTube can still return repeated or limited results, and underlying requests may continue briefly after the wait times out. The previous Live startup route redirects to Discover. Mocked tests cover changing topics, fixed home feeds, timeouts, fallbacks, and retained live entry points; no live YouTube account or macOS test has been performed.

### Personalized discovery and subscription follow-up

Discover no longer searches unrelated preset topics. It tries signed-in YouTube TV and WEB home feeds; when signed in, it does not silently fall back to an anonymous home feed. It supplements those results with searches using up to two recent watched titles, weighted towards frequently watched channels. Those titles are sent to YouTube as search queries, and the UI discloses this. If family-friendly mode is enabled, the public restricted feed is used. No claim is made that this reproduces YouTube's ranking or that results will always be new.

The account subscription reader now retrieves up to five pages, tries other account feed formats when the result is small, and supplements small feeds with uploads from up to 40 channels returned as subscribed. Partial results are labeled; subscription changes invalidate cached account feeds and stale requests. Existing local and account feeds remain separate. Automated mocked tests and local packaging passed; account personalization, subscription completeness, playback and the installer have not been tested on macOS or with a live YouTube account.

### Discover refresh paging follow-up

Refresh now reads ahead through small home-feed pages and advances continuation pages for history-related searches instead of reopening only their first page. It prioritizes suggestions not shown recently and clearly labels when only earlier results are available. A repeat-only feed is reordered so it does not appear frozen, but reordering is not represented as new content. Automated tests include clicking the actual Discover refresh button, multi-page recommendations, fixed feeds and expired search continuations. These tests are mocked: the Mac build has not been tested with a live YouTube account, and actual results still depend on what YouTube supplies.

### Related-video refresh follow-up

In addition to home and history-based searches, Discover requests YouTube watch-next recommendations for up to two watched video IDs; when watch history is unavailable, it uses previously returned home recommendations as seeds. These video IDs are sent to YouTube through a public client (with restricted mode when selected). The feed remembers up to 1,000 displayed IDs within the current view session and reports how many suggestions were not previously shown, or when only old results are available. These related requests go to YouTube, not a separate recommendation service; the complete local history is not uploaded by this feature. Tests cover seed rotation, no-history fallback, actual click behavior, source failure, repeated results and parsing two SmartTube TV next-response fixtures (60 and 104 extracted video IDs); they do not establish that current live YouTube endpoints or a signed-in account will work on macOS.
