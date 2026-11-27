// dynamic-island.jsx — iPhone-style Dynamic Island for Übersicht (v3)
import { run } from 'uebersicht';

/* ───────────────────────── CONFIG ───────────────────────── */
const CONFIG = {
  top: 8,            // px from top of screen. Use ~38 if your menu bar is always visible
  scale: 1,          // 1 = iPhone size. Try 1.15 for a bigger island
  hideDelay: 1000,   // ms after the mouse leaves before it hides
  popOnEvents: true, // pop up on charging / volume / bluetooth / track change
  hotWidth: 380,     // width of the invisible hover strip at the top
  clockShortcut: 'Island Timer', // Shortcut that starts a Clock-app timer. '' = island-only timer
};

export const refreshFrequency = 1000;
export const className = `top:0;left:0;width:100%;height:100%;pointer-events:none;`;

/* ───────────────────────── YOUTUBE (browser) ─────────────────────────
   Runs JavaScript inside YouTube tabs via AppleScript.
   NOTE: no double quotes or backslashes in these JS strings (they live inside an AppleScript string). */
const BROWSERS = ['Safari', 'Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge'];

const YT_POLL_JS = "(function(){var v=document.querySelector('video');if(!v)return '';var md=navigator.mediaSession&&navigator.mediaSession.metadata;var t=(md&&md.title)||document.title.replace(' - YouTube','');var a=(md&&md.artist)||'';var art='';try{if(md&&md.artwork&&md.artwork.length){art=md.artwork[md.artwork.length-1].src}}catch(e){}return [v.paused?'paused':'playing',t,a,'',v.currentTime,isFinite(v.duration)?v.duration:0,art,location.href].join('|||')})()";

const YT_CTL = {
  playpause: "var v=document.querySelector('video');if(v){if(v.paused){v.play()}else{v.pause()}}",
  next: "var b=document.querySelector('.ytp-next-button,.next-button');if(b){b.click()}",
  prev: "var v=document.querySelector('video');var b=document.querySelector('.ytp-prev-button,.previous-button');if(b&&b.offsetParent&&v&&v.currentTime<3){b.click()}else if(v){v.currentTime=0}",
  seek: (p) => "var v=document.querySelector('video');if(v){v.currentTime=" + Number(p).toFixed(2) + "}",
};

const ytPollScript = (b) => {
  const call = b === 'Safari'
    ? 'do JavaScript js in tab ti of window wi'
    : 'execute tab ti of window wi javascript js';
  return [
    `if pgrep -xq "${b}"; then osascript 2>/dev/null <<'EOF'`,
    `set js to "${YT_POLL_JS}"`,
    `set best to ""`,
    `tell application "${b}"`,
    `  repeat with wi from 1 to count of windows`,
    `    try`,
    `      set urls to URL of every tab of window wi`,
    `      repeat with ti from 1 to count of urls`,
    `        set u to item ti of urls`,
    `        if u contains "://youtube.com/" or u contains "://www.youtube.com/" or u contains "://music.youtube.com/" then`,
    `          try`,
    `            set r to ${call}`,
    `            if r is not missing value and r is not "" then`,
    `              if r starts with "playing" then return r & "|||${b}"`,
    `              if best is "" or best starts with "NOJS" then set best to r & "|||${b}"`,
    `            end if`,
    `          on error`,
    `            if best is "" then set best to "NOJS|||${b}"`,
    `          end try`,
    `        end if`,
    `      end repeat`,
    `    end try`,
    `  end repeat`,
    `end tell`,
    `return best`,
    `EOF`,
    `fi`,
  ].join('\n');
};

/* ───────────────────────── DATA COMMAND ───────────────────────── */
export const command = `
echo "###DI-BATT"; pmset -g batt 2>/dev/null
echo "###DI-VOL"; osascript -e 'set v to get volume settings' -e 'return ((output volume of v) as string) & "," & ((output muted of v) as string)' 2>/dev/null
echo "###DI-SPOT"
if pgrep -xq Spotify; then osascript 2>/dev/null <<'EOF'
tell application "Spotify"
  try
    set st to (player state as string)
    if st is "stopped" then return ""
    set t to current track
    return st & "|||" & (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (player position as string) & "|||" & ((duration of t) as string) & "|||" & (artwork url of t) & "|||" & (id of t)
  on error
    return ""
  end try
end tell
EOF
fi
echo "###DI-MUSIC"
if pgrep -xq Music; then osascript 2>/dev/null <<'EOF'
tell application "Music"
  try
    set st to (player state as string)
    if st is "stopped" then return ""
    set t to current track
    set tid to ""
    try
      set tid to ((database ID of t) as string)
    end try
    return st & "|||" & (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (player position as string) & "|||" & ((duration of t) as string) & "|||" & "" & "|||" & tid
  on error
    return ""
  end try
end tell
EOF
fi
echo "###DI-YT"
${BROWSERS.map(ytPollScript).join('\n')}
echo "###DI-MACTUBE_VIDEO"
curl --silent --fail --max-time 1 --noproxy '*' 'http://127.0.0.1:8766/youtube/player' 2>/dev/null | base64 | tr -d '\\n'
echo
echo "###DI-MACTUBE_MUSIC"
curl --silent --fail --max-time 1 --noproxy '*' 'http://127.0.0.1:8766/v1/me/player/currently-playing' 2>/dev/null | base64 | tr -d '\\n'
echo
`;
/* ───────────────────────── TIMER PERSISTENCE ───────────────────────── */
const TKEY = 'di.timer.v3';
const saveTimer = (t) => {
  try {
    if (t) localStorage.setItem(TKEY, JSON.stringify(t));
    else localStorage.removeItem(TKEY);
  } catch (e) {}
};
const loadTimer = () => {
  try {
    const t = JSON.parse(localStorage.getItem(TKEY));
    if (!t || !t.total || !(t.total > 0)) return null;
    if (!t.paused && Date.now() > t.end + 60000) { localStorage.removeItem(TKEY); return null; }
    return t;
  } catch (e) { return null; }
};

