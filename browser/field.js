/* OCHA QuickVid — the required project-folder field, SHARED by both tabs.
 *
 * Both "Edit a video" and "Titles & branding" write everything into a job folder
 * (<folder>/export/, source/, info/ … plus the autosaved project file), so both
 * refuse to start work until one is chosen. This file owns that behaviour so the
 * two tabs can't drift: change the wording, the styling hook or the a11y here and
 * both move together.
 *
 * The markup contract is the same on both tabs — a `.st-folder` block containing
 * the name <input> and a `.field-err` message — so the helper derives everything
 * from the block element and no ids need passing in.
 *
 * Load this BEFORE app.js / statement.js.
 */
const OchaFolder = {
  /* Paint (or clear) the "you haven't picked one" state on a folder block. */
  mark(box, on) {
    if (!box) return;
    box.classList.toggle("is-missing", !!on);
    const err = box.querySelector(".field-err");
    if (err) err.hidden = !on;
    const input = box.querySelector("input");
    if (input) input.setAttribute("aria-invalid", on ? "true" : "false");
  },

  /* Guard an action. Returns TRUE when the caller should stop.
     Marks the block, scrolls it into view and focuses the name field, so the
     error and the thing to fix are on screen together — a status line further
     down the page on its own gets missed. */
  block(box, jobDir, say) {
    if (jobDir) { this.mark(box, false); return false; }   // also clears a stale red
    this.mark(box, true);
    if (typeof say === "function") {
      say("Choose a project folder first — everything for this job is saved inside it.");
    }
    if (box) {
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = box.querySelector("input");
      if (input) input.focus();
    }
    return true;
  },
};
