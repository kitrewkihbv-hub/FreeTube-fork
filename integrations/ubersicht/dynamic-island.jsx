import { run } from "uebersicht";

export const command = `
SPOTIFY_NP=$(osascript -e '
if application "Spotify" is running then
  tell application "Spotify"
    set st to player state as string
    if st is "playing" or st is "paused" then
      set t to name of current track
      set a to artist of current track
      set art to artwork url of current track
      set mode to "PAUSED"
      if st is "playing" then set mode to "PLAYING"
      return mode & "|" & t & "|" & a & "|" & art
    end if
  end tell
end if
return ""
' 2>/dev/null)

# Prefer an actual MacTube video when both players are open. The fourth
# field identifies a Watch video; ordinary MacTube page titles are not tracks.
MACTUBE_NP=$(cat /tmp/mactube_np.txt 2>/dev/null)
NP_SOURCE="NONE"
if printf '%s' "$MACTUBE_NP" | awk -F'|' '($1 == "PLAYING" || $1 == "PAUSED") && $3 == "MACTUBE" && index($4, "https://i.ytimg.com/vi/") == 1 { found=1 } END { exit !found }'; then
  NP="$MACTUBE_NP"
  NP_SOURCE="MACTUBE"
elif [ -n "$SPOTIFY_NP" ]; then
  NP="$SPOTIFY_NP"
  NP_SOURCE="SPOTIFY"
else
  NP="IDLE|SPOTIFY|STANDBY|"
fi

NEAR=$(swift -e '
import AppKit
let p = NSEvent.mouseLocation
let h = NSScreen.main?.frame.height ?? 900
let w = NSScreen.main?.frame.width ?? 1440
print((h - p.y) <= 55 && abs(p.x - w / 2) <= 150 ? "1" : "0")
' 2>/dev/null || echo "0")

BADGES=$(python3 -c '
import subprocess, re
out = subprocess.check_output(["lsappinfo", "list"], text=True, stderr=subprocess.DEVNULL)
ignore = {"Finder", "SystemUIServer", "ControlCenter", "Dock", "WindowServer", "Übersicht"}
total, ringing, apps, cur = 0, False, [], ""
q = chr(34)
for line in out.splitlines():
    m = re.match(r"^\\d+\\)\\s+" + q + "([^" + q + "]+)" + q, line)
    if m: cur = m.group(1)
    if cur and cur not in ignore and "StatusLabel" in line:
        num = re.search(q + "label" + q + "=" + q + r"(\\d+)" + q, line)
        if num and int(num.group(1)) > 0:
            total += int(num.group(1))
            if cur not in apps: apps.append(cur)
        elif q + "label" + q + "=" + q + "•" + q in line or q + "label" + q + "=" + q + "!" + q in line:
            total += 1
            if cur not in apps: apps.append(cur)
        if cur == "FaceTime" and q + "label" + q in line: ringing = True
flag = "1" if ringing else "0"
first = apps[0] if apps else ""
print("{}|{}|{}".format(total, flag, first))
' 2>/dev/null || echo "0|0|")

echo "\${NP}|\${NP_SOURCE}|\${BADGES}|\${NEAR}"
`;

export const refreshFrequency = 1000;
export const initialState = { expanded: false, visUntil: 0, booted: false };
export const updateState = (e, s) => {
  if (e.type === "BOOT") return { ...s, booted: true, visUntil: Date.now() + 3000 };
  if (e.type === "SHOW") return { ...s, visUntil: Date.now() + 3000 };
  if (e.type === "TOGGLE") return { ...s, expanded: e.val, visUntil: Date.now() + 3000 };
  if (e.output) {
    const near = e.output.trim().split("|").pop();
    if (near === "1") return { ...s, visUntil: Date.now() + 3000 };
  }
  return s;
};

