/* OCHA QuickVid — "Text on screen", the SHARED component.
 *
 * Both tabs mount this ONE implementation (like captions.js / look.js). Up to
 * three lines of white Raleway Bold that rise in staggered and leave in
 * reverse — the web twin of the plugin's OCHA Text MOGRT — with the MID
 * readability gradient (feather-dark-feather) placed behind them
 * AUTOMATICALLY by the engine. Position, sizes and motion are the plugin's
 * numbers (engine/text_on.py mirrors premiere/ae/make_assets.py DATA.text).
 *
 * Contract:
 *   const tx = OchaTextOn.mount({ on, fields, l1, l2, l3, start, dur, onChange })
 *     — every value an element ID.
 *   tx.collect() → [] | [{ lines: [...], start, duration }]   — for the render spec
 *   tx.restore(list)                                          — from a saved project
 */
const OchaTextOn = (() => {
  "use strict";

  function mount({ on, fields, l1, l2, l3, start, dur, onChange }) {
    const $ = (id) => document.getElementById(id);
    const els = { on: $(on), fields: $(fields), lines: [$(l1), $(l2), $(l3)], start: $(start), dur: $(dur) };

    els.on.addEventListener("change", () => {
      els.fields.hidden = !els.on.checked;
      onChange && onChange();
    });

    function collect() {
      if (!els.on.checked) return [];
      const lines = els.lines.map((el) => (el.value || "").trim()).filter(Boolean);
      if (!lines.length) return [];
      const s = parseFloat(els.start.value), d = parseFloat(els.dur.value);
      return [{ lines,
                start: Number.isFinite(s) ? Math.max(0, s) : 1,
                duration: Number.isFinite(d) ? Math.max(1.5, d) : 5 }];
    }

    function restore(list) {
      const t = Array.isArray(list) && list[0] ? list[0] : null;
      els.on.checked = !!t;
      els.fields.hidden = !t;
      els.lines.forEach((el, i) => { el.value = t ? (t.lines[i] || "") : ""; });
      els.start.value = t ? t.start : 1;
      els.dur.value = t ? t.duration : 5;
    }

    return { collect, restore };
  }

  return { mount };
})();
