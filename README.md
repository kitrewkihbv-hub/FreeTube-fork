# MacTube — a FreeTube account-enabled preview

MacTube is an experimental fork of [FreeTube](https://github.com/FreeTubeApp/FreeTube): a desktop YouTube player with optional account sign-in, a separate discovery feed, and customizable viewing controls.

### What's in this preview

- **Discover:** use YouTube home recommendations and related videos based on recent watch history. Video titles and IDs may be sent to YouTube to find related suggestions; refresh can still repeat videos if results are limited.
- **Subscriptions:** keep subscribed-channel videos separate from discovery. Use local subscriptions or the signed-in YouTube feed; imports can be partial. If an account-feed refresh adds no videos, another part of the returned feed is shown first, with an option to restore YouTube’s order.
- **Signed-in playback:** MacTube tries the saved TV account for playback using a video-specific proof token and the challenge’s visitor context, with signed-out fallback if it fails. When Remember Watch History is enabled, it may report signed-in playback and progress to YouTube; existing local history is not bulk-uploaded. YouTube can still reject requests.
- **Live video:** watch available live streams and use the existing live-chat viewer. The separate Live discovery tab has been removed.
- **Make it yours:** choose app colors with the palette, switch light/dark themes, select a startup tab, and adjust video width and height independently.
- **Optional YouTube sign-in:** import supported account data and access account features. Google can see authenticated requests; account imports and synchronization depend on YouTube and may be incomplete.

[Download the latest MacTube builds](https://github.com/kitrewkihbv-hub/FreeTube-with-account-/releases) · [Report a MacTube issue](https://github.com/kitrewkihbv-hub/FreeTube-with-account-/issues)

> **Preview and security note:** MacTube is an unofficial fork, not an official FreeTube release. macOS builds are ad-hoc signed and not notarized by Apple, so Gatekeeper may warn. Virus scans and tests cannot guarantee safety. Account tokens are encrypted using your system's secure storage when available; otherwise the current app can save them unencrypted. The app uses the existing FreeTube data directory, so back up your library before upgrading or using both apps.

---

## About the upstream FreeTube project

The information below describes upstream FreeTube. Its screenshots and download links are for FreeTube, not this MacTube fork.

<p align="center">
 <img alt="" src="/_icons/logoColor.svg" width=500 align="center">
</p>

FreeTube is an open source desktop YouTube player built with privacy in mind.
Use YouTube without advertisements and prevent Google from tracking you with their cookies and JavaScript.
Available for Windows (10 and later), Mac (macOS 13 and later) & Linux thanks to Electron.

<p align="center"><a href="https://github.com/FreeTubeApp/FreeTube/releases">Download FreeTube</a></p>
<p align="center">
  <a href="https://github.com/FreeTubeApp/FreeTube/actions/workflows/build.yml">
    <img alt='Build status' src="https://github.com/FreeTubeApp/FreeTube/actions/workflows/build.yml/badge.svg?branch=development" />
  </a>
  <a href="https://hosted.weblate.org/engage/free-tube/">
    <img src="https://hosted.weblate.org/widgets/free-tube/-/svg-badge.svg" alt="Translation status" />
  </a>
</p>

<hr>
<p align="center"><a href="#screenshots">Screenshots</a> &bull; <a href="#how-does-it-work">How does it work?</a> &bull; <a href="#features">Features</a> &bull; <a href="#download-links">Download Links</a> &bull; <a href="#contributing">Contributing</a> &bull; <a href="#localization">Localization</a> &bull; <a href="#contact">Contact</a> &bull; <a href="#donate">Donate</a> &bull; <a href="#license">License</a></p>
<p align="center"><a href="https://freetubeapp.io/">Website</a> &bull; <a href="https://docs.freetubeapp.io/">Documentation</a> &bull; <a href="https://docs.freetubeapp.io/faq/">FAQ</a> &bull; <a href="https://github.com/FreeTubeApp/FreeTube/discussions">Discussions</a></p>
<hr>

> [!NOTE] 
> FreeTube is currently in Beta. While it should work well for most users, there are still bugs and missing features that need to be addressed.
>
> If you have an idea or if you found a bug, please submit a [GitHub issue](https://github.com/FreeTubeApp/FreeTube/issues/new/choose) so that we can track it.  Please [search the existing issues](https://github.com/FreeTubeApp/FreeTube/issues?q=is%3Aissue+sort%3Arelevance-desc) before submitting to prevent duplicates!

## Screenshots
| The main FreeTube window                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube1.png)|

| Watching a video                                                                                 |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube2.png)|

| Settings                                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube3.png)|

