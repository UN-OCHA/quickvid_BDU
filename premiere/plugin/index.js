/* ============================================================================
   OCHA Branding — Premiere UXP panel (v0.2).
   Auto-picks the MOGRT matching the active sequence's format, inserts at the
   playhead (track-index ladder — insertMogrtFromPath doesn't auto-create
   tracks), then best-effort fills the Essential Graphics text controls.
   UXP notes baked in: [hidden] isn't styled (panes toggle via classes) and
   Component.getParam returns a Promise on 26.x (probe awaits + tolerates gaps).
   ============================================================================ */
const ppro = require("premierepro");
const { entrypoints, storage } = require("uxp");

const EL = { lt: "OCHA Lower Third", loc: "OCHA Location", bug: "OCHA Bug", ending: "OCHA Ending" };
const FMT = {
  reels:  { folder: "reels",  label: "Reels 9x16" },
  feed45: { folder: "feed45", label: "Feed 4x5" },
  square: { folder: "square", label: "Square 1x1" },
  event:  { folder: "event",  label: "Event 16x9" },
};
// EGP control display-name -> input id (text autofill)
const TEXT = {
  lt:  { "Name": "lt-name", "Title": "lt-title", "Title line 2 (optional)": "lt-title2" },
  loc: { "Place": "loc-place", "Date": "loc-date" },
  bug: {}, ending: {},
};

const $ = (id) => document.getElementById(id);
let curEl = "lt";
let curFmt = null;

/* ---------------- format detection ---------------- */
function fmtFromSize(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  if (r <= 0.66) return "reels";
  if (r < 0.92)  return "feed45";
  if (r <= 1.12) return "square";
  return "event";
}

async function activeSequence() {
  const project = await ppro.Project.getActiveProject();
  if (!project) return { project: null, seq: null };
  const seq = await project.getActiveSequence();
  return { project, seq };
}

async function refresh() {
  const chip = $("fmt");
  try {
    const { seq } = await activeSequence();
    if (!seq) throw new Error("none");
    const rect = await seq.getFrameSize();
    const w = rect.width != null ? rect.width : (rect.right - rect.left);
    const h = rect.height != null ? rect.height : (rect.bottom - rect.top);
    curFmt = fmtFromSize(w, h);
    if (curFmt) {
      chip.textContent = `${Math.round(w)}×${Math.round(h)} · ${FMT[curFmt].label}`;
      chip.className = "chip is-ok";
      $("add").disabled = false;
    } else {
      chip.textContent = `${Math.round(w)}×${Math.round(h)} — unsupported`;
      chip.className = "chip";
      $("add").disabled = true;
    }
  } catch (e) {
    curFmt = null;
    chip.textContent = "no sequence";
    chip.className = "chip";
    $("add").disabled = true;
  }
}

/* ---------------- status ---------------- */
function show(msg, kind) {
  const s = $("status");
  s.className = "status status--" + kind;
  s.innerHTML = msg;
}
function hideStatus() { $("status").className = "status is-off"; }

/* ---------------- bundled mogrt path ---------------- */
function mogrtRel(elKey, fmtKey) {
  return `mogrts/${FMT[fmtKey].folder}/${EL[elKey]} - ${FMT[fmtKey].label}.mogrt`;
}
async function mogrtPath(elKey, fmtKey) {
  const folder = await storage.localFileSystem.getPluginFolder();
  return `${folder.nativePath}/${mogrtRel(elKey, fmtKey)}`;
}

/* ---------------- text autofill ----------------
   Walk the inserted clip's components; match param display names to the panel
   fields (case-insensitive); set all matches in one undo step. getParam is a
   Promise on 26.x and indexes can be sparse — await everything, tolerate gaps. */
async function fillText(project, item, wanted) {
  const seen = [], set = [], targets = [], dbg = [];
  let chain = null;
  try { chain = await item.getComponentChain(); } catch (e) { dbg.push("chain: " + (e.message || e)); }
  if (!chain) return { set, seen, dbg: dbg.join(" · ") || "no component chain" };

  let nComp = 0;
  try { nComp = await chain.getComponentCount(); } catch (e) { dbg.push("count: " + (e.message || e)); }
  dbg.push("comps=" + nComp);

  // Component/param handles must be grabbed SYNCHRONOUSLY inside lockedAccess
  // (Adobe's premiere-api sample does exactly this). Probe a few indexes even
  // if the count reports 0 — counts have been unreliable on 26.x betas.
  const found = [], comps = [];
  project.lockedAccess(() => {
    const maxC = Math.max(Number(nComp) || 0, 6);
    for (let c = 0; c < maxC; c++) {
      let comp = null;
      try { comp = chain.getComponentAtIndex(c); } catch (e) { continue; }
      if (!comp) continue;
      const rec = { comp, params: 0 };
      comps.push(rec);
      let misses = 0;
      for (let p = 0; p < 60 && misses < 6; p++) {
        let param = null;
        try { param = comp.getParam(p); } catch (e) { misses++; continue; }
        if (!param) { misses++; continue; }
        misses = 0;
        rec.params++;
        found.push(param);
      }
    }
  });

  // names can be awaited once we hold references
  for (const rec of comps) {
    let cn = "";
    try { cn = (await rec.comp.getMatchName()) || ""; } catch (e) {}
    if (!cn) { try { cn = (await rec.comp.getDisplayName()) || "?"; } catch (e) { cn = "?"; } }
    dbg.push(cn.replace(/^AE\.ADBE /, "") + "(" + rec.params + "p)");
  }
  for (const param of found) {
    let name = "";
    try { name = (await param.getDisplayName()) || ""; } catch (e) {}
    if (!name) continue;
    seen.push(name);
    const key = Object.keys(wanted).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    if (key && wanted[key] !== "") targets.push({ param, value: String(wanted[key]), name });
  }

  if (targets.length) {
    project.lockedAccess(() => {
      project.executeTransaction((compound) => {
        for (const t of targets) {
          const kf = t.param.createKeyframe(t.value);
          compound.addAction(t.param.createSetValueAction(kf, true));
          set.push(t.name);
        }
      }, "OCHA Branding: set text");
    });
  }
  return { set, seen, dbg: dbg.join(" · ") };
}

