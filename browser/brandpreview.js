/* OCHA QuickVid — "show it on MY video", SHARED by both tabs.
 *
 * Upgrades a static example thumbnail (<figure class="ex-thumb">) into a live
 * preview: the real branding, composited by the real render engine, over a real
 * frame of the user's own footage.
 *
 * THE PREVIEW IS NOT DRAWN HERE. This module posts a spec to
 * /api/brand-preview and shows the JPEG that comes back; the picture is produced
 * by engine/brand_preview.py running the production overlay graph. Do NOT be
 * tempted to "just" draw the lower third in HTML and CSS instead — that is a
 * second implementation of the OCHA brand, and it will drift from the export.
 * browser/brand-lt.json exists because exactly that happened once already.
 *
 * Until a video is chosen, the static example stays: it is the correct picture of
 * what the element looks like, and it needs no engine.
 *
 * Load BEFORE app.js / statement.js.
 */
const OchaBrandPreview = {
  /* Every mounted preview, so "the video changed" can refresh them all at once. */
  _all: [],

  refreshAll() { this._all.forEach((p) => p.refresh()); },

  /* figure    — the <figure class="ex-thumb"> to upgrade
     getVideo  — () => absolute path of the chosen source, or falsy
     getTime   — () => seconds into the source to sample (same contract as OchaLook)
     engine    — engine base URL
     canvas    — () => [W, H] or null (null = keep the source's own size)
     collect   — () => the spec fragment for THIS section, e.g. {lower_thirds: [...]}
                 Return null to say "nothing to show" and keep the example.
     base      — () => bits shared by every section: {look, rtl, subtitle}
     watch     — elements (or a function returning them) whose edits re-render */
  mount(cfg) {
    const fig = cfg.figure;
    if (!fig) return { refresh() {} };
    const img = fig.querySelector("img");
    if (!img) return { refresh() {} };

    const exampleSrc = img.getAttribute("src");
    const exampleCap = (fig.querySelector("figcaption") || {}).textContent || "";
    // the example JPEGs carry intrinsic width/height; a live frame of a different
    // shape would be letterboxed into them
    img.removeAttribute("width");
    img.removeAttribute("height");

    const bar = document.createElement("div");
    bar.className = "bp-bar";
    const note = document.createElement("span");
    note.className = "app-hint bp-note";
    const another = document.createElement("button");
    another.type = "button";
    another.className = "cd-button cd-button--outline cd-button--small bp-another";
    another.innerHTML = '<i class="fa-regular fa-arrows-rotate" aria-hidden="true"></i>'
                      + '<span class="cd-button__text">Another frame</span>';
    another.hidden = true;
    bar.append(note, another);
    fig.append(bar);

    const P = {
      _timer: null,
      _ctrl: null,
      _url: null,
      _nudge: 0,              // extra seconds, so "Another frame" can walk forward
      _live: false,

      /* Back to the shipped example — no video, nothing entered, or a failure.
         Always via this one path so the two states can't get out of step.

         Sections whose example changes with a setting (the subtitle style picker
         swaps between the boxed and the clean example) pass `cfg.example`; it is
         the ONE place that paints the example, so the picker doesn't have to
         fight the live preview for the same <img>. */
      _example(msg) {
        if (P._url) { URL.revokeObjectURL(P._url); P._url = null; }
        const ex = (cfg.example && cfg.example()) || { src: exampleSrc, caption: exampleCap };
        img.src = ex.src;
        if (ex.width) { img.width = ex.width; img.height = ex.height; }
        const cap = fig.querySelector("figcaption");
        if (cap) cap.textContent = ex.caption || "";
        another.hidden = true;
        P._live = false;
        note.textContent = msg || "";
      },

      refresh() {
        clearTimeout(P._timer);
        P._timer = setTimeout(P._run, 400);       // debounce: this runs ffmpeg
      },

      async _run() {
        // Off-screen sections must not run ffmpeg: the other tab's ten previews
        // would all fire on a shared input. offsetParent (not computed display) —
        // a visible child of a hidden parent still reports display:block.
        if (fig.offsetParent === null) return;
        const video = cfg.getVideo && cfg.getVideo();
        if (!video) return P._example("Pick a video to see this on your own footage.");
        const own = cfg.collect ? cfg.collect() : null;
        if (!own) return P._example("");

        if (P._ctrl) P._ctrl.abort();              // supersede the in-flight one
        P._ctrl = new AbortController();
        note.textContent = "Rendering a preview…";

        const shared = (cfg.base && cfg.base()) || {};
        // `atEnd` sections (the ending logo) preview the LAST frames, because that is
        // where the element actually appears — a mid-clip frame answers the wrong
        // question. They also drop "Another frame": there is only one right frame.
        const endT = cfg.atEnd && cfg.getDuration ? cfg.getDuration() : null;
        const t = endT != null && endT > 0
          ? Math.max(0, endT - 0.1)                      // ~3rd-last frame at 30fps
          : Math.max(0, (cfg.getTime ? cfg.getTime() : 1) + P._nudge);
        const body = {
          video, t,
          canvas: (cfg.canvas && cfg.canvas()) || null,
          look: shared.look || null,
          rtl: shared.rtl === undefined ? null : shared.rtl,
          subtitle: shared.subtitle || null,
          width: 720,
          ...own,
        };
        try {
          const r = await fetch(cfg.engine + "/api/brand-preview", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body), signal: P._ctrl.signal,
          });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "preview failed");
          const blob = await r.blob();
          if (P._url) URL.revokeObjectURL(P._url);
          P._url = URL.createObjectURL(blob);
          // an example may have set intrinsic dims; a live frame is a different shape
          img.removeAttribute("width");
          img.removeAttribute("height");
          img.src = P._url;
          const cap = fig.querySelector("figcaption");
          if (cap) cap.textContent = "Your footage, with the real OCHA branding — exactly what will be exported.";
          another.hidden = !!cfg.atEnd;   // one right frame — nothing to cycle through
          P._live = true;
          note.textContent = "";
        } catch (e) {
          if (e.name === "AbortError") return;     // a newer request won; say nothing
          P._example("Couldn't render a preview — the example is shown instead.");
        }
      },
    };

    another.onclick = () => { P._nudge += 7; P._run(); };

    const wired = new Set();
    const wire = () => {
      const els = typeof cfg.watch === "function" ? (cfg.watch() || []) : (cfg.watch || []);
      els.forEach((el) => {
        if (!el || wired.has(el)) return;
        wired.add(el);
        el.addEventListener("input", P.refresh);
        el.addEventListener("change", P.refresh);
      });
    };
    // Rows are added and removed at runtime (lower thirds, text blocks), so
    // re-wire on every refresh rather than only at mount.
    const outer = P.refresh;
    P.refresh = function () { wire(); outer(); };
    wire();

    OchaBrandPreview._all.push(P);
    return P;
  },
};
