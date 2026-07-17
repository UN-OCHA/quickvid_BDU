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

/* ---------------- bake values INTO the .mogrt ----------------
   Premiere's UXP DOM doesn't expose MOGRT/EGP controls on the component chain
   (only Motion/Opacity — verified live), so the panel writes the user's values
   into the capsule itself before inserting: a .mogrt is a zip whose
   definition.json carries every control's default in clientControls[].value
   (type 6 text → value.strDB[].str · 1 checkbox → bool · 2 slider → number ·
   13 dropdown → 1-based index). Patched copy goes to the plugin-data folder. */
const fflate = require("./lib/fflate.js");
const rifx = require("./rifx.js");

function uuid4() {
  const b = new Uint8Array(16);
  (globalThis.crypto && crypto.getRandomValues)
    ? crypto.getRandomValues(b)
    : b.forEach((_, i) => { b[i] = (Math.random() * 256) | 0; });
  b[6] = (b[6] & 0x0f) | 0x40;                     // version 4
  b[8] = (b[8] & 0x3f) | 0x80;                     // variant 10
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function bakeMogrt(elKey, fmtKey, values) {
  const src = await storage.localFileSystem.getEntryWithUrl("plugin:/" + mogrtRel(elKey, fmtKey));
  const buf = await src.read({ format: storage.formats.binary });
  const files = fflate.unzipSync(new Uint8Array(buf));
  if (!files["definition.json"]) throw new Error("definition.json missing in capsule");
  if (!files["project.aegraphic"]) throw new Error("project.aegraphic missing in capsule");

  const def = JSON.parse(fflate.strFromU8(files["definition.json"]));
  // Premiere dedupes templates by capsuleID — fresh id per bake so the patched
  // capsule is treated as new, never resolved to a cached master.
  def.capsuleID = uuid4();

  // map the panel's values onto this capsule's control GUIDs + collect the old
  // default strings (they locate the rendered text in the AE text engine)
  const controls = {}, texts = {}, baked = [];
  for (const c of def.clientControls || []) {
    let ui = c.uiName;
    if (ui && ui.strDB) ui = (ui.strDB[0] || {}).str;
    const key = Object.keys(values).find((k) => k.toLowerCase() === String(ui || "").trim().toLowerCase());
    if (key === undefined) continue;
    const v = values[key];
    controls[c.id] = v;
    if (c.type === 6 && c.value && c.value.strDB) {
      const oldStr = (c.value.strDB[0] || {}).str || "";
      if (oldStr && String(v) !== oldStr) texts[oldStr] = String(v);
      for (const loc of c.value.strDB) loc.str = String(v);   // keep EGP display in sync
    } else {
      c.value = v;
    }
    baked.push(ui);
  }

  // patch the EMBEDDED AE PROJECT — the thing Premiere actually renders.
  // (definition.json values are cosmetic for AE-authored capsules; verified.)
  const inner = fflate.unzipSync(files["project.aegraphic"]);
  const aepName = Object.keys(inner).find((n) => n.endsWith(".aep"));
  if (!aepName) throw new Error("no .aep inside project.aegraphic");
  const { tree, trailer } = rifx.parse(inner[aepName]);
  rifx.patchControls(tree, controls);
  rifx.patchTexts(tree, texts);
  inner[aepName] = rifx.build(tree, trailer);
  files["project.aegraphic"] = fflate.zipSync(inner);
  files["definition.json"] = fflate.strToU8(JSON.stringify(def));

  const out = fflate.zipSync(files);
  const data = await storage.localFileSystem.getDataFolder();
  const tmp = await data.createFile("ocha_insert.mogrt", { overwrite: true });
  // write the exact byte range (a typed array's backing buffer can be larger)
  await tmp.write(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
                  { format: storage.formats.binary });
  return { path: tmp.nativePath, baked };
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

    // collect the panel's values for this element → bake them into the capsule
    const values = {};
    if (curEl === "lt") {
      const n = $("lt-name").value.trim(), t1 = $("lt-title").value.trim(), t2 = $("lt-title2").value.trim();
      if (n) values["Name"] = n;
      if (t1) values["Title"] = t1;
      values["Title line 2 (optional)"] = t2;               // empty collapses the line
      values["Centre align"] = $("lt-centre").checked;
    } else if (curEl === "loc") {
      const p = $("loc-place").value.trim(), d = $("loc-date").value.trim();
      if (p) values["Place"] = p;
      if (d) values["Date"] = d;
      const blue = document.querySelector("#pin-colour .seg__opt.is-active");
      values["Pin colour"] = (blue && blue.dataset.col === "blue") ? 2 : 1;   // 1-based dropdown
      values["Show pin icon"] = $("loc-icon").checked;
    } else if (curEl === "ending") {
      values["Over black"] = $("end-black").checked;
    }

    let path, baked = [];
    try {
      const b = await bakeMogrt(curEl, curFmt, values);
      path = b.path; baked = b.baked;
    } catch (e) {
      path = await mogrtPath(curEl, curFmt);                // fall back to the pristine capsule
      console.log("bake failed, inserting pristine capsule:", e.message || e);
    }
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

    // dev diagnostics only — the console keeps the component map handy while
    // we build the Motion-based Adjust section (size/position on selection)
    try { const r = await fillText(project, clip, {}); console.log("components:", r.dbg); } catch (e) {}

    const note = baked.length ? ` Set: ${baked.join(", ")}.` : "";
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
