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

  // Four basic corrections on top of the preset. Ranges are clamped engine-side
  // (look.ADJUST) so full tilt is a correction, never a grade.
  const ADJ = [
    ["brightness", "Brightness", "darker", "brighter"],
    ["contrast", "Contrast", "flatter", "punchier"],
    ["saturation", "Colour", "muted", "vivid"],
    ["warmth", "Warmth", "cooler", "warmer"],
  ];

  function mount({ grid, fix, previewBtn, adjust, getVideo, getTime, engine, onChange }) {
    let preset = "none";
    const cards = {};
    const adj = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
    const adjEls = {};

    PRESETS.forEach(([key, label, hint]) => {
      // The card is a <button>, so the magnifier cannot live inside it (nested
      // interactive elements are invalid and break keyboard order). It sits as a
      // sibling in a positioned wrapper instead.
      const wrap = document.createElement("div");
      wrap.className = "look-card-wrap";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "look-card" + (key === "none" ? " is-active" : "");
      b.innerHTML = `<img alt="" hidden /><strong>${label}</strong><span>${hint}</span>`;
      b.addEventListener("click", () => { select(key); onChange && onChange(); });
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "look-zoom";
      zoom.hidden = true;                       // only meaningful once a still exists
      zoom.title = `See "${label}" bigger`;
      zoom.setAttribute("aria-label", `See ${label} bigger`);
      zoom.innerHTML = '<i class="fa-regular fa-magnifying-glass-plus" aria-hidden="true"></i>';
      zoom.addEventListener("click", (e) => { e.stopPropagation(); openBig(key, label); });
      wrap.append(b, zoom);
      grid.append(wrap);
      cards[key] = { btn: b, img: b.querySelector("img"), zoom };
    });

    // Big view. Requests the still at a larger width from the same endpoint, so it is
    // the real graded frame, not a stretched thumbnail.
    function openBig(key, label) {
      const src = cards[key] && cards[key].img && cards[key].img.src;
      if (!src) return;
      const big = src.replace(/([?&]width=)\d+/, "$11280");
      let m = document.getElementById("look-zoom-modal");
      if (!m) {
        m = document.createElement("div");
        m.id = "look-zoom-modal";
        m.className = "cd-modal look-zoom-modal";
        m.innerHTML = '<div class="cd-modal__panel look-zoom-modal__panel" role="dialog" aria-modal="true">' +
          '<button class="cd-modal__close" type="button" aria-label="Close">&times;</button>' +
          '<img alt="" /><p class="look-zoom-modal__cap"></p></div>';
        document.body.append(m);
        const close = () => { m.hidden = true; };
        m.querySelector(".cd-modal__close").addEventListener("click", close);
        m.addEventListener("click", (e) => { if (e.target === m) close(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.hidden) close(); });
      }
      m.querySelector("img").src = big;
      m.querySelector(".look-zoom-modal__cap").textContent = label;
      m.hidden = false;
    }

    function select(k) {
      preset = PRESETS.some(([p]) => p === k) ? k : "none";
      PRESETS.forEach(([p]) => cards[p].btn.classList.toggle("is-active", p === preset));
    }

    let shown = false;                 // has the user asked for real stills yet?
    function resetPreview() {
      shown = false;
      PRESETS.forEach(([p]) => {
        cards[p].img.hidden = true; cards[p].img.src = "";
        cards[p].zoom.hidden = true;                  // nothing to magnify yet
      });
    }

    function preview() {
      const v = getVideo && getVideo();
      if (!v) return false;
      shown = true;
      const t = Math.max(0.5, (getTime && getTime()) || 1);
      // adjustments go in the URL so each card shows the preset AS CORRECTED, and
      // so the engine can cache per combination (no cache-buster needed)
      const a = ADJ.map(([k]) => `&${k}=${adj[k]}`).join("");
      PRESETS.forEach(([p]) => {
        // width is explicit so the magnifier can ask the SAME url for a big one
        cards[p].img.src = engine + "/api/look-preview?video=" + encodeURIComponent(v)
          + "&t=" + t + "&preset=" + p + "&phone_fix=" + (fix && fix.checked ? "true" : "false") + a
          + "&width=480";
        cards[p].img.hidden = false;
        cards[p].zoom.hidden = false;
      });
      return true;
    }

    // Build the four sliders into `adjust` (a container the page provides).
    if (adjust) {
      adjust.innerHTML = "";
      ADJ.forEach(([key, label, lo, hi]) => {
        const row = document.createElement("div");
        row.className = "adjust-row";
        row.innerHTML =
          `<span class="adjust-row__label">${label}</span>` +
          `<span class="adjust-row__end">${lo}</span>` +
          `<input type="range" class="adjust-row__slider" min="-100" max="100" step="5" value="0" />` +
          `<span class="adjust-row__end">${hi}</span>` +
          `<button type="button" class="adjust-row__reset" title="Back to 0">0</button>`;
        const slider = row.querySelector("input");
        const reset = row.querySelector("button");
        adjEls[key] = slider;
        const changed = () => {
          adj[key] = +slider.value;
          row.classList.toggle("is-set", !!adj[key]);
          onChange && onChange();
          schedulePreview();
        };
        slider.addEventListener("input", changed);
        reset.addEventListener("click", () => { slider.value = 0; changed(); });
        adjust.append(row);
      });
    }

    // Re-render the preview stills after a pause, not on every slider tick — each
    // one is an ffmpeg run per card.
    let previewTimer = null;
    function schedulePreview() {
      if (!previewBtn) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => { if (shown) preview(); }, 400);
    }

    if (fix) fix.addEventListener("change", () => { onChange && onChange(); schedulePreview(); });
    if (previewBtn) previewBtn.addEventListener("click", preview);

    return {
      collect: () => ({ preset, phone_fix: !!(fix && fix.checked), adjust: { ...adj } }),
      restore(l) {
        if (!l) return;
        select(l.preset || "none");
        if (fix) fix.checked = !!l.phone_fix;
        const a = l.adjust || {};
        Object.keys(adj).forEach((k) => {
          adj[k] = Number.isFinite(+a[k]) ? +a[k] : 0;
          if (adjEls[k]) {
            adjEls[k].value = adj[k];
            adjEls[k].parentElement.classList.toggle("is-set", !!adj[k]);
          }
        });
      },
      preview, resetPreview,
    };
  }

  return { mount };
})();
