# OCHA QuickVid — Premiere Pro panel · Install guide

A docked panel that drops the OCHA branding elements — lower third, location
strip, OCHA logo, ending, on-screen text, readability gradient — straight onto
your Premiere timeline, auto-matching the sequence format (9:16 / 4:5 / 1:1 /
16:9). No Essential Graphics, no manual setup.

**In this folder**
- `ocha-quickvid-panel.zxp` — the panel (this is what you install)
- `windows-setup.bat` — one-time Windows step (run before installing; Mac needs nothing extra)

---

## Install — Windows

1. **Close Premiere Pro.**
2. **Double-click `windows-setup.bat`.** This turns on Adobe's "debug mode" so
   the panel is allowed to load. Run it once per computer. (If Windows shows a
   blue "protected your PC" box → *More info → Run anyway*.)
3. **Download the free [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/)**
   from aescripts.com and open it.
4. **Drag `ocha-quickvid-panel.zxp` onto the installer window.** If it offers a
   choice of location, pick **per-user** (…\AppData\Roaming\…), not the
   system-wide Program Files one.
5. The installer may warn **"No application compatible with OCHA QuickVid was
   found on your computer."** — **that warning is wrong.** It just fails to
   detect Premiere on some Windows machines. Click **Install** and let it finish.
6. **Open Premiere Pro** → **Window ▸ Extensions ▸ OCHA QuickVid**.

## Install — Mac

1. **Quit Premiere Pro** (⌘Q — fully quit, not just close the window).
2. **Download the free [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/)**
   and open it.
3. **Drag `ocha-quickvid-panel.zxp` onto the installer window.**
4. **Open Premiere Pro** → **Window ▸ Extensions ▸ OCHA QuickVid**.

(No setup script needed on Mac — the ZXP/UXP Installer handles it.)

---

## Requirements

- Adobe Premiere Pro **2020 (v14.0) or later**
- macOS or Windows

## Updating

The panel checks for new versions on launch and shows a banner when one is out.
To update, download the latest `ocha-quickvid-panel.zxp` and drag it onto the
ZXP/UXP Installer again — it overwrites the previous version. (No need to re-run
the setup script.)

## If the panel doesn't appear under Window ▸ Extensions

- Fully quit and reopen Premiere afterwards (on Mac, ⌘Q — not just closing the window).
- **Windows:** make sure you ran `windows-setup.bat` first — without it, Premiere
  silently hides the self-signed panel.
- **Mac:** the ZXP/UXP Installer normally handles this. If the panel still doesn't
  show, open **Terminal** and run `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
  (then again with `.12`), and restart Premiere.

### Manual install (no installer)

The `.zxp` is also a plain archive. Rename it to `.zip`, extract it, and drop
the extracted folder here as `org.unocha.branding`:

- **Windows:** `C:\Users\<you>\AppData\Roaming\Adobe\CEP\extensions\org.unocha.branding\`
- **Mac:** `~/Library/Application Support/Adobe/CEP/extensions/org.unocha.branding/`

so that `…/org.unocha.branding/CSXS/manifest.xml` exists. On Windows, also run
`windows-setup.bat`; then restart Premiere.

## Privacy

The panel sends anonymous usage pings (version, which element was added,
approximate city from IP) to a private OCHA sheet — no file names, project
names, or typed text. It is a no-op until an endpoint is configured.

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
