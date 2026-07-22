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

  function mount({ list, status, onChange }) {
    let cues = null;          // [[start, text], …] or null = not generated
    let fp = null;            // fingerprint of the inputs the cues came from

    const setStatus = (t) => { if (status) status.textContent = t || ""; };

    function render() {
      list.innerHTML = "";
      (cues || []).forEach((cue, i) => {
        const row = document.createElement("div");
        row.className = "cap-row";
        const t = document.createElement("span");
        t.className = "cap-time";
        t.textContent = mmss(cue[0]);
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "cd-form__input";
        inp.value = cue[1];
        inp.addEventListener("input", () => {
          cues[i][1] = inp.value;
          onChange && onChange();
        });
        row.append(t, inp);
        list.append(row);
      });
      list.hidden = !cues || !cues.length;
    }

    return {
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