/* ---------------- insert ---------------- */
async function addElement() {
  hideStatus();
  try {
    const { project, seq } = await activeSequence();
    if (!seq) return show("Open a sequence first.", "warn");
    if (!curFmt) return show("This sequence isn’t one of the OCHA formats (9:16, 4:5, 1:1, 16:9).", "warn");

    // bundled file reachable?
    try { await storage.localFileSystem.getEntryWithUrl("plugin:/" + mogrtRel(curEl, curFmt)); }
    catch (e) { return show("Bundled MOGRT missing: " + mogrtRel(curEl, curFmt), "err"); }

    const path = await mogrtPath(curEl, curFmt);
    const playhead = await seq.getPlayerPosition();
    const vCount = await seq.getVideoTrackCount();
    const aCount = await seq.getAudioTrackCount();
    const aTrack = curEl === "ending" ? Math.max(0, aCount - 1) : 0;
    const editor = await ppro.SequenceEditor.getEditor(seq);

    // insertMogrtFromPath rejects out-of-range indexes (no auto-create) — ladder.
    // Called SYNCHRONOUSLY inside lockedAccess, as Adobe's own sample does.
    const tries = [...new Set([vCount, Math.max(0, vCount - 1), 0])];
    let clip = null, usedTrack = -1; const errs = [];
    for (const v of tries) {
      try {
        let items = [];
        project.lockedAccess(() => {
          items = editor.insertMogrtFromPath(path, playhead, v, aTrack);
        });
        clip = Array.isArray(items) ? items[0] : items;
        if (clip) { usedTrack = v; break; }
        errs.push(`track ${v}: returned nothing`);
      } catch (e) { errs.push(`track ${v}: ${e && e.message ? e.message : e}`); }
    }
    if (!clip) return show("Insert failed —<br>" + errs.join("<br>"), "err");

    // Adobe's sample never probes the handles insertMogrtFromPath returns — it
    // re-fetches the clip FROM THE TRACK and works on that. Do the same: prefer
    // the newest CLIP item on the track we inserted into.
    try {
      const track = await seq.getVideoTrack(usedTrack);
      if (track) {
        const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
        if (items && items.length) clip = items[items.length - 1];
      }
    } catch (e) { /* keep the insert-returned handle */ }

    const wanted = {};
    for (const [ctrl, id] of Object.entries(TEXT[curEl])) {
      const v = ($(id) && $(id).value || "").trim();
      if (v) wanted[ctrl] = v;
    }

    // Always probe the inserted clip's params — sets any typed text AND tells us
    // what controls exist (the map the EGP-free editing plan builds on).
    let note = "";
    try {
      const r = await fillText(project, clip, wanted);
      if (r.set.length) note = ` Filled: ${r.set.join(", ")}.`;
      else note = ` Controls I can drive: ${r.seen.slice(0, 16).join(" · ") || "none"} <span style="opacity:.65">[${r.dbg}]</span>`;
    } catch (e) { note = " (Param probe error: " + (e.message || e) + ")"; }
    show(`Added <strong>${EL[curEl]}</strong> · ${FMT[curFmt].label} at the playhead.${note}`, "ok");
  } catch (e) {
    show("Error: " + (e && e.message ? e.message : e), "err");
  }
}

/* ---------------- UI wiring ---------------- */
function selectEl(el) {
  curEl = el;
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-active", c.dataset.el === el));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("is-open", p.dataset.pane === el));
  hideStatus();
}
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => selectEl(c.dataset.el)));

// toggle switches: skin driven by a class on the label (UXP-safe, no :checked CSS)
document.querySelectorAll(".switch").forEach((sw) => {
  const input = sw.querySelector("input");
  const sync = () => sw.classList.toggle("is-on", input.checked);
  input.addEventListener("change", sync);
  sync();
});

// pin colour segmented control
document.querySelectorAll("#pin-colour .seg__opt").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#pin-colour .seg__opt").forEach((q) => q.classList.toggle("is-active", q === b));
  });
});

$("add").addEventListener("click", addElement);

entrypoints.setup({ panels: { ochaBrandingPanel: { show() { refresh(); } } } });
refresh();
setInterval(refresh, 2500);
