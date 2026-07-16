/* ============================================================================
   OCHA Branding — Premiere UXP panel.
   Picks the MOGRT that matches the active sequence's format, drops it at the
   playhead on a fresh top track, and best-effort fills the text fields. All 16
   MOGRTs are bundled in ./mogrts (built by premiere/ae/make_assets.py).
   API confirmed against developer.adobe.com/premiere-pro/uxp (25.6).
   ============================================================================ */
const ppro = require("premierepro");
const { entrypoints, storage } = require("uxp");

// element key -> MOGRT base name (filenames: "<base> - <format label>.mogrt")
const EL = { lt: "OCHA Lower Third", loc: "OCHA Location", bug: "OCHA Bug", ending: "OCHA Ending" };
// format key -> { folder, label }  (label must match the exported filenames exactly)
const FMT = {
  reels:  { folder: "reels",  label: "Reels 9x16" },
  feed45: { folder: "feed45", label: "Feed 4x5" },
  square: { folder: "square", label: "Square 1x1" },
  event:  { folder: "event",  label: "Event 16x9" },
};
// which EGP text controls each element fills (control display name -> input id)
const TEXT = {
  lt:  { "Name": "lt-name", "Title": "lt-title", "Title line 2 (optional)": "lt-title2" },
  loc: { "Place": "loc-place", "Date": "loc-date" },
  bug: {}, ending: {},
};

const $ = (id) => document.getElementById(id);
let curEl = "lt";
let curFmt = null;
let pinColour = "red";

// -------- format detection --------------------------------------------------
function fmtFromSize(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  if (r <= 0.66) return "reels";       // 9:16 = 0.5625
  if (r < 0.92)  return "feed45";      // 4:5 = 0.80
  if (r <= 1.12) return "square";      // 1:1
  return "event";                       // 16:9 = 1.78
}

async function activeSequence() {
  const project = await ppro.Project.getActiveProject();
  if (!project) return { project: null, seq: null };
  const seq = await project.getActiveSequence();
  return { project, seq };
}

async function refresh() {
  const badge = $("fmt");
  try {
    const { seq } = await activeSequence();
    if (!seq) { curFmt = null; badge.textContent = "no sequence"; badge.className = "badge badge--muted"; $("add").disabled = true; return; }
    const rect = await seq.getFrameSize();
    const w = rect.width != null ? rect.width : (rect.right - rect.left);
    const h = rect.height != null ? rect.height : (rect.bottom - rect.top);
    curFmt = fmtFromSize(w, h);
    if (curFmt) { badge.textContent = `${Math.round(w)}×${Math.round(h)} · ${FMT[curFmt].label}`; badge.className = "badge badge--ok"; $("add").disabled = false; }
    else { badge.textContent = `${Math.round(w)}×${Math.round(h)} · unsupported`; badge.className = "badge badge--muted"; $("add").disabled = true; }
  } catch (e) { curFmt = null; badge.textContent = "no sequence"; badge.className = "badge badge--muted"; $("add").disabled = true; }
}

// -------- path to a bundled MOGRT ------------------------------------------
async function mogrtPath(elKey, fmtKey) {
  const folder = await storage.localFileSystem.getPluginFolder();
  const f = FMT[fmtKey];
  return `${folder.nativePath}/mogrts/${f.folder}/${EL[elKey]} - ${f.label}.mogrt`;
}

// -------- best-effort text autofill ----------------------------------------
// Enumerate the inserted clip's components/params, match display names to our
// TEXT map, set them in one transaction. Returns {set:[names], seen:[names]}.
async function fillText(project, item, wanted) {
  const seen = [], set = [];
  const targets = [];
  const chain = await item.getComponentChain();
  const nComp = await chain.getComponentCount();
  for (let c = 0; c < nComp; c++) {
    const comp = await chain.getComponentAtIndex(c);
    for (let p = 0; p < 60; p++) {              // no getParamCount() — probe with a guard
      let param;
      try { param = comp.getParam(p); } catch (e) { break; }
      if (!param) break;
      let name = "";
      try { name = (await param.getDisplayName()) || ""; } catch (e) {}
      if (!name) continue;
      seen.push(name);
      const key = Object.keys(wanted).find((k) => k.toLowerCase() === name.trim().toLowerCase());
      if (key && wanted[key] != null && wanted[key] !== "") { targets.push({ param, value: String(wanted[key]) }); set.push(name); }
    }
  }
  if (targets.length) {
    project.lockedAccess(() => {
      project.executeTransaction((compound) => {
        for (const t of targets) {
          const kf = t.param.createKeyframe(t.value);
          compound.addAction(t.param.createSetValueAction(kf, true));
        }
      }, "OCHA Branding: set text");
    });
  }
  return { set, seen };
}

// -------- insert ------------------------------------------------------------
async function addElement() {
  const status = $("status");
  const show = (msg, kind) => { status.hidden = false; status.className = "status status--" + kind; status.innerHTML = msg; };
  try {
    const { project, seq } = await activeSequence();
    if (!seq) return show("Open a sequence first.", "warn");
    if (!curFmt) return show("This sequence size isn’t one of the OCHA formats (9:16, 4:5, 1:1, 16:9).", "warn");

    const path = await mogrtPath(curEl, curFmt);
    const playhead = await seq.getPlayerPosition();
    const vTrack = await seq.getVideoTrackCount();      // new track on top → branding stays separate
    const aTrack = curEl === "ending" ? await seq.getAudioTrackCount() : 0;
    const editor = ppro.SequenceEditor.getEditor(seq);
    const items = await editor.insertMogrtFromPath(path, playhead, vTrack, aTrack);
    const clip = Array.isArray(items) ? items[0] : items;
    if (!clip) return show("Couldn’t insert the graphic — is the sequence targeted/unlocked?", "err");

    // gather the text the user typed
    const wanted = {};
    for (const [ctrl, id] of Object.entries(TEXT[curEl])) { const v = ($(id) && $(id).value || "").trim(); if (v) wanted[ctrl] = v; }

    let note = "";
    if (Object.keys(wanted).length) {
      try {
        const r = await fillText(project, clip, wanted);
        note = r.set.length ? ` Filled: ${r.set.join(", ")}.` : ` (Type the text in Essential Graphics — I saw controls: ${r.seen.slice(0, 8).join(", ") || "none"}.)`;
      } catch (e) { note = " (Inserted — type the text in Essential Graphics.)"; }
    }
    show(`Added <strong>${EL[curEl]}</strong> (${FMT[curFmt].label}) at the playhead.${note}`, "ok");
  } catch (e) {
    show("Error: " + (e && e.message ? e.message : e), "err");
  }
}

// -------- UI wiring ---------------------------------------------------------
function selectEl(el) {
  curEl = el;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.el === el));
  document.querySelectorAll(".form").forEach((f) => { f.hidden = f.dataset.form !== el; });
  $("status").hidden = true;
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectEl(t.dataset.el)));
document.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => {
  pinColour = p.dataset.col;
  document.querySelectorAll(".pill").forEach((q) => q.classList.toggle("is-active", q === p));
}));
$("add").addEventListener("click", addElement);

entrypoints.setup({ panels: { ochaBrandingPanel: { show() { refresh(); } } } });
refresh();
setInterval(refresh, 2500);   // keep the format badge current as the user switches sequences
