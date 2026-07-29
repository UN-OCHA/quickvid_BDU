/* OCHA QuickVid — "Text on screen", the SHARED component.
 *
 * Both tabs mount this ONE implementation (like location.js / captions.js /
 * look.js). Each card is one block of up to three lines of white Raleway Bold
 * that rise in staggered and leave in reverse — the web twin of the plugin's
 * OCHA Text MOGRT — with the MID readability gradient (feather-dark-feather)
 * placed behind it AUTOMATICALLY by the engine. Position, sizes and motion are
 * the plugin's numbers (engine/text_on.py mirrors premiere/ae/make_assets.py
 * DATA.text).
 *
 * UNLIMITED BLOCKS. It used to be a single on/off block, which meant a video
 * could carry exactly one caption card no matter how many moments needed one.
 * The engine never had that limit — social_brand.py has always looped over
 * `texts` — so this is a UI change only, and the card model is deliberately the
 * same one location.js uses: add, fill, remove, auto-numbered by CSS.
 *
 * The THREE-LINE cap per block stays: it's the template's design, not an
 * arbitrary limit. Need a fourth line? That's a second block.
 *
 * Usage:
 *   const tx = OchaTextOn.mount({
 *     rows: document.querySelector("#t-tx-rows"),   // container for the cards
 *     add:  document.querySelector("#t-tx-add"),    // "Add text on screen" button
 *     onChange: save,                               // called on every edit (autosave)
 *   });
 *   tx.collect();       // -> [{lines: [...], start, duration, gradient}, …]
 *   tx.restore(list);   // the list, a legacy single {on,…} block, or null
 *
 * Load this AFTER location.js (it borrows its mm:ss helpers) and BEFORE
 * app.js / statement.js.
 */
