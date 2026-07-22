# OCHA QuickVid — download folder

This folder is what a colleague needs to install the **OCHA QuickVid** Premiere
Pro panel. Hand them (or point them at) this folder.

| File | What it is |
|---|---|
| `ocha-quickvid-panel.zxp` | The panel. Signed (OCHA BDU self-signed cert) so the ZXP/UXP Installer accepts it. |
| `install_guide.md` | Step-by-step install for **Windows and Mac**. Start here. |
| `windows-setup.bat` | One-time **Windows** step — enables Adobe's debug mode so the self-signed panel can load. Mac needs nothing extra. |

**Quick version:** install the `.zxp` with the free
[ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/) → open Premiere ▸
Window ▸ Extensions ▸ OCHA QuickVid. **On Windows, run `windows-setup.bat`
first.** Full details in [install_guide.md](install_guide.md).

> Rebuilt by `tools/build-panel-package.sh` — the `.zxp` here is a copy of the
> signed build. Don't hand-edit it.

## Maintained by

**OCHA Brand and Design Unit (BDU)**
- Team: ochavisual@un.org
- Focal point: Javier Cueto (cuetoj@un.org)
