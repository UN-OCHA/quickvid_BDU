#!/usr/bin/env python3
"""
UN Web TV (Kaltura) downloader — engine module for Statement clips.

Resolves a webtv.un.org page URL (or a bare 1_xxxx entry id) to the recorded
VOD entry and downloads it with the FLOOR audio (each speaker's own voice):

  1. finished single-file MP4 flavor when Kaltura has encoded it (older meetings);
  2. SAME-DAY fallback: the finished MP4s don't exist yet, but the live-DVR HLS
     is up — mux the video rendition + the floor audio track. The floor channel
     in UN HLS masters is labelled LANGUAGE="ina" ("Interlingua"). This fallback
     is why the tool works minutes after a Security Council meeting ends.

Interpretation audio (en/es/fr/ru/ar/zh) works through the same HLS path.

CLI (driven by the backend as a job; progress goes to stdout):
    python3 webtv.py --url <webtv-url-or-entryId> --out <dir> [--lang floor] [--quality 1080]
Writes <out>/<safe-name>.mp4 and prints `RESULT {json}` on the last line.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

PARTNER = "2503451"                       # UN Web TV's Kaltura partner id
API = "https://cdnapisec.kaltura.com/api_v3/service"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
FF = os.environ.get("IMAGEIO_FFMPEG_EXE") or "/opt/homebrew/bin/ffmpeg"


def _get(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")


def _api(service_action: str, **params) -> object:
    params["format"] = 1
    q = urllib.parse.urlencode(params)
    d = json.loads(_get(f"{API}/{service_action}?{q}"))
    if isinstance(d, dict) and d.get("objectType") == "KalturaAPIException":
        raise RuntimeError(d.get("message") or d.get("code") or "Kaltura API error")
    return d


def resolve(url_or_id: str) -> dict:
    """Page URL / entry id -> {entry, recorded, name}. Cheap; no download."""
    if re.fullmatch(r"1_[a-z0-9]+", url_or_id):
        entry = url_or_id
    else:
        page = _get(url_or_id)
        m = re.search(r"kentryID *= *'(1_[a-z0-9]+)'", page)
        if not m:
            raise RuntimeError("Could not find a Kaltura entry id on that page — is it a webtv.un.org video link?")
        entry = m.group(1)
    ks = _api("session/action/startWidgetSession", widgetId=f"_{PARTNER}")["ks"]
    info = _api("baseentry/action/get", ks=ks, entryId=entry)
    recorded = info.get("recordedEntryId") or info.get("redirectEntryId") or info["id"]
    name = _api("baseentry/action/get", ks=ks, entryId=recorded).get("name", "video")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:120] or "video"
    return {"ks": ks, "entry": entry, "recorded": recorded, "name": name, "safe": safe}


def _ready_mp4_flavor(ks: str, entry: str, quality: str):
    """Best finished single-file MP4 flavor at/below the wanted height, or None."""
    flavors = _api("flavorasset/action/getByEntryId", ks=ks, entryId=entry)
    if not isinstance(flavors, list):
        return None
    # width>0 AND height>0: a live/rolling channel entry advertises a 0-width
    # placeholder flavor (e.g. 0x540) that downloads as a broken file — reject it.
    vids = [f for f in flavors if (f.get("height") or 0) > 0 and (f.get("width") or 0) > 0 and f.get("status") == 2]
    if not vids:
        return None                                   # same-day meeting: nothing encoded yet
    if quality == "source":
        src = [f for f in flavors if f.get("flavorParamsId") == 0 and f.get("status") == 2]
        return (src or [max(vids, key=lambda f: f["height"])])[0]
    tgt = int(re.sub(r"\D", "", quality) or 1080)
    exact = [f for f in vids if f["height"] == tgt]
    le = [f for f in vids if f["height"] <= tgt]
    return (exact or ([max(le, key=lambda f: f["height"])] if le else [max(vids, key=lambda f: f["height"])]))[0]


def _hls_urls(ks: str, entry: str, lang: str, quality: str):
    """(video_url, audio_url) for downloading. audio_url is None when audio is
    muxed into the video rendition (typical for a LIVE stream) — the caller then
    downloads a single input. Handles three master shapes:
      * VOD/recorded : video variants + separate #EXT-X-MEDIA audio tracks -> mux
      * live         : video variants, audio muxed in (no audio tracks)   -> single
      * media list   : no #EXT-X-STREAM-INF at all (the URL IS the stream) -> single
    """
    pc = _api("baseentry/action/getPlaybackContext", ks=ks, entryId=entry,
              **{"contextDataParams:objectType": "KalturaContextDataParams",
                 "contextDataParams:flavorTags": "all"})
    hls = next((s["url"] for s in pc.get("sources", []) if s.get("format") == "applehttp"), None)
    if not hls:
        raise RuntimeError("no HLS stream available for this entry yet")
    master_url = f"{hls}/ks/{ks}"
    master = _get(master_url)
    if "#EXT-X-STREAM-INF" not in master:
        return master_url, None                       # the URL is already a media playlist (audio muxed)

    want = {"floor": "ina", "original": "ina"}.get(lang, lang)
    auds, vids = [], []
    lines = master.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-MEDIA") and "TYPE=AUDIO" in line:
            lc = (re.search(r'LANGUAGE="([^"]*)"', line) or [None, ""])[1]
            uri = (re.search(r'URI="([^"]*)"', line) or [None, ""])[1]
            if uri:
                auds.append((lc, uri))
        elif line.startswith("#EXT-X-STREAM-INF"):
            m = re.search(r"RESOLUTION=\d+x(\d+)", line)
            vids.append((int(m.group(1)) if m else 0, lines[i + 1].strip()))
    if not vids:
        raise RuntimeError("HLS master has no video renditions (stream not ready?).")
    tgt = int(re.sub(r"\D", "", quality) or 1080)
    vids.sort()
    vurl = urllib.parse.urljoin(master_url, next((u for h, u in reversed(vids) if h <= tgt), vids[-1][1]))
    if not auds:                                       # live: audio muxed into the video rendition
        return vurl, None
    aurl = next((u for lc, u in auds if lc == want), auds[0][1])
    return vurl, urllib.parse.urljoin(master_url, aurl)


def _download_direct(ks: str, flavor_id: str, out: str) -> None:
    url = _api("flavorasset/action/getUrl", ks=ks, id=flavor_id)
    if not isinstance(url, str):
        raise RuntimeError(f"No download URL for flavor {flavor_id}: {url}")
    req = urllib.request.Request(url.replace("\\/", "/"), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp, open(out, "wb") as fh:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        last = -1
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            if total:
                pct = int(done / total * 100)
                if pct != last:                          # throttle: one line per whole percent
                    last = pct
                    print(f"PROGRESS {pct}", flush=True)
                    print(f"Downloading… {pct}% of {total / 1e9:.2f} GB", flush=True)


def _playlist_bounds(url: str):
    """(is_live, duration_s) of an HLS MEDIA playlist. A master (has STREAM-INF)
    or an unreadable URL -> (False, 0), so callers just don't cap."""
    try:
        pl = _get(url)
    except Exception:
        return False, 0
    if "#EXT-X-STREAM-INF" in pl:
        return False, 0
    dur = sum(float(x) for x in re.findall(r"#EXTINF:([0-9.]+)", pl))
    return "#EXT-X-ENDLIST" not in pl, dur


