"""OCHA QuickVid — footage looks, the SHARED module.

ONE place for the named adjustment presets both tabs offer ("Look" row): the
UI sends {"look": {"preset": "...", "phone_fix": bool}} on the render spec, and
every renderer (social_brand.py for branded output, finish.py for the plain
Titles path) asks `chain()` for the filter to prepend to the footage — BEFORE
any brand overlay, so captions, logos and strips are never re-graded.

Presets are deliberately few and named for non-editors; there are no free
sliders to push a video off-brand:
  none      leave the footage alone (default)
  brighter  lift for dim phone/indoor footage — exposure + a gentle gamma lift
  punchier  contrast + a touch of saturation for flat, hazy clips
  auto      normalize levels (temporally smoothed) — for footage with no true
            black/white point; strongest on washed-out screen recordings

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


def chain(look):
    """The -vf snippet for a spec's look, or None. Unknown names fall back to
    none (an old page talking to a newer engine must never crash a render)."""
    return LOOKS.get(((look or {}).get("preset") or "none"))


def phone_fix(look):
    """True when the user forced the phone-colour conversion (untagged files)."""
    return bool((look or {}).get("phone_fix"))
