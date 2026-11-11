/* OCHA QuickVid — ending logo position: the SHARED component.
 *
 * Both tabs use this one file ("Edit a video" and "Titles & branding" Ending).
 * House rule (Javier, 11 Nov 2026): the logo is CENTRED by default; if that
 * would land on a face, the alternatives are "top_right" here, or the Over black
 * ending. There is deliberately no free height slider any more.
 *
 * Shown only for the Over footage ending — over black there is nothing to avoid.
 * Where the logo actually goes is decided in ONE place, engine/ending.py
 * logo_xy(); this only picks which.
 *
 * Usage:
 *   const lp = OchaLogoPos.mount({
 *     host: document.querySelector("#t-logopos"),  // empty container
 *     ending: "ending",                            // name of the ending radios
 *     onChange: save,                              // autosave
 *   });
 *   lp.get();          // -> "centre" | "top_right"
 *   lp.restore(v);     // anything else (incl. missing) -> "centre"
 *   lp.watch();        // inputs a preview should re-render on
 *
 * Load this BEFORE app.js / statement.js.
 */
const OchaLogoPos = (() => {
  const OPTIONS = [
    { value: "centre", label: "Centred", hint: "The standard." },
    { value: "top_right", label: "Top right",
      hint: "When the centred logo would sit on a face. Or use Over black." },
  ];

  function mount({ host, ending, onChange }) {
    const name = `${host.id}-opt`;
    // the `hidden` gate sits on the HOST, a plain div — never on an element whose
    // CSS sets display (.opt-card, .st-check), or `hidden` would lose.
    host.setAttribute("role", "radiogroup");
    host.setAttribute("aria-labelledby", `${host.id}-lbl`);
    host.innerHTML =
      `<p class="cd-form__label" id="${host.id}-lbl">Logo position</p>` +
      `<div class="opt-grid">` +
      OPTIONS.map((o, i) =>
        `<div class="opt-card">` +
        `<label class="st-check"><input type="radio" name="${name}" value="${o.value}"${i ? "" : " checked"} /> ${o.label}</label>` +
        `<p class="opt-card__hint">${o.hint}</p></div>`).join("") +
      `</div>`;
    const radios = () => [...host.querySelectorAll(`input[name="${name}"]`)];
    const endingRadios = () => [...document.querySelectorAll(`input[name="${ending}"]`)];
    const vis = () => {
      const st = (endingRadios().find((r) => r.checked) || {}).value;
      host.hidden = st !== "over_footage";
    };
    radios().forEach((r) => r.addEventListener("change", () => onChange && onChange()));
    endingRadios().forEach((r) => r.addEventListener("change", vis));
    vis();
    return {
      get: () => (radios().find((r) => r.checked) || {}).value || "centre",
      restore(v) {
        const want = OPTIONS.some((o) => o.value === v) ? v : "centre";
        radios().forEach((r) => { r.checked = r.value === want; });
        vis();
      },
      watch: radios,
    };
  }

  return { mount };
})();
