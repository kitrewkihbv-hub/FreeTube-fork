# SmartTube account/history research for FreeTube

Scope: inspect SmartTube's account, history, and playlist source for transferable behavior, then implement only evidence-backed compatibility work in FreeTube. This is **not** a SmartTube macOS port. SmartTube's behavior is reference material, not proof that FreeTube's authenticated requests succeed.

## Source revisions checked

- SmartTube: `yuliskov/SmartTube` `master` at `a0c319a88cc7ac65749dd353c404e4aa3fddb9bc`.
- Pinned `MediaServiceCore` submodule: `bad6cb5791f996e6026f1c4a76313adc94c001c7`.
- Pinned `SharedModules` submodule: `e12618a07ada786d5b731b2d668efe1383992547`.
- Verified both submodule checkouts against the gitlinks in the SmartTube commit; they match.

## What SmartTube does

### Requests and parsing

- `YouTubeContentService.getHistory()` checks sign-in, then calls `BrowseService2.getHistory()`.
- Current v2 history is a TV browse request for `FEhistory`. `BrowseService2.getMyPlaylists()` uses `FEplaylist_aggregation`. The older v1 history path uses `FEmy_youtube`; do not mistake it for the current v2 route.
- `BrowseService2.getBrowseGridTV()` returns the initial `BrowseMediaGroupTV` by default; `shouldContinue` defaults to `false`. Additional results are requested with a continuation token, not assumed to be included in the initial response.
- SmartTube has its own response models and helper functions in `MediaServiceCore`; it does not rely on the installed FreeTube `youtubei.js` parser. Its TV browse helper selects the direct grid, a right-column playlist list, a relevant tab (subscriptions tab or first tab), or the first shelf. It reads continuations from the tab, playlist list, section/shelf, or grid. Item decoding handles renderer variants including `gridVideoRenderer`, `videoRenderer`, `playlistVideoRenderer`, `tileRenderer`, lockups, and Shorts.
- The checked-in history fixtures show why a generic `feed.videos` assumption is unsafe:
  - `youtubeapi/src/test/resources/browse/tv/history.json`: 15 `gridVideoRenderer` entries are nested under `contents.tvBrowseRenderer...tvSecondaryNavRenderer...tabs[0].tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items`; the grid carries `nextContinuationData`.
  - `history_25.01.2023.json`: a continuation response has 15 `tileRenderer` entries under `continuationContents.sectionListContinuation.contents[0].shelfRenderer.content.horizontalListRenderer.items`; the continuation is again in `nextContinuationData`.
- A local reproduction with installed `youtubei.js` 18.3.0 and `history.json` showed the TV browse root being JIT-generated, but `Tab` rejects `TvSurfaceContent` as an unsupported content type. The resulting `History` has zero videos, zero sections, and no continuation, and its memo contains no `GridVideo` rows. The raw response still has all 15 IDs. This is a parser-shape incompatibility, not evidence of an auth failure.

### Account authentication and history writes

- SmartTube's browse calls normally go through `RetrofitHelper.get()` with auth enabled. Its OkHttp interceptor adds configured auth headers when present; otherwise it uses the API key. `AppClient.TV` is marked as auth-supported.
- `YouTubeAccountManager` stores the refresh token, refreshes temporal access tokens, and can query the account list under its auth header. That documents SmartTube's own auth path; it does not validate FreeTube's saved OAuth tokens or live response.
- SmartTube history is both server-backed and locally supplemented. `VideoStateController` saves position/progress locally and updates the remote history; update calls are suppressed for incognito, disabled-history, or selected remote-playback cases. `MediaServiceManager.updateHistory()` marks the remote history broken on failure. `BrowsePresenter.appendLocalHistory()` supplements the remote group from `VideoStateService` when remote history is empty or marked broken. Clearing history clears the remote list and local playback-state store. This is playback behavior, not bulk account-history import.
- `BrowsePresenter` maps the History page to the history service observable. The settings/preferences also control whether history is enabled.

### Playlists and subscriptions

- SmartTube's account playlist index uses `FEplaylist_aggregation`; the TV result is wrapped in `BrowseMediaGroupTV`. Its wrapper can merge locally cached playlist groups and keeps Watch Later (`WL` / `VLWL`) and Liked (`LL` / `VLLL`) near the front. This is mainly a UI/cache merge, not FreeTube's account-import algorithm.
- SmartTube gets subscribed-channel tabs from the TV `FEsubscriptions` result. That is distinct from FreeTube's current `FEchannels` + Guide/activity-feed subscription import fallback; the SmartTube channel-tab path is not, by itself, proof of a complete all-channel export.

## FreeTube path and changes made

- FreeTube signs in a TV `youtubei.js` client and uses account helpers in `src/renderer/helpers/api/local.js`. It also retries selected reads using a signed-in WEB client. History and playlist code already had Library/HL fallbacks, page caps, and local/store merge behavior, but the TV parser can discard the renderer tree before those readers see any rows.
- Added `src/renderer/helpers/api/youtubeAccountRawFeed.js`, a parser-independent reader for raw InnerTube browse JSON. It handles TV/Web selected content, grid/playlist-list/section/shelf rows, grid-video and older tile renderers, playlist cards, and continuation tokens from both initial and continuation responses. Raw requests use `Innertube.actions` directly, so they remain available if a parser throws before constructing a Feed; the raw feed wrapper uses that same authenticated `Actions` instance for continuation requests.
- Updated the account history path to retry `FEhistory` as raw JSON when parsed history yields no videos or fails to construct a feed, and to use raw rows/continuations for the `HL` playlist fallback even if its parser fails. Raw video rows are converted to minimal FreeTube records without passing incompatible TV nodes back through `youtubei.js`.
- Updated the playlist path to retry `FEplaylist_aggregation` raw when the parsed index has no playlist summaries or fails, and to retry individual playlist pages as raw when the parser exposes no video rows or fails to construct a feed. Existing page caps, WEB retry behavior, and FreeTube's local additive merge remain in place.
- Subscription import and sync orchestration were inspected but not changed in this pass. FreeTube's `FEchannels`/Guide/activity-feed fallbacks and its account-sync gating/store merges remain separate areas to validate if subscription imports still fail.

## Validation performed

- Parsed the two SmartTube history fixtures with the new raw helper: both produced 15 videos; the first IDs were `zSXfrC9AGFs` (`gridVideoRenderer`) and `Cj25UpcBDt0` (`tileRenderer`). The history fixture's continuation request was replayed through a stub `Actions` object and returned the tile-renderer continuation page.
- Synthetic tests covered `gridPlaylistRenderer`, playlist `lockupViewModel`, playlist continuation, and `playlistVideoListRenderer` in a TV two-column layout.
- Targeted ESLint passed for `local.js` and `youtubeAccountRawFeed.js` (only existing ESLint deprecation notices).
- `pnpm run pack:renderer` passed. Its standard webpack bundle-size warnings remain.
- `git diff --check` passed.

## Limitations / next verification

- No authenticated live YouTube request or real account sync was run. The sandbox cannot establish whether FreeTube's OAuth/session is accepted by YouTube, whether the account's current response uses these fixture shapes, or whether the imported records merge correctly for the user's account.
- Build/lint and fixture tests only validate local code paths and response-shape handling. They are **not** evidence that account imports now work. Next end-to-end check should run a manual account sync in FreeTube and record the returned counts/errors for subscriptions, history, and each playlist category, without logging tokens or cookies.
- If subscriptions still import empty, capture only a redacted response-shape summary (renderer names and counts, no tokens or private data) and compare the `FEchannels`, Guide, and `FEsubscriptions` paths before changing the importer.