/* ───────────────────────── SIDE-EFFECT HELPERS ───────────────────────── */
let dispatchRef = null;
let hideT = null;
const send = (e) => { if (dispatchRef) dispatchRef(e); };

// Start a real Clock-app timer through the Shortcuts app
const startClockTimer = (id, secs) => {
  const name = String(CONFIG.clockShortcut || '').replace(/[^\w .\-]/g, '');
  if (!name) return;
  const mins = String(Math.round((secs / 60) * 1000) / 1000);
  run(`printf '%s' '${mins}' > /tmp/di_timer_in.txt && shortcuts run '${name}' -i /tmp/di_timer_in.txt 2>&1`)
    .then((out) => send({ type: 'DI_CLOCK', id, ok: !/error|couldn|not found|unable/i.test(out || '') }))
    .catch(() => send({ type: 'DI_CLOCK', id, ok: false }));
};

const startTimer = (dispatch, secs) => {
  const id = Date.now();
  dispatch({ type: 'DI_TSTART', secs, id });
  startClockTimer(id, secs);
};

// Control the Apple Clock app via UI scripting when pausing, resuming, or canceling
const controlClockApp = (action) => {
  if (!CONFIG.clockShortcut) return;
  const btn = action === 'pause' ? 'Pause' : action === 'resume' ? 'Resume' : 'Cancel';
  const script = [
    `tell application "Clock" to activate`,
    `delay 0.25`,
    `tell application "System Events"`,
    `  tell process "Clock"`,
    `    try`,
    `      click radio button "Timers" of radio group 1 of group 1 of toolbar 1 of window 1`,
    `      delay 0.1`,
    `      click button "${btn}" of group 1 of group 1 of group 1 of group 1 of window 1`,
    `    end try`,
    `  end tell`,
    `end tell`,
  ].join('\n');
  run(`osascript 2>/dev/null <<'EOF'\n${script}\nEOF`).catch(() => {});
};

// Run JS inside the YouTube tab that matches this track
const ytRun = (m, js) => {
  if (!m || !m.browser) return;
  const id = String(m.ytid || 'youtube.com').replace(/[^\w.\-]/g, '');
  const call = m.browser === 'Safari'
    ? 'do JavaScript js in tab ti of window wi'
    : 'execute tab ti of window wi javascript js';
  const script = [
    `set js to "${js}"`,
    `tell application "${m.browser}"`,
    `  repeat with wi from 1 to count of windows`,
    `    try`,
    `      set urls to URL of every tab of window wi`,
    `      repeat with ti from 1 to count of urls`,
    `        if (item ti of urls) contains "${id}" then`,
    `          try`,
    `            ${call}`,
    `          end try`,
    `        end if`,
    `      end repeat`,
    `    end try`,
    `  end repeat`,
    `end tell`,
  ].join('\n');
  run(`osascript 2>/dev/null <<'EOF'\n${script}\nEOF`).catch(() => {});
};

// act: 'playpause' | 'next' | 'prev' | { seek: seconds }
const media = (m, act) => {
  if (!m) return;
  if (m.app === 'youtube') {
    ytRun(m, typeof act === 'object' ? YT_CTL.seek(act.seek) : YT_CTL[act]);
    return;
  }
  if (m.app === 'mactube') {
    const isMusic = m.mode === 'music';
    const command = typeof act === 'object' ? 'seek' : act === 'playpause' ? (m.playing ? 'pause' : 'play') : act;
    const paths = isMusic
      ? { play: 'play', pause: 'pause', next: 'next', prev: 'previous', seek: 'seek' }
      : { play: 'playVideo', pause: 'pauseVideo', next: 'nextVideo', prev: 'previousVideo', seek: 'seekTo' };
    if (!Object.hasOwn(paths, command)) return;
    let path = (isMusic ? '/v1/me/player/' : '/youtube/player/') + paths[command];
    let method = isMusic && ['play', 'pause', 'seek'].includes(command) ? 'PUT' : 'POST';
    if (command === 'seek') {
      const seconds = Number(act.seek);
      if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(m.dur) || seconds > m.dur) return;
      path += isMusic ? '?position_ms=' + Math.round(seconds * 1000) : '?seconds=' + seconds.toFixed(2);
    }
    run(`curl --silent --fail --max-time 2 --noproxy '*' -X ${method} 'http://127.0.0.1:8766${path}'`).catch(() => {});
    return;
  }
  const app = m.app === 'spotify' ? 'Spotify' : 'Music';
  const cmd = typeof act === 'object'
    ? `set player position to ${act.seek.toFixed(2)}`
    : { playpause: 'playpause', next: 'next track', prev: 'previous track' }[act];
  run(`osascript -e 'tell application "${app}" to ${cmd}'`).catch(() => {});
};

const fetchMusicArt = (key) => {
  const cmd = `rm -f /tmp/di_art
osascript 2>/dev/null <<'EOF'
tell application "Music"
  try
    set d to raw data of artwork 1 of current track
    set f to open for access POSIX file "/tmp/di_art" with write permission
    set eof f to 0
    write d to f
    close access f
  end try
end tell
EOF
[ -s /tmp/di_art ] && base64 < /tmp/di_art | tr -d '\\n'`;
  run(cmd).then((out) => {
    const b = (out || '').trim();
    if (b) send({ type: 'DI_ART', key, src: 'data:image/jpeg;base64,' + b });
  }).catch(() => {});
};

