# Environment findings (this Mac, verified 2026-06-25)

Probed before scaffolding so the stack matches reality, not assumptions. Re-run
the checks in this file if the machine changes.

## ffmpeg
- **Homebrew `ffmpeg` 8.1** at `/opt/homebrew/bin/ffmpeg`.
- Decodes the raw Sony audio (`pcm_s24be`, 24-bit) — verified by decoding a raw
  clip to null. ✅ No second "modern" decode binary needed.
- **VideoToolbox** hwaccel present → fast 4K HEVC decode on this Mac. ✅
- **`drawtext` is ABSENT** — this build has no libfreetype/libharfbuzz. ❌
  So text can NOT be burned in with the `drawtext` filter.
- **`overlay` is present.** ✅ → All text & graphics (lower thirds, captions,
  location title, ending text) are rendered as **transparent PNG layers** and
  composited with `overlay`. This is the chosen approach regardless (see
  `decisions.md`): pixel-accurate fonts, and each PNG maps 1:1 to a hideable
  Premiere XML track.

Verify commands:
```bash
ffmpeg -hide_banner -filters | awk '{print $2}' | grep -x drawtext   # (absent here)
ffmpeg -hide_banner -filters | awk '{print $2}' | grep -x overlay    # present
ffmpeg -hide_banner -hwaccels | grep -i videotoolbox                 # present
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
  -of default=noprint_wrappers=1 <raw_clip>.MP4                       # pcm_s24be
```

### ffmpeg selection
The engine's `modern_ffmpeg()` prefers the `imageio-ffmpeg` binary (generic
static build → software HEVC decode, slow; this is what timed out in Cowork).
On this Mac we want Homebrew ffmpeg (hardware decode + decodes the raw audio).
`imageio_ffmpeg.get_ffmpeg_exe()` honors the **`IMAGEIO_FFMPEG_EXE`** env var,
so the backend sets it to the Homebrew path — **no engine code change**. See
`app/backend/settings.py`.

## Python
- System default is **3.14.3** — too new; no `faster-whisper`/`ctranslate2`
  wheels yet. ❌ Do not build the venv with it.
- **`python3.11` (3.11.15)** present at `/opt/homebrew/bin/python3.11`. ✅ Build
  the venv with this.
- **Pillow 12.1** already present system-wide (used for PNG layer rendering).

## Node (for the optional desktop-packaging path later)
- **Node 20.20.1** present, so a Tauri/Electron wrapper around this same backend
  is feasible if the team later wants a double-click install.
