/* OCHA QuickVid — location strip (pin locator): the SHARED component.
 *
 * Both tabs use this one file: "Edit a video" step 7 and "Titles & branding"
 * step 5. Before this, each tab had its own copy of the markup, the colour
 * toggle, the spinners and the collector — so a fix on one side silently left
 * the other behind. Change the location strip HERE and both tabs get it.
 *
 * The engine side is shared the same way: pin_locator.specs() is the single
 * reader of a render spec, called by both finish.py and social_brand.py.
 *
 * Usage:
 *   const loc = OchaLocation.mount({
 *     rows: document.querySelector("#t-loc-rows"),   // container for the cards
 *     add:  document.querySelector("#t-loc-add"),    // "Add a location" button
 *     onChange: save,                                // called on every edit (autosave)
 *   });
 *   loc.collect();          // -> [{on, place, date, icon, color, start, duration}, …]
 *   loc.restore(list);      // list, a legacy single object, or null — all accepted
 *
 * Load this BEFORE app.js / statement.js.
 */
const OchaLocation = (() => {
  const START_DEFAULT = 4;        // seconds — matches pin_locator.DEFAULT_START
  const DUR_DEFAULT = 5;
  const DUR_MIN = 2;              // below this the in/out animations collide

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

  /* One card = one strip on screen. Mirrors the lower-third card (.lt-row) so
     it's obvious the fields belong together once there's more than one. */
  const TEMPLATE = `
    <div class="loc-fields">
      <label>Place <em>top line</em>
        <input class="cd-form__input loc-place" placeholder="e.g. Ankara, Türkiye" autocomplete="off" /></label>
      <label>Date <em>bottom line</em>
        <input class="cd-form__input loc-date" placeholder="e.g. June 2026" autocomplete="off" /></label>
    </div>
    <div class="loc-meta">
      <span class="loc-cell loc-cell--start"><span class="lt-cap">Start</span>
        <span class="timefield">
          <input class="cd-form__input timefield__input loc-start" type="text" inputmode="numeric"
                 maxlength="5" aria-label="Start time (mm:ss)" title="When the strip animates in (mm:ss)" />
          <span class="timefield__spin">
            <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
            <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
          </span>
        </span>
      </span>
      <span class="loc-cell loc-cell--dur"><span class="lt-cap">Duration</span>
        <span class="timefield">
          <input class="cd-form__input durfield__input loc-dur" type="text" inputmode="numeric"
                 maxlength="3" aria-label="Duration in seconds" title="Seconds on screen" />
          <span class="durfield__unit" aria-hidden="true">sec</span>
          <span class="timefield__spin">
            <button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button>
            <button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button>
          </span>
        </span>
      </span>
      <span class="loc-cell loc-cell--colour"><span class="lt-cap">Pin colour</span>
        <span class="loc-colour" role="group" aria-label="Pin colour">
          <button type="button" class="cd-button cd-button--small loc-red"><span class="cd-button__text">Red</span></button>
          <button type="button" class="cd-button cd-button--small cd-button--outline loc-blue"><span class="cd-button__text">Blue</span></button>
        </span>
      </span>
      <label class="st-check loc-icon-check"><input type="checkbox" class="loc-icon" checked /> Show the pin icon</label>
      <button class="cd-button cd-button--outline cd-button--small loc-remove" type="button" title="Remove this location strip">
        <i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="cd-button__text">Remove</span>
      </button>
    </div>`;

  function mount({ rows, add, onChange }) {
    const changed = () => { if (typeof onChange === "function") onChange(); };

    function addRow(v) {
      v = v || {};
      const row = document.createElement("div");
      row.className = "loc-row";
      row.innerHTML = TEMPLATE;
      const q = (sel) => row.querySelector(sel);

      q(".loc-place").value = v.place || "";
      q(".loc-date").value = v.date || "";
      q(".loc-icon").checked = v.icon !== false;                  // icon on by default
      const tf = q(".loc-start"), df = q(".loc-dur");
      tf.value = mmss(Number.isFinite(v.start) ? v.start : START_DEFAULT);
      df.value = String(Number.isFinite(v.duration) ? v.duration : DUR_DEFAULT);

      // colour is a 2-button toggle; the row remembers its own choice
      const setColour = (c) => {
        row.dataset.colour = c === "blue" ? "blue" : "red";
        q(".loc-red").classList.toggle("cd-button--outline", row.dataset.colour !== "red");
        q(".loc-blue").classList.toggle("cd-button--outline", row.dataset.colour !== "blue");
      };
      setColour(v.color);
      q(".loc-red").onclick = () => { setColour("red"); changed(); };
      q(".loc-blue").onclick = () => { setColour("blue"); changed(); };

      const setTf = (s) => { tf.value = mmss(Math.max(0, s)); changed(); };
      tf.addEventListener("blur", () => setTf(secs(tf.value)));
      q(".timefield__up").onclick = () => setTf(secs(tf.value) + 1);
      q(".timefield__down").onclick = () => setTf(secs(tf.value) - 1);

      const setDf = (n) => { df.value = String(Math.max(DUR_MIN, Math.round(n || DUR_MIN))); changed(); };
      df.addEventListener("blur", () => setDf(parseFloat(df.value)));
      q(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
      q(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);

      row.addEventListener("input", changed);
      q(".loc-remove").onclick = () => { row.remove(); changed(); };
      rows.appendChild(row);
      return row;
    }

    function collect() {
      return [...rows.querySelectorAll(".loc-row")].map((r) => ({
        // `on` per row: a strip exists because the user added its card, so the
        // only way to have one is to want it. Empty cards are dropped below.
        on: true,
        place: r.querySelector(".loc-place").value.trim(),
        date: r.querySelector(".loc-date").value.trim(),
        icon: r.querySelector(".loc-icon").checked,
        color: r.dataset.colour === "blue" ? "blue" : "red",
        start: secs(r.querySelector(".loc-start").value),
        duration: parseFloat(r.querySelector(".loc-dur").value) || DUR_DEFAULT,
      })).filter((p) => p.place || p.date);        // a blank card renders nothing
    }

    /* Accepts the new list, a legacy single {on,…} object (projects saved before
       Jul 2026), or nothing. An `on:false` legacy pin restores as no cards. */
    function restore(saved) {
      rows.innerHTML = "";
      let list = saved;
      if (!list) list = [];
      else if (!Array.isArray(list)) list = list.on ? [list] : [];
      list.forEach(addRow);
    }

    if (add) add.onclick = () => { addRow(); changed(); };
    return { addRow, collect, restore, count: () => rows.querySelectorAll(".loc-row").length };
  }

  return { mount, mmss, secs, START_DEFAULT, DUR_DEFAULT };
})();
