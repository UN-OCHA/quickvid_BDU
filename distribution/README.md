# OCHA QuickVid — distribution

Mirrors the DataViz plugin's layout: **`ocha_quickvid_plugin_download/` is the
one folder colleagues get** (share it as a Dropbox folder link — "Anyone with
the link, can view"). Everything else here is maintainer-facing.

## `ocha_quickvid_plugin_download/` — what colleagues see

| File | What it is |
|---|---|
| `OCHA_QuickVid_Install_Guide.pdf` | **The install guide — start here.** Windows + Mac, with screenshots (incl. the installer's false "not compatible" warning: ignore it, click Install). |
| `ocha-quickvid-panel.zxp` | The panel. Signed (OCHA BDU self-signed cert) so the ZXP/UXP Installer accepts it. **Also the auto-update target** — `version.json`'s `packageUrl` points at this file on GitHub raw, so the name/path is load-bearing. |
| `install_guide.md` | The same guide as plain text. |
| `windows-setup.bat` | One-time **Windows** step — enables Adobe's debug mode so the self-signed panel can load. Mac needs nothing extra. |

Colleagues only need this folder ONCE — after installing, the panel updates
itself (banner → Update now → quit Premiere → reopen).

## How it stays fresh

- `tools/build-panel-package.sh` signs the panel and copies the `.zxp` here.
- `tools/install-guide-source/build.py` regenerates the PDF here (only needed
  when install steps change).
- The folder lives in the Dropbox-synced repo, so a build + push refreshes what
  the shared link shows — no re-sharing ever.

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