def _download_hls(vurl: str, aurl: "str | None", out: str) -> None:
    """Mux video rendition + chosen audio track (aurl=None → audio already muxed
    into the video, so download a single input). For a LIVE (DVR) stream, cap the
    output at what's recorded so far so we don't sit waiting on the live edge."""
    is_live, dur = _playlist_bounds(vurl)
    cap = ["-t", f"{dur:.1f}"] if (is_live and dur > 1) else []
    if cap:
        print(f"Live event — grabbing the ~{dur / 60:.0f} min recorded so far…", flush=True)
    if aurl:                                           # separate video + audio (VOD) → mux
        io = ["-i", vurl, "-i", aurl, "-map", "0:v", "-map", "1:a"]
    else:                                              # audio muxed into the video (live) → single input
        io = ["-i", vurl]
    cmd = [FF, "-y", "-loglevel", "error", "-user_agent", UA] + io + [
           "-c", "copy", "-progress", "pipe:1"] + cap + [out]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    last = -1
    for line in proc.stdout:
        if line.startswith("out_time="):
            hms = line.split("=")[1].strip()
            try:
                h, m, s = hms.split(":"); t = int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                continue
            if dur > 1:                                  # % of the known recording length
                pct = int(min(100, t / dur * 100))
                if pct != last:
                    last = pct
                    print(f"PROGRESS {pct}", flush=True)
                    print(f"Downloading… {pct}% ({t / 60:.0f} of {dur / 60:.0f} min)", flush=True)
            elif int(t) != last:                         # unknown length → just the time
                last = int(t)
                print(f"Downloading (recording)… {hms.split('.')[0]}", flush=True)
    proc.wait()
    err = (proc.stderr.read() or "").strip()
    if proc.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 100000:
        raise RuntimeError("ffmpeg HLS download failed: " + err[-400:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--lang", default="floor", help="floor | en | es | fr | ru | ar | zh")
    ap.add_argument("--quality", default="1080")
    args = ap.parse_args()

    print("Finding the recording on UN Web TV…", flush=True)
    try:
        meta = resolve(args.url)
    except Exception as exc:
        print("ERROR: Couldn't read that UN Web TV page — " + str(exc), flush=True)
        sys.exit(1)
    print(f"Found: {meta['name']}", flush=True)

    # Guard: the UN Web TV *24/7 live channel* page (and other rolling "channel"
    # feeds) isn't a specific meeting — it exposes only a few seconds of DVR of
    # whatever is on air, so a download here is never a usable statement. Catch it
    # by the well-known channel wording and tell the user to use the meeting's own
    # page. (A real archived meeting has its own asset URL / 1_xxxx entry.)
    low = meta["name"].lower()
    if any(s in low for s in ("24 hour", "pre-recorded programming", "web tv channel")):
        print("ERROR: That link is the UN Web TV 24/7 live channel "
              f"(“{meta['name']}”), not a specific meeting — it only carries a few "
              "seconds of whatever is on air. Open the meeting’s own page on webtv.un.org "
              "(search its title, e.g. “Security Council…”) and paste that link instead.",
              flush=True)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, f"{meta['safe']}_{args.quality}_{args.lang}.mp4")

    # 1) Finished single-file MP4 (floor only) — best quality when it's encoded.
    if args.lang in ("floor", "original"):
        try:
            flavor = _ready_mp4_flavor(meta["ks"], meta["recorded"], args.quality)
        except Exception:
            flavor = None
        if flavor:
            print(f"Finished MP4 available ({flavor.get('width')}x{flavor.get('height')}) — downloading…", flush=True)
            try:
                _download_direct(meta["ks"], flavor["id"], out)
                print("RESULT " + json.dumps({"path": out, "name": meta["name"]}), flush=True)
                return
            except Exception as exc:
                print(f"(finished MP4 didn't download — {exc}; trying the live stream)", flush=True)

    # 2) HLS — try the RECORDING first, then the LIVE entry itself (for events still airing).
    last = None
    seen = []
    for eid, label in [(meta["recorded"], "recording"), (meta["entry"], "live stream")]:
        if eid in seen:
            continue
        seen.append(eid)
        try:
            vurl, aurl = _hls_urls(meta["ks"], eid, args.lang, args.quality)
        except Exception as exc:
            last = exc
            continue
        print(f"Pulling from the {label}…", flush=True)
        try:
            _download_hls(vurl, aurl, out)
            print("RESULT " + json.dumps({"path": out, "name": meta["name"]}), flush=True)
            return
        except Exception as exc:
            last = exc

    print("ERROR: Couldn't get a downloadable stream from UN Web TV. "
          + (str(last) if last else "The meeting may not be published yet — try again in a minute."), flush=True)
    sys.exit(1)


if __name__ == "__main__":
    main()
