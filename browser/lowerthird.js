/* OCHA QuickVid — lower-third rows: the SHARED component.
 *
 * Same rule as location.js and field.js: both tabs mount THIS file, so the row
 * markup, the steppers, the collector and the restore logic exist once. Before
 * this, app.js (Titles & branding) and statement.js (Edit) each carried their own
 * copy — they had already drifted (different default start/duration and a
 * different alignment order in the <select>).
 *
 * The ENGINE side is already one module (engine/lower_third.py, numbers in
 * brand-lt.json) — this closes the same loop for the UI.
 *
 * Usage:
 *   const lts = OchaLowerThirds.mount({
 *     rows: el, add: btn, onChange: save,
 *     defaults: { start: 2, duration: 5, align: "center" },   // per-tab defaults
 *   });
 *   lts.collect();   // -> [{name, org, org2, start, duration, align}] (named rows only)
 *   lts.restore(list);
 *   lts.ensure();    // keep one empty row so the form never looks dead
 *
 * Load BEFORE app.js / statement.js.
 */
const OchaLowerThirds = (() => {
  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec || 0));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };
  const secs = (s) => {
    s = String(s == null ? "" : s).trim();
    if (!s) return 0;
    if (s.includes(":")) {
      const p = s.split(":").map(Number);
      return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
    }
    return parseFloat(s) || 0;
  };

  const TEMPLATE = `
     <input class="cd-form__input lt-name" placeholder="First Name Last Name" autocomplete="off">
     <input class="cd-form__input lt-org" placeholder="Job title" autocomplete="off">
     <input class="cd-form__input lt-org2" placeholder="Additional info" autocomplete="off">
     <div class="lt-meta">
       <span class="lt-cell lt-cell--start"><span class="lt-cap">Start</span>
         <span class="lt-start timefield">
           <input class="cd-form__input timefield__input" type="text" inputmode="numeric" maxlength="5" aria-label="Start time (mm:ss)" title="When it appears (mm:ss)">
           <span class="timefield__spin">
             <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
             <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
           </span>
         </span>
       </span>
       <span class="lt-cell lt-cell--dur"><span class="lt-cap">Duration</span>
         <span class="lt-dur timefield">
           <input class="cd-form__input durfield__input" type="text" inputmode="numeric" maxlength="3" aria-label="Duration in seconds" title="Seconds on screen">
           <span class="durfield__unit" aria-hidden="true">sec</span>
           <span class="timefield__spin">
             <button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button>
             <button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button>
           </span>
         </span>
       </span>
       <span class="lt-cell lt-cell--align"><span class="lt-cap">Alignment</span>
         <select class="cd-form__input lt-align" title="Alignment"><option value="left">Left</option><option value="center">Centre</option></select>
       </span>
       <button class="cd-button cd-button--outline cd-button--small lt-remove" type="button" title="Remove this lower third"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="cd-button__text">Remove</span></button>
     </div>`;

  function mount({ rows, add, onChange, defaults }) {
    const D = { start: 10, duration: 4, align: "left", ...(defaults || {}) };
    const changed = () => { if (typeof onChange === "function") onChange(); };

    function addRow(v) {
      v = v || {};
      const row = document.createElement("div");
      row.className = "lt-row";
      row.innerHTML = TEMPLATE;
      const q = (sel) => row.querySelector(sel);

      q(".lt-name").value = v.name || "";
      q(".lt-org").value = v.org || "";
      q(".lt-org2").value = v.org2 || "";
      const tf = q(".timefield__input"), df = q(".durfield__input");
      tf.value = mmss(Number.isFinite(v.start) ? v.start : D.start);
      df.value = String(Number.isFinite(v.duration) ? v.duration : D.duration);
      q(".lt-align").value = v.align || D.align;

      const setTf = (s) => { tf.value = mmss(Math.max(0, s)); changed(); };
      tf.addEventListener("blur", () => setTf(secs(tf.value)));
      q(".timefield__up").onclick = () => setTf(secs(tf.value) + 1);
      q(".timefield__down").onclick = () => setTf(secs(tf.value) - 1);
      const setDf = (n) => { df.value = String(Math.max(1, Math.round(n || 1))); changed(); };
      df.addEventListener("blur", () => setDf(parseFloat(df.value)));
      q(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
      q(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);

      row.addEventListener("input", changed);
      row.addEventListener("change", changed);
      q(".lt-remove").onclick = () => { row.remove(); changed(); };
      rows.appendChild(row);
      return row;
    }

    function collect() {
      return [...rows.querySelectorAll(".lt-row")].map((r) => ({
        name: r.querySelector(".lt-name").value.trim(),
        org: r.querySelector(".lt-org").value.trim(),
        org2: r.querySelector(".lt-org2").value.trim(),
        start: secs(r.querySelector(".timefield__input").value),
        duration: parseFloat(r.querySelector(".durfield__input").value) || D.duration,
        align: r.querySelector(".lt-align").value,
      })).filter((l) => l.name);                    // a nameless row renders nothing
    }

    function restore(list) {
      rows.innerHTML = "";
      (Array.isArray(list) ? list : []).forEach(addRow);
      ensure();
    }

    function ensure() {                             // always leave one row to type into
      if (!rows.querySelectorAll(".lt-row").length) addRow();
    }

    if (add) add.onclick = () => { addRow(); changed(); };
    return { addRow, collect, restore, ensure };
  }

  return { mount };
})();
