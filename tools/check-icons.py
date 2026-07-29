#!/usr/bin/env python3
"""Every icon in the Premiere panel must come from Font Awesome Classic Regular.

The panel can't load the FA kit — a CDN dependency breaks offline and behind a
firewall — so icons are inlined as SVG. Inlining is exactly what lets a
hand-drawn or wrong-weight icon creep back in unnoticed, which is what this
guards. It compares every <path d="…"> in the panel against the 4,791 SVGs in
the design system's FA Classic Regular export.

    python3 tools/check-icons.py          # report
    python3 tools/check-icons.py --quiet  # exit code only (for a build step)

Exit 0 = clean, 1 = something isn't from the library.

ALLOWED EXCEPTION — `.card__icon`: the five element cards (Lower third,
Location, OCHA logo, Ending, Text) carry 44x30 schematics, not icons. Each is a
tiny picture of the FRAME showing where that graphic sits — a bar low-left, a red
pin top-left, a logo in the corner. No icon library has "a diagram of this
template's layout", and swapping in a generic glyph would throw away the one
thing the card communicates. Anything else non-FA is a failure.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PANEL = REPO / "premiere" / "cep" / "index.html"
FA = Path(
    "/Users/javiercuetoocha/OCHA DMU Dropbox/Javier Cueto/Design/Visual_identity/"
    "OCHA_design_system/assets/FA_classic_regular"
)
ALLOWED_CLASSES = {"card__icon"}


def fa_index():
    """Every path string FA Classic Regular knows about -> icon name."""
    out = {}
    for f in FA.glob("*.svg"):
        for d in re.findall(r'\sd="([^"]+)"', f.read_text(encoding="utf-8")):
            out[d.strip()] = f.stem
    return out


def main():
    quiet = "--quiet" in sys.argv
    if not FA.is_dir():
        print(f"FA Classic Regular not found at:\n  {FA}\n"
              "It's a Pro export and lives in the design system repo — without it "
              "this check can't run.", file=sys.stderr)
        return 2

    index = fa_index()
    html = PANEL.read_text(encoding="utf-8")
    bad, ok, skipped = [], 0, 0

    for m in re.finditer(r"<svg\b[^>]*>.*?</svg>", html, re.S):
        svg = m.group(0)
        cls = re.search(r'class="([^"]*)"', svg)
        classes = set(cls.group(1).split()) if cls else set()
        if classes & ALLOWED_CLASSES:
            skipped += 1
            continue
        paths = [d.strip() for d in re.findall(r'\sd="([^"]+)"', svg)]
        if paths and all(d in index for d in paths):
            ok += 1
            continue
        bad.append((html[: m.start()].count("\n") + 1, " ".join(sorted(classes)) or "(no class)"))

    if not quiet:
        print(f"{PANEL.relative_to(REPO)}")
        print(f"  FA Classic Regular : {ok}")
        print(f"  allowed schematics : {skipped}  ({', '.join(sorted(ALLOWED_CLASSES))})")
        print(f"  NOT from the library: {len(bad)}")
        for line, cls in bad:
            print(f"     line {line}: {cls}")
        if bad:
            print("\nEvery icon must be inlined from FA Classic Regular:")
            print(f"  {FA}")
            print("Pick the closest icon there and inline its viewBox + path(s).")
            print("If nothing fits, ask Javi — don't draw one.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