// Download remote art through curl so the canvas isn't CORS-tainted (needed for color extraction)
const fetchRemoteArt = (key, url) => {
  const safe = String(url).replace(/'/g, '%27');
  run(`curl -sL --max-time 10 '${safe}' | base64 | tr -d '\\n'`).then((out) => {
    const b = (out || '').trim();
    if (b.length > 200) send({ type: 'DI_ART', key, src: 'data:image/jpeg;base64,' + b });
  }).catch(() => {});
};

const extractColor = (src, key) => {
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 8;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 8, 8);
        const d = x.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = (mx - mn) / (mx || 1);
          const wt = 0.05 + sat * sat * 3;
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        r /= w; g /= w; b /= w;
        const mx = Math.max(r, g, b) || 1;
        const k = Math.max(1, 190 / mx);
        send({ type: 'DI_COLOR', key, color: `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})` });
      } catch (e) {}
    };
    img.src = src;
  } catch (e) {}
};
if (typeof window !== 'undefined') {
  if (window.__diTick) clearInterval(window.__diTick);
  window.__diTick = setInterval(() => send({ type: 'DI_TICK', now: Date.now() }), 100);

  const pollBT = () =>
    run('system_profiler SPBluetoothDataType -json 2>/dev/null')
      .then((out) => send({ type: 'DI_BT', out }))
      .catch(() => {});
  if (window.__diBT) clearInterval(window.__diBT);
  window.__diBT = setInterval(pollBT, 10000);
  setTimeout(pollBT, 1500);
}

/* ───────────────────────── STATE ───────────────────────── */
export const initialState = {
  now: Date.now(),
  hover: false,
  expanded: false,
  page: 'music',
  battery: { pct: null, ac: null, charging: false, full: false },
  lowShown: false,
  volume: null,
  muted: false,
  music: null,
  ytNoJs: false,
  art: { key: null, src: null, color: null },
  bt: { init: false, names: [] },
  btInfo: null,
  timer: loadTimer(),
  clockErr: false,
  transient: null,
};

const setT = (s, t) => {
  if (s.transient && s.transient.kind === 'timerdone' && s.transient.until > Date.now()) return;
  s.transient = t;
};