export const className = `
  top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; user-select: none;
  @keyframes eqWave { 0%, 100% { height: 3px; } 50% { height: 13px; } }
  .bg { position: fixed; inset: 0; pointer-events: auto; z-index: 998; }
  .wrap {
    position: fixed; top: 8px; left: 50%;
    transform: translate3d(-50%, -56px, 0);
    opacity: 0;
    display: flex; align-items: center; gap: 8px; z-index: 999; pointer-events: none;
    transition: transform 0.48s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.34s ease;
  }
  .wrap.shown {
    transform: translate3d(-50%, 0px, 0);
    opacity: 1;
  }
  .pill {
    position: relative; pointer-events: auto; background: #050507; border: 1px solid rgba(216, 180, 254, 0.35);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.9), 0 0 18px rgba(168, 85, 247, 0.25); color: #fff;
    overflow: hidden; cursor: pointer; box-sizing: border-box; width: 150px; height: 32px;
    border-radius: 999px; padding: 0 14px;
    transition: all 0.44s cubic-bezier(0.28, 1.15, 0.4, 1);
  }
  .pill.live { width: 255px; border-color: rgba(255, 255, 255, 0.35); }
  .pill.open { width: 345px; height: 134px; border-radius: 34px; padding: 16px 20px; border-color: rgba(255, 255, 255, 0.45); cursor: pointer; }
  .tint { position: absolute; inset: -25px; background-size: cover; background-position: center; filter: blur(22px) saturate(220%) brightness(0.65); opacity: 0; transition: opacity 0.6s ease; pointer-events: none; z-index: 0; }
  .pill.live .tint { opacity: 0.85; }
  .pill.open .tint { opacity: 0.75; }
  .split { pointer-events: auto; height: 32px; padding: 0 12px; border-radius: 999px; background: #050507; border: 1px solid rgba(216,180,254,0.45); box-shadow: 0 8px 24px rgba(0,0,0,0.9); display: flex; align-items: center; gap: 6px; color: #f5f3ff; font-size: 11px; font-weight: 700; cursor: pointer; }
  .pill.open + .split { display: none; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #c084fc; box-shadow: 0 0 8px #c084fc; }
  .mini { position: relative; z-index: 1; height: 30px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pill.open .mini { display: none; }
  .art1 { width: 18px; height: 18px; border-radius: 5px; background-size: cover; background-position: center; background-color: #6b21a8; flex-shrink: 0; }
  .t1 { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 4px rgba(0,0,0,0.85); flex: 1; text-align: center; }
  .eq { display: flex; align-items: center; gap: 2px; height: 13px; flex-shrink: 0; }
  .bar { width: 2px; height: 3px; border-radius: 2px; background: #fff; }
  .eq.on .bar:nth-child(1) { animation: eqWave 0.8s ease-in-out infinite; }
  .eq.on .bar:nth-child(2) { animation: eqWave 0.6s ease-in-out 0.15s infinite; }
  .eq.on .bar:nth-child(3) { animation: eqWave 0.9s ease-in-out 0.35s infinite; }
  .eq.on .bar:nth-child(4) { animation: eqWave 0.7s ease-in-out 0.1s infinite; }
  .full { position: relative; z-index: 1; display: none; }
  .pill.open .full { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
  .row1 { display: flex; align-items: center; gap: 12px; }
  .art2 { width: 46px; height: 46px; border-radius: 12px; background-size: cover; background-position: center; background-color: #6b21a8; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; flex-shrink: 0; cursor: pointer; }
  .meta { flex: 1; min-width: 0; }
  .mt { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 4px rgba(0,0,0,0.85); }
  .ms { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip { background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.45); font-size: 10px; font-weight: 700; padding: 4px 9px; border-radius: 999px; cursor: pointer; flex-shrink: 0; }
  .row2 { display: flex; align-items: center; justify-content: center; gap: 28px; padding-top: 4px; }
  button { background: transparent; border: none; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; padding: 5px 12px; border-radius: 999px; }
  button:hover { background: rgba(255,255,255,0.18); }
`;
export const render = ({ output, expanded, visUntil, booted }, dispatch) => {
  const parts = (output || "").trim().split("|");
  const st = parts.shift() || "IDLE";
  const title = parts.shift() || "SPOTIFY";
  const artist = parts.shift() || "STANDBY";
  const thumb = parts.shift() || "";
  const source = parts.shift() || "NONE";
  const count = parseInt(parts.shift() || "0", 10);
  const call = (parts.shift() || "0") === "1";
  const app = parts.shift() || "";
  const hasMedia = st === "PLAYING" || st === "PAUSED";
  const live = st === "PLAYING";

  if (!booted && typeof window !== "undefined") {
    window.onmousemove = (e) => {
      if (e.clientY <= 55 && Math.abs(e.clientX - window.innerWidth / 2) <= 150) {
        dispatch({ type: "SHOW" });
      }
    };
    setTimeout(() => dispatch({ type: "BOOT" }), 50);
  }

  const isShown = expanded || Date.now() < visUntil;

  const act = (e, k) => {
    e.stopPropagation();
    dispatch({ type: "SHOW" });
    if (["PREV", "PLAY", "NEXT"].includes(k)) {
      if (source === "MACTUBE") {
        // Publish one allowed command atomically; never follow a symlink at the
        // public command-file path. The app polls this single-slot mailbox.
        run(`python3 -c 'import os,sys,tempfile; f,p=tempfile.mkstemp(prefix=".mactube-widget-",dir="/tmp"); os.write(f,sys.argv[1].encode()); os.close(f); os.replace(p,"/tmp/mactube_cmd.txt")' ${k}`);
      } else if (source === "SPOTIFY") {
        const spotifyAction = { PREV: "previous track", PLAY: "playpause", NEXT: "next track" }[k];
        run(`osascript -e 'tell application "Spotify" to ${spotifyAction}'`);
      }
    }
    if (k === "OPEN_MEDIA") run(source === "MACTUBE" ? `open -a "MacTube"` : `open -a "Spotify"`);
    // App names come from lsappinfo, so quote them as data rather than shell code.
    if (k === "OPEN_APP") {
      const name = app || "Spotify";
      run(`open -a '${name.replace(/'/g, "'\\''")}'`);
    }
  };

  const bg = thumb ? { backgroundImage: `url("${thumb}")` } : {};

  return (
    <div>
      {expanded && (
        <div
          className="bg"
          onClick={() => dispatch({ type: "TOGGLE", val: false })}
        />
      )}

      <div className={`wrap ${isShown ? "shown" : ""}`}>
        <div
          className={`pill ${hasMedia ? "live" : ""} ${expanded ? "open" : ""}`}
          onClick={() => dispatch({ type: "TOGGLE", val: !expanded })}
        >
          <div className="tint" style={bg} />
          <div className="mini">
            {hasMedia && <div className="art1" style={bg} />}
            <div className="t1">{call ? "FACETIME" : (hasMedia ? title : "")}</div>
            <div className={`eq ${live ? "on" : ""}`}>
              <div className="bar" /><div className="bar" /><div className="bar" /><div className="bar" />
            </div>
          </div>
          <div className="full">
            <div className="row1">
              <div className="art2" onClick={(e) => act(e, "OPEN_MEDIA")} style={bg}>
                {!thumb && "\u25B6"}
              </div>
              <div className="meta">
                <div className="mt">{hasMedia ? title : "Nothing Playing"}</div>
                <div className="ms">{hasMedia ? artist : "Spotify Ready"}</div>
              </div>
              {count > 0 && (
                <div className="chip" onClick={(e) => act(e, "OPEN_APP")}>
                  {app ? `${app} (${count})` : `${count}+`}
                </div>
              )}
            </div>
            <div className="row2">
              <button onClick={(e) => act(e, "PREV")}>{"\u25C0\u25C0"}</button>
              <button style={{ fontSize: "16px" }} onClick={(e) => act(e, "PLAY")}>
                {live ? "\u275A\u275A" : "\u25B6"}
              </button>
              <button onClick={(e) => act(e, "NEXT")}>{"\u25B6\u25B6"}</button>
            </div>
          </div>
        </div>

        {count > 0 && (
          <div className="split" onClick={(e) => act(e, "OPEN_APP")}>
            <div className="dot" />
            <span>{call ? "CALL" : `${count}+`}</span>
          </div>
        )}
      </div>
    </div>
  );
};

