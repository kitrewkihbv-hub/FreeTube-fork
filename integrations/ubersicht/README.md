# MacTube Dynamic Island widget

This is an adaptation of the supplied `dynamic-island-2.jsx`. It keeps the original widget's appearance and its Spotify, Apple Music and browser YouTube integration, and adds separate local MacTube Music and Video sources. It is not an official Spotify or YouTube API client. The original widget's existing macOS permissions and other functionality are unchanged.

## Installation

1. Install a MacTube build that includes the opt-in widget bridge. **The original build 30 does not have it.** This source change alone does not update an installed application.
2. In Übersicht, open the widgets folder. Back up your existing widget, then replace its JSX file with the accompanying `dynamic-island-2.jsx` (do not leave both copies active). Refresh widgets or restart Übersicht.
3. In MacTube General Settings, turn on **Enable local playback widget bridge**. Start a song in Music mode or play a normal video. The widget should show its title and artwork, and send play, pause, previous, next and seek to the selected source.
4. For a basic check on your Mac, run `curl -i http://127.0.0.1:8766/v1/me/player` during Music playback or `curl -i http://127.0.0.1:8766/youtube/player` during video playback. A loaded player should return JSON; the other mode returns 204. If the bridge is disabled or no player is loaded, the server is normally stopped and curl will not connect.

A currently playing source takes priority over paused ones. Previous restarts a track after four seconds, otherwise goes to the previous playlist item or browser history; next depends on available playlist items or recommendations. Seek requires a known duration. Real Spotify and browser YouTube still use their original code paths. No live Mac/Übersicht integration test has been performed.

## Privacy and limitations

The new listener is local-only and off by default, and rejects browser-origin requests. It has **no authentication**: while enabled, any local program can read current playback details and send controls. Another application occupying port 8766 could prevent startup or impersonate the bridge. Don't send Spotify or Google credentials to it. These endpoints imitate only a small playback subset, not account access or OAuth; an unmodified Spotify or YouTube widget will not automatically recognize them. The older Music-only API on port 8765 remains separate and retains its pre-existing browser-accessible behavior. Artwork URLs load from YouTube.

For endpoint details see `notes/mactube-security-and-validation.md` in the repository.