const OchaTextOn = (() => {
  "use strict";

  const START_DEFAULT = 1;        // seconds — matches text_on.py's default
  const DUR_DEFAULT = 5;
  const DUR_MIN = 1.5;            // below this the rise-in and rise-out collide
  const MAX_LINES = 3;
  // The readability band behind the text, as a PERCENT. 80 is the engine default
  // (text_on.MID_OPACITY) and the value the plugin's AE gradient is baked at, so
  // leaving it alone keeps the web app and Premiere identical. Per BLOCK, because
  // how dark the band needs to be depends on the shot underneath it.
  const GRAD_DEFAULT = 80;

  // mm:ss parsing/formatting is identical to the location strip's, so it is
  // borrowed rather than copied — one behaviour, one place to fix it.
  const mmss = (s) => OchaLocation.mmss(s);
  const secs = (s) => OchaLocation.secs(s);

  /* One card = one block on screen. The meta row reuses the location strip's
     classes on purpose: same controls, same look, nothing new to style. */
  const TEMPLATE = `
    <div class="tx-fields">
      <input class="cd-form__input tx-l1" type="text" placeholder="Line 1" autocomplete="off" />
      <input class="cd-form__input tx-l2" type="text" placeholder="Line 2 (optional)" autocomplete="off" />
      <input class="cd-form__input tx-l3" type="text" placeholder="Line 3 (optional)" autocomplete="off" />
    </div>
    <div class="loc-meta">
      <span class="loc-cell loc-cell--start"><span class="lt-cap">Start</span>
        <span class="timefield">
          <input class="cd-form__input timefield__input tx-start" type="text" inputmode="numeric"
                 maxlength="5" aria-label="Start time (mm:ss)" title="When the text rises in (mm:ss)" />
          <span class="timefield__spin">
            <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
            <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
          </span>
        </span>
      </span>
      <span class="loc-cell loc-cell--dur"><span class="lt-cap">Duration</span>
        <span class="timefield">
          <input class="cd-form__input durfield__input tx-dur" type="text" inputmode="numeric"
                 maxlength="3" aria-label="Duration in seconds" title="Seconds on screen" />
          <span class="durfield__unit" aria-hidden="true">sec</span>
          <span class="timefield__spin">
            <button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button>
            <button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button>
          </span>
        </span>
      </span>
      <span class="loc-cell loc-cell--grad"><span class="lt-cap">Gradient</span>
        <select class="cd-form__input tx-grad" title="How dark the band behind this text is">
          <option value="80">80% — default</option>
          <option value="60">60% — lighter</option>
          <option value="40">40% — subtle</option>
          <option value="20">20% — barely there</option>
          <option value="0">Off — no band</option>
        </select>
      </span>
      <button class="cd-button cd-button--outline cd-button--small tx-remove" type="button" title="Remove this text block">
        <i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="cd-button__text">Remove</span>
      </button>
    </div>`;

  function mount({ rows, add, onChange }) {
    const changed = () => { if (typeof onChange === "function") onChange(); };

    function addRow(v) {
      v = v || {};
      const row = document.createElement("div");
      row.className = "tx-row";
      row.innerHTML = TEMPLATE;
      const q = (sel) => row.querySelector(sel);

      const lines = Array.isArray(v.lines) ? v.lines : [];
      [".tx-l1", ".tx-l2", ".tx-l3"].forEach((sel, i) => { q(sel).value = lines[i] || ""; });

      q(".tx-grad").value = String(Number.isFinite(v.gradient) ? v.gradient : GRAD_DEFAULT);
      const tf = q(".tx-start"), df = q(".tx-dur");
      tf.value = mmss(Number.isFinite(v.start) ? v.start : START_DEFAULT);
      df.value = String(Number.isFinite(v.duration) ? v.duration : DUR_DEFAULT);

      const setTf = (s) => { tf.value = mmss(Math.max(0, s)); changed(); };
      tf.addEventListener("blur", () => setTf(secs(tf.value)));
      q(".timefield__up").onclick = () => setTf(secs(tf.value) + 1);
      q(".timefield__down").onclick = () => setTf(secs(tf.value) - 1);

      const setDf = (n) => { df.value = String(Math.max(DUR_MIN, Math.round(n || DUR_MIN))); changed(); };
      df.addEventListener("blur", () => setDf(parseFloat(df.value)));
      q(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
      q(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);

      row.addEventListener("input", changed);
      q(".tx-grad").addEventListener("change", changed);   // <select> doesn't bubble `input` everywhere
      q(".tx-remove").onclick = () => { row.remove(); changed(); };
      rows.appendChild(row);
      return row;
    }

    function collect() {
      return [...rows.querySelectorAll(".tx-row")].map((r) => {
        const lines = [...r.querySelectorAll(".tx-fields input")]
          .map((el) => (el.value || "").trim()).filter(Boolean).slice(0, MAX_LINES);
        const gp = parseInt(r.querySelector(".tx-grad").value, 10);
        return {
          lines,
          start: secs(r.querySelector(".tx-start").value),
          duration: parseFloat(r.querySelector(".tx-dur").value) || DUR_DEFAULT,
          gradient: Number.isFinite(gp) ? gp : GRAD_DEFAULT,
        };
      }).filter((t) => t.lines.length);     // an empty card is a card not filled in yet
    }

    /* Accepts the new list, a legacy single {on, lines, …} block (projects saved
       before Jul 2026), or nothing. A legacy block with `on:false` restores as
       no cards, which is what it looked like on screen. */
    function restore(saved) {
      rows.innerHTML = "";
      let list = saved;
      if (!list) list = [];
      else if (!Array.isArray(list)) list = list.on === false ? [] : [list];
      list.forEach(addRow);
    }

    if (add) add.onclick = () => { addRow(); changed(); };
    return { addRow, collect, restore, count: () => rows.querySelectorAll(".tx-row").length };
  }

  return { mount, START_DEFAULT, DUR_DEFAULT, MAX_LINES, GRAD_DEFAULT };
})();