const sections = (out) => {
  const o = {};
  out.split('###DI-').forEach((p) => {
    const i = p.indexOf('\n');
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
};

const parseTrack = (line, app) => {
  if (!line) return null;
  const p = line.split('|||');
  if (p.length < 7) return null;
  const num = (x) => parseFloat(String(x).replace(',', '.')) || 0;
  let dur = num(p.at(5));
  if (app === 'spotify') dur /= 1000;
  const t = {
    app, playing: p.at(0) === 'playing', title: p.at(1), artist: p.at(2), album: p.at(3),
    pos: num(p.at(4)), dur, artUrl: p.at(6), id: p.at(7) || '',
  };
  if (app === 'youtube') {
    const href = p.at(7) || '';
    const mm = href.match(/[?&]v=([\w-]+)/) || href.match(/shorts\/([\w-]+)/);
    t.ytid = mm ? mm.at(1) : 'youtube.com';
    t.id = t.ytid;
    t.browser = (p.at(8) || '').trim();
    const isMusic = /music\.youtube\.com/.test(href);
    // regular YouTube thumbnails: mqdefault has no black letterbox bars
    if (!isMusic && mm) t.artUrl = 'https://i.ytimg.com/vi/' + mm.at(1) + '/mqdefault.jpg';
    t.title = t.title || 'YouTube';
  }
  t.key = app + '|' + t.id + '|' + t.title + '|' + t.artist;
  return t;
};

// MacTube is an opt-in local bridge, not Spotify or YouTube OAuth.
const parseMacTube = (encoded) => {
  if (!encoded) return null;
  try {
    const json = decodeURIComponent(Array.from(atob(encoded.trim()), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    const data = JSON.parse(json);
    const isVideo = data.videoData && typeof data.playerState === 'number';
    const id = isVideo ? data.videoData.video_id : data.item && data.item.id;
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    const t = isVideo
      ? { mode: 'video', playing: data.playerState === 1, title: data.videoData.title, artist: data.videoData.author,
          pos: Number(data.currentTime) || 0, dur: Number(data.duration) || 0, artUrl: data.thumbnailUrl }
      : { mode: 'music', playing: data.is_playing === true, title: data.item.name, artist: data.item.artists?.[0]?.name || '',
          pos: (Number(data.progress_ms) || 0) / 1000, dur: (Number(data.item.duration_ms) || 0) / 1000, artUrl: data.item.album?.images?.[0]?.url || '' };
    if (typeof t.title !== 'string' || !t.title) return null;
    t.artist = typeof t.artist === 'string' ? t.artist : '';
    t.pos = Number.isFinite(t.pos) ? Math.max(0, Math.min(604800, t.pos)) : 0;
    t.dur = Number.isFinite(t.dur) ? Math.max(0, Math.min(604800, t.dur)) : 0;
    t.artUrl = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
    t.app = 'mactube'; t.id = id; t.album = ''; t.key = 'mactube|' + t.mode + '|' + id + '|' + t.title;
    return t;
  } catch (e) { return null; }
};

const ingest = (prev, out) => {
  const now = Date.now();
  const s = { ...prev };
  const sec = sections(out);

  // Battery
  if (sec.BATT) {
    const b = sec.BATT;
    const ac = /AC Power/.test(b);
    const pm = b.match(/(\d+)%/);
    const pct = pm ? parseInt(pm.at(1), 10) : null;
    const charging = /;\s*(charging|finishing charge)/.test(b);
    const full = /;\s*charged/.test(b);
    s.battery = { pct, ac, charging, full };
    if (pct !== null) {
      if (prev.battery.ac === false && ac) setT(s, { kind: 'charging', until: now + 3800 });
      if (!ac && pct <= 20 && !prev.lowShown) { setT(s, { kind: 'low', until: now + 6000 }); s.lowShown = true; }
      if ((ac || pct > 25) && prev.lowShown) s.lowShown = false;
    }
  }

  // Volume
  if (sec.VOL) {
    const [a, m] = sec.VOL.split(',');
    const vol = parseFloat(a);
    const muted = m === 'true';
    if (!isNaN(vol)) {
      if (prev.volume !== null && (vol !== prev.volume || muted !== prev.muted)) {
        setT(s, { kind: 'volume', until: now + 1900 });
      }
      s.volume = vol;
      s.muted = muted;
    }
  }

  // YouTube (several browsers may each return a line)
  const ytLines = (sec.YT || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const ytOK = ytLines.filter((l) => !l.startsWith('NOJS'));
  const ytLine = ytOK.find((l) => l.startsWith('playing')) || ytOK.at(0) || '';
  s.ytNoJs = !ytLine && ytLines.some((l) => l.startsWith('NOJS'));

  // Music sources
  const cand = [
    parseMacTube(sec.MACTUBE_VIDEO),
    parseMacTube(sec.MACTUBE_MUSIC),
    parseTrack(sec.SPOT, 'spotify'),
    parseTrack(sec.MUSIC, 'music'),
    parseTrack(ytLine, 'youtube'),
  ].filter(Boolean);
  const m = cand.find((x) => x.playing) || cand.at(0) || null;
  if (m) {
    m.at = now;
    const pm = prev.music;
    if (pm && pm.key === m.key && pm.hold > now) { m.playing = pm.playing; m.hold = pm.hold; }
    if (!pm || pm.key !== m.key) {
      if (m.playing) setT(s, { kind: 'track', until: now + 3200 });
      s.art = { key: m.key, src: m.app === 'music' ? null : m.artUrl || null, color: null };
      if (m.app === 'music') fetchMusicArt(m.key);
      else if (m.artUrl) fetchRemoteArt(m.key, m.artUrl);
    }
    s.music = m;
  } else {
    s.music = null;
  }
  return s;
};

const ingestBT = (prev, out) => {
  let j;
  try { j = JSON.parse(out); } catch (e) { return prev; }
  const root = (j.SPBluetoothDataType || []).at(0) || {};
  const list = root.device_connected || [];
  const devs = list.map((o) => {
    const name = Object.keys(o).at(0);
    const i = o[name] || {};
    const lv = ['device_batteryLevelMain', 'device_batteryLevelLeft', 'device_batteryLevelRight']
      .map((k) => parseInt(i[k], 10)).filter((x) => !isNaN(x));
    return {
      name,
      level: lv.length ? Math.min(...lv) : null,
      audio: /headphone|headset|speaker|airpods|beats/i.test((i.device_minorType || '') + name),
    };
  });
  const names = devs.map((d) => d.name);
  const s = { ...prev, bt: { init: true, names } };
  if (prev.bt.init) {
    const nw = devs.find((d) => !prev.bt.names.includes(d.name));
    if (nw) { s.btInfo = nw; setT(s, { kind: 'bt', until: Date.now() + 4500 }); }
  }
  return s;
};
// Called from the 100ms tick AND from every data refresh, so a throttled widget still finishes timers on time
const tick = (prev, now) => {
  const s = { ...prev, now };
  if (s.transient && now > s.transient.until) s.transient = null;
  if (s.timer && !s.timer.paused && now >= s.timer.end) {
    const viaClock = !!s.timer.viaClock;
    s.timer = null;
    saveTimer(null);
    s.transient = { kind: 'timerdone', until: now + 60000 };
    if (!viaClock) {
      // The Clock app is handling the alarm when viaClock is true; otherwise the island rings itself
      run('for i in 1 2 3 4; do afplay /System/Library/Sounds/Glass.aiff; done').catch(() => {});
      run(`osascript -e 'display notification "Time is up" with title "Timer" sound name "Glass"'`).catch(() => {});
    }
  }
  return s;
};

export const updateState = (event, prev) => {
  const now = Date.now();
  switch (event.type) {
    case 'DI_TICK': return tick(prev, now);
    case 'DI_HOVER': return { ...prev, hover: event.value, now };
    case 'DI_EXPAND':
      return {
        ...prev,
        now,
        expanded: event.value,
        hover: event.value ? prev.hover : true,
        page: event.value ? 'music' : prev.page,
        transient: event.value && prev.transient && prev.transient.kind === 'timerdone' ? null : prev.transient,
      };
    case 'DI_PAGE': return { ...prev, page: event.value, now };
    case 'DI_ART':
      if (prev.art.key !== event.key) return prev;
      extractColor(event.src, event.key);
      return { ...prev, art: { ...prev.art, src: event.src } };
    case 'DI_COLOR':
      if (prev.art.key !== event.key) return prev;
      return { ...prev, art: { ...prev.art, color: event.color } };
    case 'DI_BT': return ingestBT(prev, event.out);
    case 'DI_PLAY': {
      if (!prev.music) return prev;
      const m = prev.music;
      const pos = Math.min(m.dur, m.pos + (m.playing ? (now - m.at) / 1000 : 0));
      return { ...prev, now, music: { ...m, playing: !m.playing, pos, at: now, hold: now + 1800 } };
    }
    case 'DI_SEEK':
      if (!prev.music) return prev;
      return { ...prev, now, music: { ...prev.music, pos: event.pos, at: now } };
    case 'DI_TSTART': {
      const secs = Math.max(1, Math.round(event.secs));
      const t = { id: event.id || now, total: secs, end: now + secs * 1000, paused: false, remaining: secs, viaClock: false };
      saveTimer(t);
      return { ...prev, now, timer: t, clockErr: false };
    }
    case 'DI_CLOCK': {
      let t = prev.timer;
      if (t && t.id === event.id) { t = { ...t, viaClock: !!event.ok }; saveTimer(t); }
      return { ...prev, timer: t, clockErr: !event.ok };
    }
    case 'DI_TTOGGLE': {
      const t = prev.timer;
      if (!t) return prev;
      if (t.viaClock) controlClockApp(t.paused ? 'resume' : 'pause');
      const nt = t.paused
        ? { ...t, paused: false, end: now + t.remaining * 1000 }
        : { ...t, paused: true, remaining: Math.min(t.total, Math.max(0, (t.end - now) / 1000)) };
      saveTimer(nt);
      return { ...prev, now, timer: nt };
    }
    case 'DI_TCANCEL':
      if (prev.timer && prev.timer.viaClock) controlClockApp('cancel');
      saveTimer(null);
      return { ...prev, now, timer: null };
    case 'DI_TDISMISS':
      run('pkill afplay').catch(() => {});
      return { ...prev, now, transient: null };
    default: break;
  }
  if (typeof event.output !== 'string') return prev;
  return tick(ingest(prev, event.output), now);
};

/* ───────────────────────── SMALL HELPERS ───────────────────────── */
const SIZES = {
  idle: Array.of(126, 37), music: Array.of(226, 37), timer: Array.of(190, 37), charging: Array.of(226, 37), volume: Array.of(250, 37),
  bt: Array.of(364, 86), low: Array.of(344, 78), timerdone: Array.of(344, 78), expanded: Array.of(396, 186),
};
const pad = (n) => (n < 10 ? '0' : '') + n;
const fmt = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + pad(sec % 60); };
const fmtT = (sec) => {
  sec = Math.max(0, Math.ceil(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
};
const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };

const enter = (dispatch) => () => { clearTimeout(hideT); dispatch({ type: 'DI_HOVER', value: true }); };
const leave = (dispatch) => () => {
  clearTimeout(hideT);
  hideT = setTimeout(() => dispatch({ type: 'DI_HOVER', value: false }), CONFIG.hideDelay);
};
const collapse = (dispatch) => {
  dispatch({ type: 'DI_EXPAND', value: false });
  clearTimeout(hideT);
  hideT = setTimeout(() => dispatch({ type: 'DI_HOVER', value: false }), CONFIG.hideDelay);
};

/* ───────────────────────── ICONS ───────────────────────── */
const Svg = (size, kids) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block', flex: 'none' }}>{kids}</svg>
);
const ST = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const FWD = [
  <path key="a" d="M3 5.9v12.2a.9.9 0 0 0 1.4.75l8.6-6.1a.9.9 0 0 0 0-1.5L4.4 5.15A.9.9 0 0 0 3 5.9z" />,
  <path key="b" d="M12 5.9v12.2a.9.9 0 0 0 1.4.75l8.6-6.1a.9.9 0 0 0 0-1.5l-8.6-6.1A.9.9 0 0 0 12 5.9z" />,
];
const IPlay = (z) => Svg(z, <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />);
const IPause = (z) => Svg(z, <g><rect x="6" y="4.5" width="4.2" height="15" rx="1.4" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4" /></g>);
const INext = (z) => Svg(z, <g>{FWD}</g>);
const IPrev = (z) => Svg(z, <g transform="translate(24 0) scale(-1 1)">{FWD}</g>);
const ITimer = (z) => Svg(z, <g {...ST}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4.5l3 1.8" /><path d="M9.5 3h5" /></g>);
const IX = (z) => Svg(z, <path {...ST} d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
const IPhones = (z) => Svg(z, <g><path {...ST} d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" /><rect x="3" y="13" width="4.6" height="7.5" rx="2.2" /><rect x="16.4" y="13" width="4.6" height="7.5" rx="2.2" /></g>);
const IBt = (z) => Svg(z, <path {...ST} d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9" />);
const INote = (z) => Svg(z, <path d="M16 3v11.2a3.2 3.2 0 1 1-2-2.96V6.2l-6 1.4v8.6A3.2 3.2 0 1 1 6 13.3V5.8L16 3z" />);
const ISpeaker = (z, level, muted) => Svg(z, (
  <g>
    <path d="M3 9.5v5h3.6l5.2 4.3V5.2L6.6 9.5z" />
    {muted
      ? <path {...ST} d="M16 9.5l5 5M21 9.5l-5 5" />
      : <g {...ST}>{level > 0 && <path d="M15.4 9.3a4 4 0 0 1 0 5.4" />}{level > 35 && <path d="M18 6.7a7.6 7.6 0 0 1 0 10.6" />}</g>}
  </g>
));
const Batt = (pct, color, bolt) => {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <svg width="30" height="15" viewBox="0 0 30 15" style={{ display: 'block', flex: 'none' }}>
      <rect x=".75" y=".75" width="25" height="13.5" rx="4" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1.5" />
      <rect x="3" y="3" width={Math.max(2, (21 * p) / 100)} height="9" rx="2" fill={color} />
      <path d="M27.5 5v5c1-.3 1.8-1.2 1.8-2.5S28.5 5.3 27.5 5z" fill="rgba(255,255,255,.4)" />
      {bolt && <path d="M14.6 1.6l-4.4 6.3h3l-.7 5.5 4.6-6.6h-3z" fill="#fff" stroke="#000" strokeWidth=".7" strokeLinejoin="round" />}
    </svg>
  );
};
const Ring = (frac, size, sw, color, kids) => {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset .26s linear' }} />
      </svg>
      <div className="di-ringc" style={{ color }}>{kids}</div>
    </div>
  );
};
const Art = (src, size, radius) => (
  <div className="di-art" style={{ width: size, height: size, borderRadius: radius, backgroundImage: src ? `url("${src}")` : undefined }}>
    {!src && INote(size * 0.5)}
  </div>
);
const Wave = (color, playing) => (
  <div className={'di-wave' + (playing ? ' on' : '')} style={{ color }}><i /><i /><i /><i /><i /></div>
);
const Lyr = (name, active, kids) => (
  <div className={'di-layer' + (active ? ' on' : '')} style={{ width: SIZES[name].at(0), height: SIZES[name].at(1) }}>{kids}</div>
);
/* ───────────────────────── RENDER ───────────────────────── */
export const render = (s, dispatch) => {
  dispatchRef = dispatch;
  const S = CONFIG.scale;
  const NOW = Date.now(); // always the real clock, never the (possibly stale) state snapshot
  const tr = s.transient && NOW < s.transient.until ? s.transient : null;

  const persistent = [];
  if (s.timer) persistent.push('timer');
  if (s.music && s.music.playing) persistent.push('music');

  let mode = 'idle', bubble = null;
  if (s.expanded) mode = 'expanded';
  else if (tr) {
    if (tr.kind === 'track') { mode = 'music'; bubble = persistent.find((p) => p !== 'music') || null; }
    else { mode = tr.kind; bubble = persistent.at(0) || null; }
  } else if (persistent.length) { mode = persistent.at(0); bubble = persistent.at(1) || null; }

  const page = s.music ? (s.page === 'home' ? 'home' : 'music') : 'home';
  const visible = s.hover || s.expanded || (CONFIG.popOnEvents && !!tr);
  const w = SIZES[mode].at(0);
  const h = SIZES[mode].at(1);
  const radius = h <= 40 ? h / 2 : mode === 'expanded' ? 46 : 40;
  const hideY = -(CONFIG.top + h + 24);
  const transform = visible ? `scale(${S})` : `translateY(${hideY}px) scale(${S * 0.8})`;

  const m = s.music;
  const artSrc = m && s.art.key === m.key ? s.art.src : null;
  const color = s.art.color || '#ff6a88';

  // Timer: snap to whole seconds so the countdown never skips a number
  const T = s.timer;
  const rem = T ? Math.min(T.total, T.paused ? Math.round(T.remaining) : Math.max(0, Math.round((T.end - NOW) / 1000))) : 0;
  const tfrac = T ? Math.max(0, Math.min(1, rem / T.total)) : 0;

  const pos = m ? Math.min(m.dur || 0, m.pos + (m.playing ? (NOW - m.at) / 1000 : 0)) : 0;
  const pfrac = m && m.dur ? Math.min(1, pos / m.dur) : 0;

  const bat = s.battery;
  const batColor = bat.ac ? '#30d158' : bat.pct !== null && bat.pct <= 20 ? '#ff453a' : '#fff';
  const vol = s.volume || 0;

  const d = new Date(NOW);
  const parts = timeFmt.formatToParts(d);
  const timeMain = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  const period = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
  const dateStr = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const ytHint = s.ytNoJs && !s.music;
  const clockHint = s.clockErr && !!CONFIG.clockShortcut;
  const hint = ytHint ? 'YouTube: allow Apple Events JavaScript'
    : clockHint ? 'Clock shortcut “' + CONFIG.clockShortcut + '” not found' : null;

  const seek = (e) => {
    e.stopPropagation();
    if (!m || !m.dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const p = f * m.dur;
    dispatch({ type: 'DI_SEEK', pos: p });
    media(m, { seek: p });
  };
  const playPause = stop(() => { dispatch({ type: 'DI_PLAY' }); media(m, 'playpause'); });
  const onIsland = () => {
    if (tr && tr.kind === 'timerdone') dispatch({ type: 'DI_TDISMISS' });
    else if (!s.expanded) dispatch({ type: 'DI_EXPAND', value: true });
  };

  const info = s.btInfo;

  return (
    <div>
      <style>{CSS}</style>
      {s.expanded && <div className="di-backdrop" onClick={() => collapse(dispatch)} />}
      <div onMouseEnter={enter(dispatch)} onMouseLeave={leave(dispatch)}>
        <div className="di-hot" style={{ height: CONFIG.top + 14 }} />
        <div className={'di-stack' + (visible ? '' : ' hidden')} style={{ top: CONFIG.top, transform }}>

          {/* ─── main island ─── */}
          <div className={'di-island' + (mode === 'expanded' ? ' exp' : '')}
            style={{ width: w, height: h, borderRadius: radius }} onClick={onIsland}>

            {/* compact: music */}
            {Lyr('music', mode === 'music', (
              <div className="di-row m">{Art(artSrc, 25, 7)}{Wave(color, m && m.playing)}</div>
            ))}

            {/* compact: timer */}
            {Lyr('timer', mode === 'timer', (
              <div className="di-row o">{ITimer(19)}<span className="di-ttime">{fmtT(rem)}</span></div>
            ))}

            {/* compact: charging */}
            {Lyr('charging', mode === 'charging', (
              <div className="di-row g">{Batt(bat.pct, '#30d158', true)}<span className="di-ttime">{bat.pct}%</span></div>
            ))}

            {/* compact: volume */}
            {Lyr('volume', mode === 'volume', (
              <div className="di-row">
                {ISpeaker(20, vol, s.muted || vol === 0)}
                <div className="di-vbar"><i style={{ width: (s.muted ? 0 : vol) + '%' }} /></div>
              </div>
            ))}

            {/* medium: bluetooth */}
            {Lyr('bt', mode === 'bt', (
              <div className="di-mid">
                <div className="di-ico">{info && info.audio ? IPhones(26) : IBt(22)}</div>
                <div className="di-midtxt">
                  <div className="di-t1">{info ? info.name : ''}</div>
                  <div className="di-t2">Connected</div>
                </div>
                {info && info.level != null && (
                  <div className="di-midr"><span>{info.level}%</span>{Batt(info.level, '#30d158', false)}</div>
                )}
              </div>
            ))}

            {/* medium: low battery */}
            {Lyr('low', mode === 'low', (
              <div className="di-mid">
                <div className="di-ico red">{Batt(bat.pct, '#ff453a', false)}</div>
                <div className="di-midtxt">
                  <div className="di-t1">Low Battery</div>
                  <div className="di-t2">{bat.pct}% Battery Remaining</div>
                </div>
              </div>
            ))}

            {/* medium: timer done */}
            {Lyr('timerdone', mode === 'timerdone', (
              <div className="di-mid">
                <div className="di-ico or">{ITimer(26)}</div>
                <div className="di-midtxt">
                  <div className="di-t1">Timer</div>
                  <div className="di-t2">Time’s Up</div>
                </div>
                <button className="di-stopbtn" onClick={stop(() => dispatch({ type: 'DI_TDISMISS' }))}>Stop</button>
              </div>
            ))}
            {/* expanded: music */}
            {Lyr('expanded', mode === 'expanded' && page === 'music', (
              <div className="di-em">
                <div className="di-em-top">
                  {Art(artSrc, 64, 14)}
                  <div className="di-em-txt">
                    <div className="di-t1">{m ? m.title : ''}</div>
                    <div className="di-t2">{m ? (m.artist || m.album) : ''}</div>
                  </div>
                  {Wave(color, m && m.playing)}
                </div>
                <div className="di-prog">
                  <div className="di-bar" onClick={seek}><i style={{ width: pfrac * 100 + '%' }} /></div>
                  <div className="di-times"><span>{fmt(pos)}</span><span>-{fmt(Math.max(0, (m ? m.dur : 0) - pos))}</span></div>
                </div>
                <div className="di-ctl">
                  <button className="di-btn" onClick={stop(() => media(m, 'prev'))}>{IPrev(26)}</button>
                  <button className="di-btn" onClick={playPause}>{m && m.playing ? IPause(32) : IPlay(32)}</button>
                  <button className="di-btn" onClick={stop(() => media(m, 'next'))}>{INext(26)}</button>
                </div>
              </div>
            ))}

            {/* expanded: home (clock, battery, timer) */}
            {Lyr('expanded', mode === 'expanded' && page === 'home', (
              <div className="di-home">
                <div className="di-h-top">
                  <div>
                    <div className="di-clock">{timeMain}<small>{period}</small></div>
                    <div className="di-date" style={hint ? { color: '#ff9f0a', fontSize: 12 } : undefined}>
                      {hint || dateStr}
                    </div>
                  </div>
                  {bat.pct !== null && (
                    <div className="di-hbatt" style={{ color: batColor }}>
                      <span>{bat.pct}%</span>{Batt(bat.pct, batColor === '#fff' ? '#fff' : batColor, bat.charging)}
                    </div>
                  )}
                </div>
                {T ? (
                  <div className="di-h-timer">
                    {Ring(tfrac, 54, 5, '#ff9f0a', ITimer(20))}
                    <div className="di-ttxt">
                      <div className="di-tbig">{fmtT(rem)}</div>
                      <div className="di-tlbl">{T.viaClock ? 'Timer · Clock' : 'Timer'}{T.paused ? ' · Paused' : ''}</div>
                    </div>
                    <button className="di-btn di-round or" onClick={stop(() => dispatch({ type: 'DI_TTOGGLE' }))}>
                      {T.paused ? IPlay(18) : IPause(18)}
                    </button>
                    <button className="di-btn di-round" onClick={stop(() => dispatch({ type: 'DI_TCANCEL' }))}>{IX(18)}</button>
                  </div>
                ) : (
                  <div>
                    <div className="di-cap">Start Timer</div>
                    <div className="di-chips">
                      {Array.of(1, 5, 10, 30).map((mn) => (
                        <button key={mn} className="di-chip" onClick={stop(() => startTimer(dispatch, mn * 60))}>
                          {mn}<small>min</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* pager dots */}
            <div className={'di-pager' + (mode === 'expanded' && s.music ? ' on' : '')}>
              <i className={page === 'music' ? 'a' : ''} onClick={stop(() => dispatch({ type: 'DI_PAGE', value: 'music' }))} />
              <i className={page === 'home' ? 'a' : ''} onClick={stop(() => dispatch({ type: 'DI_PAGE', value: 'home' }))} />
            </div>
          </div>

          {/* ─── split bubble (second activity) ─── */}
          <div className={'di-bubble' + (bubble && mode !== 'expanded' ? ' open' : '')}
            onClick={() => dispatch({ type: 'DI_EXPAND', value: true })}>
            <div className={'di-b' + (bubble === 'music' ? ' on' : '')}>{Art(artSrc, 29, '50%')}</div>
            <div className={'di-b' + (bubble === 'timer' ? ' on' : '')}>{Ring(tfrac, 31, 3, '#ff9f0a', ITimer(14))}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
/* ───────────────────────── STYLES ───────────────────────── */
const SPRING = 'cubic-bezier(.3,1.3,.45,1)';
const CSS = `
.di-hot{position:fixed;top:0;left:50%;width:${CONFIG.hotWidth}px;margin-left:-${CONFIG.hotWidth / 2}px;pointer-events:auto}
.di-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:auto}
.di-stack{position:fixed;left:0;width:100%;display:flex;justify-content:center;align-items:flex-start;
  transform-origin:50% 0;pointer-events:none;will-change:transform;color:#fff;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;
  transition:transform .62s cubic-bezier(.3,1.25,.4,1),opacity .3s ease}
.di-stack.hidden{opacity:0;transition:transform .42s cubic-bezier(.5,0,.8,.35),opacity .28s ease .1s}
.di-stack.hidden *{pointer-events:none !important}
.di-stack.hidden .di-wave i{animation-play-state:paused}

.di-island{position:relative;flex:none;background:#000;overflow:hidden;pointer-events:auto;cursor:default;
  box-shadow:0 0 0 .5px rgba(255,255,255,.07),0 6px 18px rgba(0,0,0,.28);
  transition:width .62s ${SPRING},height .62s cubic-bezier(.34,1.18,.5,1),border-radius .62s cubic-bezier(.3,1.2,.5,1),
    box-shadow .4s ease,transform .25s cubic-bezier(.3,1.4,.5,1)}
.di-island.exp{box-shadow:0 0 0 .5px rgba(255,255,255,.1),0 24px 60px rgba(0,0,0,.55)}
.di-island:not(.exp):active{transform:scale(.95)}

.di-layer{position:absolute;left:50%;top:50%;box-sizing:border-box;opacity:0;filter:blur(12px);
  transform:translate(-50%,-50%) scale(.86);pointer-events:none;
  transition:opacity .16s ease,filter .2s ease,transform .3s ease}
.di-layer.on{opacity:1;filter:blur(0);transform:translate(-50%,-50%) scale(1);pointer-events:auto;
  transition:opacity .3s ease .1s,filter .35s ease .08s,transform .5s cubic-bezier(.3,1.3,.5,1) .06s}

.di-row{display:flex;align-items:center;justify-content:space-between;width:100%;height:100%;box-sizing:border-box;padding:0 15px}
.di-row.m{padding:0 15px 0 6px}
.di-row.g{color:#30d158}.di-row.o{color:#ff9f0a}
.di-ttime{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}

.di-art{flex:none;background:linear-gradient(135deg,#ff6a88,#6a5cff);background-size:cover;background-position:center;
  display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.85)}
.di-wave{display:flex;align-items:center;gap:2.5px;height:18px;flex:none}
.di-wave i{display:block;width:3px;height:100%;border-radius:2px;background:currentColor;transform:scaleY(.22);transition:transform .35s ease,background-color .6s}
.di-wave.on i{animation:diwave 1s ease-in-out infinite}
.di-wave i:nth-child(1){animation-duration:.82s;animation-delay:-.1s}
.di-wave i:nth-child(2){animation-duration:1.05s;animation-delay:-.5s}
.di-wave i:nth-child(3){animation-duration:.7s;animation-delay:-.3s}
.di-wave i:nth-child(4){animation-duration:.95s;animation-delay:-.7s}
.di-wave i:nth-child(5){animation-duration:.88s;animation-delay:-.2s}
@keyframes diwave{0%,100%{transform:scaleY(.22)}50%{transform:scaleY(1)}}

.di-vbar{width:110px;height:6px;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden}
.di-vbar i{display:block;height:100%;background:#fff;border-radius:3px;transition:width .2s ease}

.di-mid{display:flex;align-items:center;gap:14px;width:100%;height:100%;box-sizing:border-box;padding:0 22px}
.di-midtxt{flex:1;min-width:0}
.di-midr{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}
.di-ico{width:48px;height:48px;border-radius:50%;background:#1c1c1e;display:flex;align-items:center;justify-content:center;flex:none}
.di-ico.red{background:rgba(255,69,58,.16)}
.di-ico.or{color:#ff9f0a;background:rgba(255,159,10,.18)}
.di-t1{font-size:17px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.di-t2{font-size:14px;font-weight:500;line-height:1.3;color:rgba(255,255,255,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.di-stopbtn{border:0;background:#ff453a;color:#fff;font:600 15px -apple-system,system-ui,sans-serif;padding:10px 20px;border-radius:20px;cursor:pointer;outline:none;transition:transform .15s}
.di-stopbtn:active{transform:scale(.92)}

.di-btn{background:none;border:0;color:#fff;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;outline:none;
  transition:transform .18s cubic-bezier(.3,1.5,.5,1),opacity .15s,background-color .2s}
.di-btn:hover{opacity:.78}.di-btn:active{transform:scale(.84)}

.di-em{width:100%;height:100%;box-sizing:border-box;padding:18px 24px 0;display:flex;flex-direction:column}
.di-em-top{display:flex;align-items:center;gap:14px;height:64px}
.di-em-txt{flex:1;min-width:0}
.di-prog{margin-top:14px}
.di-bar{position:relative;height:5px;border-radius:3px;background:rgba(255,255,255,.22);cursor:pointer;transition:height .2s,margin .2s}
.di-bar::before{content:'';position:absolute;left:0;right:0;top:-8px;bottom:-8px}
.di-bar:hover{height:8px;margin-top:-1.5px;margin-bottom:-1.5px}
.di-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:#fff;transition:width .26s linear}
.di-times{display:flex;justify-content:space-between;font-size:11px;font-weight:500;color:rgba(255,255,255,.5);margin-top:6px;font-variant-numeric:tabular-nums}
.di-ctl{display:flex;justify-content:center;align-items:center;gap:30px;margin-top:4px}
.di-ctl .di-btn{width:50px;height:44px}

.di-home{width:100%;height:100%;box-sizing:border-box;padding:18px 24px;display:flex;flex-direction:column;justify-content:space-between}
.di-h-top{display:flex;justify-content:space-between;align-items:center}
.di-clock{font-size:40px;font-weight:700;letter-spacing:-1.2px;line-height:1}
.di-clock small{font-size:16px;font-weight:600;margin-left:5px;letter-spacing:0;color:rgba(255,255,255,.6)}
.di-date{font-size:14px;font-weight:500;color:rgba(255,255,255,.55);margin-top:7px}
.di-hbatt{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;background:rgba(255,255,255,.1);padding:7px 12px;border-radius:17px}
.di-cap{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:7px}
.di-chips{display:flex;gap:10px}
.di-chip{flex:1;height:44px;border-radius:22px;border:0;background:rgba(255,159,10,.17);color:#ff9f0a;
  font:600 17px -apple-system,system-ui,sans-serif;cursor:pointer;outline:none;
  transition:transform .18s cubic-bezier(.3,1.5,.5,1),background-color .2s}
.di-chip:hover{background:rgba(255,159,10,.28)}.di-chip:active{transform:scale(.93)}
.di-chip small{font-size:12px;margin-left:2px;opacity:.8;font-weight:600}
.di-h-timer{display:flex;align-items:center;gap:14px}
.di-ttxt{flex:1}
.di-tbig{font-size:32px;font-weight:600;color:#ff9f0a;font-variant-numeric:tabular-nums;line-height:1}
.di-tlbl{font-size:13px;font-weight:500;color:rgba(255,255,255,.55);margin-top:5px}
.di-round{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.14)}
.di-round.or{background:rgba(255,159,10,.2);color:#ff9f0a}
.di-ringc{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center}

.di-pager{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);display:flex;opacity:0;pointer-events:none;transition:opacity .2s}
.di-pager.on{opacity:1;pointer-events:auto;transition:opacity .3s ease .25s}
.di-pager i{width:14px;height:14px;position:relative;cursor:pointer}
.di-pager i::after{content:'';position:absolute;left:4px;top:4px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.3);transition:background .2s}
.di-pager i.a::after{background:#fff}

.di-bubble{position:relative;flex:none;height:37px;width:0;margin-left:0;border-radius:50%;background:#000;overflow:hidden;
  opacity:0;transform:scale(.3);pointer-events:auto;cursor:default;
  box-shadow:0 0 0 .5px rgba(255,255,255,.07),0 6px 18px rgba(0,0,0,.28);
  transition:width .62s ${SPRING},margin .62s ${SPRING},opacity .3s ease,transform .55s ${SPRING}}
.di-bubble.open{width:37px;margin-left:8px;opacity:1;transform:scale(1)}
.di-b{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;
  opacity:0;transform:scale(.6);filter:blur(6px);transition:opacity .25s,transform .4s ease,filter .3s}
.di-b.on{opacity:1;transform:none;filter:none}
`;