## How does it work?
FreeTube uses a built in extractor to grab and serve data / videos. The [Invidious API](https://github.com/iv-org/invidious) can also optionally be used. FreeTube does not use any official APIs to obtain data. While YouTube can still see your video requests, it can no
longer track you using cookies or JavaScript. Local subscriptions, playlists and history are stored on your computer. The MacTube account features can also exchange data with YouTube; see the signed-in playback note above.

> [!IMPORTANT]  
> Using a VPN or Tor is highly recommended to hide your IP while using FreeTube.

## Features
* Watch videos without ads
* Use YouTube without Google tracking you using cookies and JavaScript
* Two extractor APIs to choose from (Built in or Invidious)
* Subscribe to channels without an account, or optionally sign in with your Google / YouTube account (desktop app)
* Connect to an externally setup proxy such as Tor
* View and search your local subscriptions, playlists and history
* Organize your subscriptions into "Profiles" to create a more focused feed
* Export & import subscriptions
* YouTube Trending
* YouTube Chapters
* Most popular videos page based on the set Invidious instance
* SponsorBlock
* DeArrow
* Open videos from your browser directly into FreeTube (with extension)
* Watch videos using an external player
* Full Theme support
* Make a screenshot of a video
* Multiple windows
* Mini Player (Picture-in-Picture)
* Keyboard shortcuts
* Option to show only family friendly content
* Show/hide functionality or elements within the app using the distraction free settings
* View channel posts

### Browser Extensions
The following extensions open YouTube links directly in FreeTube:

- [LibRedirect](https://libredirect.manerakai.com/)
- [RedirectTube](https://github.com/MStankiewiczOfficial/RedirectTube)

LibRedirect automatically redirect YouTube links to FreeTube.
> [!IMPORTANT]
> To ensure proper functionality, select FreeTube as Frontend in the Services settings of the extension.

RedirectTube, doesn’t automatically open YouTube links in FreeTube (although this feature can be enabled in the settings). Instead, it adds buttons to the toolbar and context menu, which you can click to open videos in FreeTube manually.

- Download LibRedirect from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/libredirect/) (for Firefox based-browsers) or [developer's website](https://libredirect.manerakai.com/download_chromium.html) (for Chrome and Chromium-based browsers).

- Download RedirectTube from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/redirecttube/) (for Firefox based-browsers) or [Chrome Web Store](https://chromewebstore.google.com/detail/redirecttube/jpbaggklodpddjcadlebabhiopjkjfjh) (for Chrome and Chromium-based browsers).

> [!NOTE]
> These extensions do not work on Linux portable builds!
>
> If you have issues with the extension working with FreeTube, please create an issue in this repository instead of the extension repository.

## Download Links
### Official Downloads

> [!CAUTION]
> FreeTube is only supported on Windows 10 and later, macOS 13 and above, and various Linux distributions. Installing it on unsupported systems may result in unexpected issues.

* [GitHub Releases](https://github.com/FreeTubeApp/FreeTube/releases)

* [FreeTube Website](https://freetubeapp.io/#download)

* Flatpak on Flathub: [Download](https://flathub.org/apps/details/io.freetubeapp.FreeTube) and [Source Code](https://github.com/flathub/io.freetubeapp.FreeTube)

#### Automated Builds (Nightly / Weekly)
> [!WARNING]
> Use these builds at your own risk. These are pre-release versions and are only intended for people that want to test changes early and are willing to accept that things could break from one build to another. 

Builds are automatically created from changes to our development branch via [GitHub Actions](https://github.com/FreeTubeApp/FreeTube/actions?query=workflow%3ABuild).

The first build with a green check mark is the latest build.  

> [!IMPORTANT]
> You will need to have a GitHub account to download these builds.

### Projects maintained by individual FreeTube team members
* Homebrew FreeTube (Apple Silicon only): [Install](https://github.com/PikachuEXE/homebrew-FreeTube)

* FreeTubeAndroid (FreeTube port for Android and PWA): [Download](https://github.com/MarmadileManteater/FreeTubeAndroid/releases) and [Source Code](https://github.com/MarmadileManteater/FreeTubeAndroid)

> [!IMPORTANT]
> These projects are related to FreeTube and are maintained by individual members of the FreeTube team. While they are not part of the main FreeTube project, they may be useful to FreeTube users. There may be issues when using these projects compared to the official builds. Any issues specific to these builds should be reported to their respective maintainers. Make sure you always try an [official download](https://github.com/freetubeapp/freetube/#official-downloads) before reporting your issue to us!

## Contributing
Thank you very much to the [People and Projects](https://docs.freetubeapp.io/credits/) that make FreeTube possible!

If you like to get your hands dirty and want to contribute, we would love to
have your help.  Send a pull request and someone will review your code. 

> [!IMPORTANT]
> Please follow the [Contribution Guidelines](https://github.com/FreeTubeApp/FreeTube/blob/development/CONTRIBUTING.md) before sending your pull request.

## Localization
<a href="https://hosted.weblate.org/engage/free-tube/">
<img src="https://hosted.weblate.org/widgets/free-tube/-/287x66-grey.png" alt="Translation status" />
</a>

We are actively looking for translations!  We use [Weblate](https://hosted.weblate.org/engage/free-tube/) to make it easy for translators to get involved.  Click on the badge above to learn how to get involved.

For the Linux Flatpak, the desktop entry comment string can be translated at our [Flatpak repository](https://github.com/flathub/io.freetubeapp.FreeTube/blob/master/io.freetubeapp.FreeTube.desktop).

## Contact
If you ever have any questions, feel free to ask it on our [Discussions](https://github.com/FreeTubeApp/FreeTube/discussions) page.  Alternatively, you can join our [Matrix Space](https://matrix.to/#/#freetubeapp:matrix.org).  

> [!IMPORTANT]
> Don't forget to check out the [rules](https://docs.freetubeapp.io/community/matrix/) before joining.

## Donate
If you enjoy using FreeTube, you're welcome to leave a donation using the following method.  

* Bitcoin Address: `1Lih7Ho5gnxb1CwPD4o59ss78pwo2T91eS`

While your donations are much appreciated, only donate if you really want to.  Donations are used for keeping the website up and running and eventual code signing costs. 

> [!TIP]
> If you are using the Invidious API then we recommend that you donate to the instance that you use. You can also donate to the [Invidious team](https://invidious.io/donate/) or the [Local API developer](https://github.com/sponsors/LuanRT).

## License
[![GNU AGPLv3 Image](https://www.gnu.org/graphics/agplv3-155x51.png)](https://www.gnu.org/licenses/agpl-3.0.html)  

FreeTube is Free Software: You can use, study share and improve it at your
will. Specifically you can redistribute and/or modify it under the terms of the
[GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.  

### Music and the local desktop-widget API

Music in the sidebar opens a separate, dark music-themed experience with YouTube Music song and music-video search and your playlists. Search results depend on YouTube Music availability and are not guaranteed personalized or available for every query. Songs opened through this section use the music-focused player; the existing player remains visible for captions and its full controls. Captions are the video's available captions, not a guaranteed lyrics service. Previous and shuffle work when playing a playlist; next uses the playlist or the existing next recommendation. Outside those situations the corresponding control does nothing. Artist is the YouTube channel name, not necessarily verified song-artist metadata.

The Electron app starts an HTTP interface on **127.0.0.1:8765** (IPv4 loopback only) only while at least one app window is in Music or a music-mode playlist or player. It stops when the last window leaves Music. Ordinary videos never appear in or receive commands from this interface. `GET /status` returns `{"title":"","artist":"","playing":false,"shuffle":false}` when no track is loaded. `GET /prev`, `/next`, `/toggle`, and `/shuffle` dispatch the same actions as the in-app controls and return `{"ok":true}`; this acknowledges dispatch, not that playback, a next item, or a playlist exists. Responses are not cached. If the port is occupied, the app logs an error and continues without this interface. If more than one window has a player, it targets a playing window first, then the most recently updated loaded player.

**Privacy/security:** this interface has no password and allows all web origins as requested. Any local program, and potentially a website open in a browser that permits local-network requests, can read the title/channel and control playback. It exposes no account credentials but is not restricted to your widget. Do not use Music if that access is unacceptable; leaving Music in every MacTube window stops the interface. The API binds only to loopback, not your LAN. DNS-rebinding hostnames are rejected; use `http://127.0.0.1:8765` or `http://localhost:8765`. Browser local-network protections can still block access, depending on the widget and browser.

### Übersicht title file (macOS)

While a MacTube window is open, MacTube writes `/tmp/mactube_np.txt` for local widgets. It contains either `IDLE|MACTUBE|STANDBY|` or `PLAYING|<window title>|MACTUBE|<thumbnail URL>`. On a video watch route, the thumbnail uses YouTube's `i.ytimg.com/vi/<video ID>/mqdefault.jpg`; otherwise the fourth field is empty. Opening the thumbnail sends a request to YouTube's image service. Pipes and line breaks in the title are replaced with spaces. The file is updated atomically with user-only permissions and is removed on window closure or quit when possible. With multiple windows, it follows the app's current main window. File errors are logged and do not stop MacTube.

This is **window-title information**, not playback detection: for example, a paused video or the Subscriptions page can still be labelled `PLAYING`. Page and search titles can be written even outside Music; local programs running as the same user can read them. The separately documented HTTP control API remains Music-only.
