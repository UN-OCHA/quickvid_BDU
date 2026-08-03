/* Waiting lines for the long steps — SHARED by both tabs.
 *
 * Transcription and rendering take minutes on a modest laptop, and a bar that
 * barely moves reads as "it has frozen". A calm line every few seconds says the
 * machine is still working and it is fine to walk away.
 *
 * Tone: this is the UN. Dry, brief, never jokey, never a pun about the content —
 * the footage is often an emergency. Nothing here refers to the video at all.
 *
 * Rules:
 *  - long steps only (transcribe / render / bake). Never on a step under ~10s,
 *    because a line that flashes once is just noise.
 *  - never during an error, and never after "done".
 *  - the step's own progress text always wins; this is an ADDITION under it.
 */
window.OchaWaiting = (function () {
  const LINES = [
    "This one takes a few minutes — a good moment for a coffee.",
    "Still working. Nothing has gone wrong.",
    "You can leave this open and come back to it.",
    "Your video is being processed on this computer — nothing is being uploaded.",
    "Time for a short break.",
    "Almost always faster than doing it by hand.",
    "Still going. Long recordings take longer, as you would expect.",
  ];
  const FIRST_MS = 12000;      // nothing at all for the first 12s — short jobs stay quiet
  const EVERY_MS = 9000;

  function start(el) {
    if (!el) return { stop() {} };
    let i = -1, timer = null, started = false;
    const tick = () => {
      // Deterministic rotation, not random: two lines in a row that both say
      // "still going" would read as a stuck screen.
      i = (i + 1) % LINES.length;
      el.textContent = LINES[i];
      el.hidden = false;
    };
    const begin = setTimeout(() => { started = true; tick(); timer = setInterval(tick, EVERY_MS); }, FIRST_MS);
    return {
      stop() {
        clearTimeout(begin);
        if (timer) clearInterval(timer);
        el.textContent = "";
        el.hidden = true;
        return started;
      },
    };
  }
  return { start, LINES };
})();
