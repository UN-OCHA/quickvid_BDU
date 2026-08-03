/* OCHA QuickVid — caption editor, the SHARED component.
 *
 * Both tabs mount this ONE implementation (like field.js / location.js /
 * lowerthird.js): the Edit tab previews the cues of the current cut, the Titles
 * tab the cues of the finished clip. Fix a behaviour here and both tabs move.
 *
 * Contract:
 *   const caps = OchaCaptions.mount({ list, status, onChange })
 *     list     – container element the rows render into
 *     status   – small element for state text ("12 captions — edit any line…")
 *     onChange – called on every edit (both tabs use it for project autosave)
 *   caps.setCues(cues, fingerprint) – show [[start, text], …]; fingerprint is an
 *       opaque string of the INPUTS the cues were built from (video path,
 *       selection, preset). collect() only returns cues while it still matches —
 *       change the cut and stale edits silently step aside for fresh automatic
 *       captions instead of burning misaligned text.
 *   caps.collect(currentFingerprint) – [[start, text], …] or null (not generated
 *       / stale / untouched-empty). Empty text = that caption is dropped (the
 *       renderer treats "" as a boundary), so a line can be deleted by clearing it.
 *   caps.clear(msg?) – forget everything (video/selection changed).
 *   caps.has() / caps.stale(fp) – for status messages at render time.
 */
const OchaCaptions = (() => {
  "use strict";

  const mmss = (sec) => {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  };

  // local, not app.js's — a shared module shouldn't depend on load order
  const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  function mount({ list, status, onChange }) {
    let cues = null;          // [[start, text], …] or null = not generated
    let fp = null;            // fingerprint of the inputs the cues came from
    // The shape the RENDER will use. Until this arrives we fall back to the
    // narrowest preset's budget, so we never promise more room than exists.
    let shape = { budget: 65, box: true };

    const setStatus = (t) => { if (status) status.textContent = t || ""; };

    /* Wrap the way the renderer does: greedily fill line 1 to half the two-line
       budget, the rest goes to line 2. Anything past that is what the engine
       SPLITS into another caption — so the editor shows the same shape, and you
       can see whether to regroup before rendering. */
    function wrapTwo(text, budget) {
      const words = String(text).trim().split(/\s+/).filter(Boolean);
      const per = Math.ceil(budget / 2);
      const lines = ["", ""];
      let li = 0, over = [];
      for (const w of words) {
        if (li < 2) {
          const next = lines[li] ? lines[li] + " " + w : w;
          if (next.length <= per || !lines[li]) { lines[li] = next; continue; }
          li += 1;
          if (li < 2) { lines[li] = w; continue; }
        }
        over.push(w);
      }
      return { lines, over: over.join(" ") };
    }

    function render() {
      list.innerHTML = "";
      (cues || []).forEach((cue, i) => {
        const row = document.createElement("div");
        row.className = "cap-row";
        const t = document.createElement("span");
        t.className = "cap-time";
        t.textContent = mmss(cue[0]);

        const wrap = document.createElement("div");
        wrap.className = "cap-edit";
        const inp = document.createElement("textarea");
        inp.className = "cd-form__input cap-input";
        inp.rows = 2;
        inp.value = cue[1];

        // A live preview in the caption's real shape, under the field.
        const prev = document.createElement("div");
        prev.className = "cap-preview" + (shape.box ? " cap-preview--box" : "");
        const note = document.createElement("p");
        note.className = "cap-note";

        const paint = () => {
          const { lines, over } = wrapTwo(inp.value, shape.budget);
          prev.innerHTML = `<span>${esc(lines[0] || "")}</span><span>${esc(lines[1] || "")}</span>`;
          prev.hidden = !inp.value.trim();
          if (over) {
            note.textContent = "Too long for two lines — the render will split this into another caption.";
            note.className = "cap-note is-over";
          } else if (inp.value.trim() && inp.value.trim().length < 12) {
            note.textContent = "Very short — the render may merge this with the next one.";
            note.className = "cap-note is-soft";
          } else { note.textContent = ""; note.className = "cap-note"; }
        };

        inp.addEventListener("input", () => {
          cues[i][1] = inp.value;
          paint();
          onChange && onChange();
        });
        paint();
        wrap.append(inp, prev, note);
        row.append(t, wrap);
        list.append(row);
      });
      list.hidden = !cues || !cues.length;
    }

    /* Ask the engine for the real caption shape for this format. */
    async function setShape(engine, preset) {
      try {
        const r = await fetch(`${engine}/api/statement/caption-shape?preset=${encodeURIComponent(preset || "reels")}`);
        if (r.ok) { shape = await r.json(); render(); }
      } catch (e) { /* keep the conservative fallback */ }
    }

    return {
      setShape,
      setCues(next, fingerprint) {
        cues = (next || []).map(([s, t]) => [s, String(t)]);
        fp = fingerprint || null;
        render();
        setStatus(cues.length
          ? `${cues.length} caption${cues.length === 1 ? "" : "s"} — fix any mis-heard words below. `
            + "Timing stays automatic; clear a line to drop that caption."
          : "No speech found to caption.");
        onChange && onChange();
      },
      clear(msg) {
        cues = null; fp = null;
        list.innerHTML = ""; list.hidden = true;
        setStatus(msg || "");
        onChange && onChange();
      },
      collect(currentFp) {
        if (!cues || !cues.length) return null;
        if (fp !== (currentFp || null)) return null;    // stale — let the engine rebuild
        return cues.map(([s, t]) => [s, t.trim()]);
      },
      has: () => !!(cues && cues.length),
      stale: (currentFp) => !!(cues && cues.length) && fp !== (currentFp || null),
    };
  }

  return { mount };
})();
