/* OCHA QuickVid — footage Look picker, the SHARED component.
 *
 * Both tabs mount this ONE implementation (like captions.js / lowerthird.js).
 * Named presets only — no free sliders to push a video off-brand. "Preview on
 * this video" loads one still per preset from /api/look-preview (which applies
 * the SAME colour conversion + chain the render will), so people pick by eye.
 *
 * "Fix phone colours" is the untagged-wide-gamut escape hatch: tagged HDR/P3
 * footage is converted automatically by the engine; this forces the remap when
 * a phone clip lost its tags (OCHA blue looks off, nothing was detected).
 *
 * Contract:
 *   const look = OchaLook.mount({ grid, fix, previewBtn, getVideo, getTime,
 *                                 engine, onChange })
 *   look.collect() → { preset, phone_fix }     — for the render spec
 *   look.restore({preset, phone_fix})          — from a saved project
 *   look.resetPreview()                        — video changed: drop the stills
 */
const OchaLook = (() => {
  "use strict";

  const PRESETS = [
    ["none", "Original", "as filmed"],
    ["brighter", "Brighter", "lifts dim footage"],
    ["punchier", "Punchier", "contrast + colour"],
    ["auto", "Auto-balance", "fixes washed-out levels"],
  ];

  function mount({ grid, fix, previewBtn, getVideo, getTime, engine, onChange }) {
    let preset = "none";
    const cards = {};

    PRESETS.forEach(([key, label, hint]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "look-card" + (key === "none" ? " is-active" : "");
      b.innerHTML = `<img alt="" hidden /><strong>${label}</strong><span>${hint}</span>`;
      b.addEventListener("click", () => { select(key); onChange && onChange(); });
      grid.append(b);
      cards[key] = { btn: b, img: b.querySelector("img") };
    });

    function select(k) {
      preset = PRESETS.some(([p]) => p === k) ? k : "none";
      PRESETS.forEach(([p]) => cards[p].btn.classList.toggle("is-active", p === preset));
    }

    function resetPreview() {
      PRESETS.forEach(([p]) => { cards[p].img.hidden = true; cards[p].img.src = ""; });
    }

    function preview() {
      const v = getVideo && getVideo();
      if (!v) return false;
      const t = Math.max(0.5, (getTime && getTime()) || 1);
      PRESETS.forEach(([p]) => {
        cards[p].img.src = engine + "/api/look-preview?video=" + encodeURIComponent(v)
          + "&t=" + t + "&preset=" + p + "&phone_fix=" + (fix && fix.checked ? "true" : "false")
          + "&cb=" + Date.now();
        cards[p].img.hidden = false;
      });
      return true;
    }

    if (fix) fix.addEventListener("change", () => { onChange && onChange(); });
    if (previewBtn) previewBtn.addEventListener("click", preview);

    return {
      collect: () => ({ preset, phone_fix: !!(fix && fix.checked) }),
      restore(l) {
        if (!l) return;
        select(l.preset || "none");
        if (fix) fix.checked = !!l.phone_fix;
      },
      preview, resetPreview,
    };
  }

  return { mount };
})();
