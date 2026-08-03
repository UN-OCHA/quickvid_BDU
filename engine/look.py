"""OCHA QuickVid — footage looks, the SHARED module.

ONE place for the named adjustment presets both tabs offer ("Look" row): the
UI sends {"look": {"preset": "...", "phone_fix": bool}} on the render spec, and
every renderer (social_brand.py for branded output, finish.py for the plain
Titles path) asks `chain()` for the filter to prepend to the footage — BEFORE
any brand overlay, so captions, logos and strips are never re-graded.

Presets are few and named for non-editors:
  none      leave the footage alone (default)
  brighter  lift for dim phone/indoor footage — exposure + a gentle gamma lift
  punchier  contrast + a touch of saturation for flat, hazy clips
  auto      normalize levels (temporally smoothed) — for footage with no true
            black/white point; strongest on washed-out screen recordings

On top of a preset there are four BASIC adjustments (`adjust`), each -100..+100
with 0 = untouched: brightness, contrast, saturation and warmth. They exist to
rescue a dim or colour-cast clip, not to grade it, so each is clamped to a range
that cannot push footage off-brand — the worst a user can do is a mild correction.
They apply AFTER the preset and, like it, BEFORE any branding.

The `phone_fix` flag is the OTHER colour problem: SDR wide-gamut phone clips
(Display P3) whose OCHA blue drifts when sRGB graphics composite over them.
Tagged files are converted automatically by the renderers (mediakit.needs_709);
this flag forces the conversion for UNTAGGED files. HDR was already handled
(mediakit.to_sdr since the first iPhone battle) — this closes the SDR-P3 gap.
"""

LOOKS = {
    "none": None,
    "brighter": "eq=brightness=0.05:gamma=1.12:saturation=1.03",
    "punchier": "eq=contrast=1.12:saturation=1.16",
    "auto": "normalize=smoothing=50",
}


# Each adjustment maps -100..+100 onto a DELIBERATELY NARROW range. A slider at
# full tilt should read as "corrected", never as "graded" — the brand look has to
# survive whatever the user does here.
ADJUST = {
    "brightness": (-0.18, 0.18),      # eq brightness: black level lift/drop
    "contrast":   (0.78, 1.28),       # eq contrast:   1.0 = unchanged
    "saturation": (0.55, 1.45),       # eq saturation: 1.0 = unchanged
    "warmth":     (5200, 7800),       # colortemperature K: ~6500 = neutral daylight
}


def _lerp(v, lo, hi, neutral=None):
    """-100..0..+100 -> lo..neutral..hi (neutral defaults to the midpoint)."""
    try:
        v = max(-100.0, min(100.0, float(v)))
    except (TypeError, ValueError):
        return None
    if not v:
        return None
    mid = (lo + hi) / 2 if neutral is None else neutral
    return mid + (v / 100.0) * ((hi - mid) if v > 0 else (mid - lo))


def adjust_chain(look):
    """The -vf snippet for the four basic sliders, or None when all are at 0."""
    adj = (look or {}).get("adjust") or {}
    eq = []
    b = _lerp(adj.get("brightness"), *ADJUST["brightness"], neutral=0.0)
    if b is not None:
        eq.append(f"brightness={b:.3f}")
    c = _lerp(adj.get("contrast"), *ADJUST["contrast"], neutral=1.0)
    if c is not None:
        eq.append(f"contrast={c:.3f}")
    sat = _lerp(adj.get("saturation"), *ADJUST["saturation"], neutral=1.0)
    if sat is not None:
        eq.append(f"saturation={sat:.3f}")
    parts = []
    if eq:
        parts.append("eq=" + ":".join(eq))
    k = _lerp(adj.get("warmth"), *ADJUST["warmth"], neutral=6500.0)
    if k is not None:
        # pl=1 keeps perceived brightness steady, so warming doesn't also darken
        parts.append(f"colortemperature=temperature={k:.0f}:pl=1")
    return ",".join(parts) if parts else None


def chain(look):
    """The -vf snippet for a spec's look, or None. Preset first, then the basic
    adjustments. Unknown preset names fall back to none (an old page talking to a
    newer engine must never crash a render)."""
    parts = [x for x in (LOOKS.get(((look or {}).get("preset") or "none")),
                         adjust_chain(look)) if x]
    return ",".join(parts) if parts else None


def phone_fix(look):
    """True when the user forced the phone-colour conversion (untagged files)."""
    return bool((look or {}).get("phone_fix"))
