// OCHA QuickVid — Statement clip wizard (Edit mode, engine-backed).
// The engine does the mechanics (download, sync bake, Whisper, punch-in cut,
// branding); the human calls the shots here: which sentences, which framing,
// which look. Progressive-reveal cards; state lives in ST.

const ST = {
  src: null,            // current working file (original or synced master)
  probe: null,          // {width,height,fps,duration}
  offset: 0,            // chosen A/V offset (s); + = audio later
  syncT: null,          // the moment (s) the sync preview is testing; re-rolled by "another moment"
  segjob: null,
  segments: [],         // [{id,in,out,text,words,sel,shot,userShot}]
  framing: { general: { x: 0.5, y: 0.40, zoom: 1.0 }, close: { x: 0.5, y: 0.40, zoom: 1.5 } },
  frameT: null,         // framing-preview time override ("Try another frame"); null = first kept sentence
  jobDir: null,         // the user's chosen job folder (source/export/info/assets); null = temp workspace
  renderJob: null,
};

const $st = (s) => document.querySelector(s);
const stStatus = (text, kind, percent) => {
  const el = $st("#st-status");
  if (!text) { el.innerHTML = ""; return; }
  const cls = { ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" }[kind] || "";
  const p = typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const bar = p === null ? "" :
    `<div class="cd-progress"><div class="cd-progress__fill" style="width:${p}%"></div></div><div class="cd-progress__pct">${p}%</div>`;
  el.innerHTML = `<div class="cd-alert ${cls}"><div class="cd-alert__message"><p>${esc(text)}</p>${bar}</div></div>`;
};
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const parseT = (s) => {
  s = String(s || "").trim();
  if (!s) return null;
  const p = s.split(":").map(Number);
  return p.length >= 2 ? p[0] * 60 + p[1] : parseFloat(s) || null;
};

async function stJob(jobId, onTick) {
  let j;
  do {
    await sleep(1200);
    j = await (await fetch(`${ENGINE}/api/jobs/${jobId}`)).json();
    if (onTick) onTick(j);
  } while (j.status === "queued" || j.status === "running");
  if (j.status === "error") throw new Error(j.error || "Job failed");
  return j;
}

// ---------- tabs + gating (called from app.js when the mode chip updates) ----------
function stModeChanged(full) {
  $st("#st-wizard").hidden = !full;                          // the global gate (app.js) owns the install card
  if (full) stMaybeOfferResume();                            // engine up → offer to restore an autosave
}
function stShowPanel(which) {
  $st("#panel-titles").hidden = which !== "titles";
  $st("#panel-edit").hidden = which !== "edit";
  $st("#tab-titles").classList.toggle("is-active", which === "titles");
  $st("#tab-edit").classList.toggle("is-active", which === "edit");
  $st("#tab-titles").setAttribute("aria-selected", which === "titles");
  $st("#tab-edit").setAttribute("aria-selected", which === "edit");
}
$st("#tab-titles").onclick = () => stShowPanel("titles");
$st("#tab-edit").onclick = () => stShowPanel("edit");

// ---------- E0: OS-aware setup steps (auto-detected, manual toggle) ----------
function stSetOS(win) {
  $st("#st-setup-mac").hidden = win;
  $st("#st-setup-win").hidden = !win;
  $st("#st-os-mac").classList.toggle("cd-button--outline", win);
  $st("#st-os-win").classList.toggle("cd-button--outline", !win);
}
$st("#st-os-mac").onclick = () => stSetOS(false);
$st("#st-os-win").onclick = () => stSetOS(true);
stSetOS(/Windows/i.test(navigator.userAgent));

// ---------- E2: source ----------
async function stUseSource(path, opts = {}) {
  const r = await fetch(`${ENGINE}/api/statement/probe?src=${encodeURIComponent(path)}`);
  if (!r.ok) { stStatus("Couldn't read that video.", "error"); return; }
  ST.fromWebtv = !!opts.webtv;                         // UN feeds usually need the +4f fix — preselect it
  ST.src = path;
  ST.probe = await r.json();
  const p = ST.probe;
  const info = $st("#st-src-info");
  info.hidden = false;
  info.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> <strong>${esc(path.split("/").pop())}</strong> · ${p.width}×${p.height} · ${mmss(p.duration)}`;
  stStatus("");
  stInitSync();
  $st("#st-card-sync").hidden = false;
  $st("#st-card-sync").scrollIntoView({ behavior: "smooth" });
  stSave();
}

$st("#st-get").onclick = async () => {
  const url = $st("#st-url").value.trim();
  if (!url) return stStatus("Paste a UN Web TV link first.", "warn");
  // The folder is step 1 and the download lands in <folder>/source/ — so ask for it
  // BEFORE the download, not after several minutes of it.
  if (OchaFolder.block($st("#st-folder"), ST.jobDir, (m) => stStatus(m, "error"))) return;
  if (url.startsWith("/")) return stUseSource(url);            // power users: a local path works too
  try {
    $st("#st-get").disabled = true;
    stStatus("Contacting UN Web TV…", "busy");
    const r = await fetch(`${ENGINE}/api/statement/download`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, dir: ST.jobDir }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Download failed");
    const { job_id } = await r.json();
    const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Downloading…", "busy", jj.percent));
    await stUseSource(j.result.path, { webtv: true });
  } catch (e) { stStatus("Download failed: " + e.message, "error"); }
  finally { $st("#st-get").disabled = false; }
};

$st("#st-pick").onclick = async () => {
  if (OchaFolder.block($st("#st-folder"), ST.jobDir, (m) => stStatus(m, "error"))) return;
  try {
    const r = await fetch(`${ENGINE}/api/pick-file`, { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (path) await stUseSource(path);
  } catch (e) { stStatus("Couldn't open the file picker.", "warn"); }
};

// ---------- E1: project name + job folder (everything saves here) ----------
const stSafeName = (s) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/[.\s]+$/g, "").trim();

function stOpenFolder(path) {                                // show the job folder in Finder/Explorer
  if (!path) return;
  fetch(`${ENGINE}/api/open-folder`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}
const stOpenBtn = (id) =>
  ` <button type="button" class="cd-button cd-button--outline cd-button--small" id="${id}"><span class="cd-button__text">Open folder</span></button>`;

$st("#st-folder-pick").onclick = async () => {
  const name = ($st("#st-proj-name").value || "").trim();
  if (!name) {
    stStatus("Give the project a name first — the folder is created with that name.", "warn");
    $st("#st-proj-name").focus();
    return;
  }
  try {
    const q = encodeURIComponent(`Choose WHERE to create the "${name}" project folder`);
    const r = await fetch(`${ENGINE}/api/pick-folder?prompt=${q}`, { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (!path) return;
    ST.projName = name;
    ST.jobDir = path.replace(/[\/\\]+$/, "") + "/" + stSafeName(name);
    OchaFolder.mark($st("#st-folder"), false);               // requirement satisfied
    $st("#st-folder-path").innerHTML =
      `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Project folder: <strong>${esc(ST.jobDir)}</strong> — download, final clip, thumbnail and the project file all live here.` + stOpenBtn("st-open-dir1");
    $st("#st-open-dir1").onclick = () => stOpenFolder(ST.jobDir);
    stSave();                                                // creates the folder + first autosave
    try {                                                    // same-named project already there? offer to reopen it
      const lr = await fetch(`${ENGINE}/api/statement/load-project?dir=${encodeURIComponent(ST.jobDir)}`);
      if (lr.ok) { const proj = await lr.json(); if (stWorthResuming(proj)) stOfferResume(proj, `“${proj.name || name}” already exists here — continue it?`); }
    } catch (e) { /* none */ }
  } catch (e) { stStatus("Couldn't open the folder picker.", "warn"); }
};

// Reopen an earlier project from its .ochaquickvid.json file (native picker on the engine).
$st("#st-open-proj").onclick = async () => {
  try {
    stStatus("Opening the project file…", "busy");
    const r = await fetch(`${ENGINE}/api/statement/open-project`, { method: "POST" });
    if (!r.ok) { stStatus((await r.json()).detail || "Couldn't open that file.", "warn"); return; }
    const { project, dir } = await r.json();
    stRestore(project);
    if (dir) {                                               // the file's real location wins over any stored (possibly moved) path
      ST.jobDir = dir;
      OchaFolder.mark($st("#st-folder"), false);             // reopening a project satisfies it too
      $st("#st-folder-path").innerHTML =
        `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Reopened from <strong>${esc(dir)}</strong> — edits save back here.` + stOpenBtn("st-open-dir2");
      $st("#st-open-dir2").onclick = () => stOpenFolder(ST.jobDir);
    }
    stSave();
    stStatus(`Opened “${(project.name || "project")}” — continue editing below.`, "ok");
  } catch (e) { stStatus("Couldn't open the project: " + e.message, "error"); }
};

// ---------- E3: sync ----------
const FR = 1 / 30;                                            // one frame at 30fps
const SYNC_OFFSETS = [-4, -3, -2, 0, 2, 3, 4];                // in frames; + = audio later
// +4f (+133 ms) is the correction the ASG Ukraine SC clip needed — UN broadcast
// audio runs ~4 frames early. We DEFAULT to "As is" (never silently re-encode) but
// flag +4f as the usual fix so the eye lands on it when the as-is preview drifts.
const USUAL_FIX = 4;

function stInitSync() {
  const row = $st("#st-sync-chips");
  row.innerHTML = "";
  SYNC_OFFSETS.forEach((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cd-button cd-button--small" + (f === 0 ? "" : " cd-button--outline");
    const label = f === 0 ? "As is" : (f > 0 ? `+${f}f` : `${f}f`);
    if (f === USUAL_FIX) {                                    // the ASG fix — highlight, don't select
      b.classList.add("st-sync-usual");
      b.innerHTML = `<span class="cd-button__text">${label} <span class="st-sync-tag">usual fix</span></span>`;
    } else {
      b.innerHTML = `<span class="cd-button__text">${label}</span>`;
    }
    b.onclick = () => stSyncPreview(f, b);
    row.appendChild(b);
  });
  ST.syncT = stSyncPickTime();                               // a fresh moment each time we open the step
  // UN Web TV broadcasts usually run the audio ~4 frames ahead (Ukraine + Yemen both did),
  // so downloads PRESELECT the usual fix — the user still eyeballs the preview and can
  // switch to "As is". Local files start at "As is".
  const start = ST.fromWebtv ? SYNC_OFFSETS.indexOf(USUAL_FIX) : SYNC_OFFSETS.indexOf(0);
  stSyncPreview(SYNC_OFFSETS[start], row.children[start]);
}

// A talking moment somewhere in the middle — never the first/last few seconds
// (intros / wide shots are useless for judging lip-sync). Re-rolled by "Try another moment".
function stSyncPickTime() {
  const d = ST.probe.duration;
  if (d <= 24) return Math.max(0, d / 2 - 2.5);
  const lo = 8, hi = d - 12;
  return lo + Math.random() * (hi - lo);
}

function stSyncPreview(frames, btn) {
  ST.offset = +(frames * FR).toFixed(4);
  [...$st("#st-sync-chips").children].forEach((b) => b.classList.add("cd-button--outline"));
  if (btn) btn.classList.remove("cd-button--outline");
  // The continue button says what it'll actually do — no "offset" when As is.
  $st("#st-sync-ok").querySelector(".cd-button__text").textContent =
    frames === 0 ? "Looks in sync — continue" : `Use ${frames > 0 ? "+" : ""}${frames}f — continue`;
  stSyncPlay();                                              // same moment, new offset — offsets compare like-for-like
}

function stSyncAnother() {                                   // new moment, keep the chosen offset
  ST.syncT = stSyncPickTime();
  stSyncPlay();
}

function stSyncPlay() {
  const t = ST.syncT ?? Math.max(8, Math.min(ST.probe.duration * 0.45, ST.probe.duration - 10));
  const at = $st("#st-sync-at");
  if (at) at.textContent = `Testing at ${mmss(t)}`;
  const v = $st("#st-sync-player");
  v.src = `${ENGINE}/api/statement/sync-preview?src=${encodeURIComponent(ST.src)}&offset=${ST.offset}&t=${t.toFixed(1)}&cb=${Date.now()}`;
  v.play().catch(() => {});
}

async function stSyncContinue() {
  const ok = $st("#st-sync-ok");
  try {
    ok.disabled = true;
    if (Math.abs(ST.offset) > 0.001) {
      stStatus("Baking the corrected sync into a working copy…", "busy");
      const r = await fetch(`${ENGINE}/api/statement/apply-sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: ST.src, offset: ST.offset }),
      });
      const { job_id } = await r.json();
      if (job_id) {
        const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Syncing…", "busy"));
        ST.src = j.result.path;
      }
    }
    stStatus("");
    $st("#st-card-tr").hidden = false;
    stLoadScrubber();
    $st("#st-card-tr").scrollIntoView({ behavior: "smooth" });
    stSave();
  } catch (e) { stStatus("Sync failed: " + e.message, "error"); }
  finally { ok.disabled = false; }
}
$st("#st-sync-ok").onclick = () => stSyncContinue();
$st("#st-sync-another").onclick = () => stSyncAnother();

// ---------- E4: transcribe ----------
// Compact mm:ss steppers for the "Find the words" window — arrows nudge by 15s
// (finding a speaker in a long meeting; the user types the rough time, arrows fine-tune).
const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };

// Compact mm:ss steppers (arrows nudge ±15s), wired per range row as it's built.
function stWireSteppers(scope) {
  scope.querySelectorAll(".timefield").forEach((tf) => {
    const input = tf.querySelector(".timefield__input");
    const nudge = (d) => { input.value = fmtClock((parseT(input.value) || 0) + d); stSave(); };
    tf.querySelector(".timefield__up").onclick = () => nudge(15);
    tf.querySelector(".timefield__down").onclick = () => nudge(-15);
  });
}
function stTimefield(cls) {
  return `<span class="timefield st-timefield">
    <input class="cd-form__input timefield__input ${cls}" type="text" inputmode="numeric" placeholder="mm:ss" maxlength="5">
    <span class="timefield__spin">
      <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
      <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
    </span></span>`;
}
// A range = one [from, to] window. The speaker may talk in several blocks; each row is
// transcribed and the sentences merge into one timeline-ordered list (see do_transcribe).
function stAddRange(fromV = "", toV = "") {
  const row = document.createElement("div");
  row.className = "st-range field-row";
  row.innerHTML = `<label>From ${stTimefield("st-range-from")}</label>` +
                  `<label>To ${stTimefield("st-range-to")}</label>` +
                  `<button type="button" class="cd-button cd-button--outline cd-button--small st-range-del" title="Remove this range" aria-label="Remove range">&#10005;</button>`;
  $st("#st-ranges").appendChild(row);
  row.querySelector(".st-range-from").value = fromV;
  row.querySelector(".st-range-to").value = toV;
  stWireSteppers(row);
  row.querySelector(".st-range-del").onclick = () => { row.remove(); stRangeSync(); stSave(); };
  stRangeSync();
  stSave();
  return row;
}
function stRangeSync() {                                      // "remove" only when >1 range
  const rows = [...$st("#st-ranges").children];
  rows.forEach((r) => (r.querySelector(".st-range-del").style.visibility = rows.length > 1 ? "visible" : "hidden"));
}
function stEnsureRange() { if (!$st("#st-ranges").children.length) stAddRange(); }
function stLastRange() { return $st("#st-ranges").lastElementChild || stAddRange(); }
function stCollectRanges() {
  return [...document.querySelectorAll("#st-ranges .st-range")]
    .map((r) => [parseT(r.querySelector(".st-range-from").value), parseT(r.querySelector(".st-range-to").value)])
    .filter(([a, b]) => a != null && b != null && b > a);
}
$st("#st-range-add").onclick = () => stAddRange();

// The full recording, scrubbable in-app, so you find WHEN the speaker talks without
// leaving the tool. "Set From/To" fills the LAST range row from the scrubber's time.
function stLoadScrubber() {
  stEnsureRange();
  const v = $st("#st-tr-player");
  if (v && ST.src) v.src = `${ENGINE}/api/statement/file?src=${encodeURIComponent(ST.src)}`;
}
const stPlayT = () => $st("#st-tr-player").currentTime || 0;
$st("#st-set-from").onclick = () => { stLastRange().querySelector(".st-range-from").value = fmtClock(stPlayT()); stSave(); };
$st("#st-set-to").onclick = () => { stLastRange().querySelector(".st-range-to").value = fmtClock(stPlayT()); stSave(); };

$st("#st-transcribe").onclick = async () => {
  try {
    $st("#st-transcribe").disabled = true;
    stStatus("Transcribing — grab a coffee for a long window…", "busy");
    const body = { src: ST.src };
    const ranges = stCollectRanges();
    if (ranges.length) body.ranges = ranges;                 // else: whole video
    const r = await fetch(`${ENGINE}/api/statement/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Transcribe failed");
    const { job_id } = await r.json();
    await stJob(job_id, (jj) => stStatus(jj.progress || "Transcribing…", "busy", jj.percent));
    const segs = (await (await fetch(`${ENGINE}/api/statement/segments/${job_id}`)).json()).segments;
    ST.segments = segs.map((s) => ({ ...s, sel: false, userShot: null }));
    stRenderSegList();
    stStatus(`Found ${segs.length} sentences. Tick the ones to keep.`, "ok");
    $st("#st-card-sel").hidden = false;
    $st("#st-card-sel").scrollIntoView({ behavior: "smooth" });
    stSave();
  } catch (e) { stStatus("Transcription failed: " + e.message, "error"); }
  finally { $st("#st-transcribe").disabled = false; }
};

// ---------- E5: sentence selection + punch-in plan ----------
function stAutoShots() {
  // Consecutive sentences (< 1.5s of skipped source time) are ONE continuous take —
  // no cut, natural pauses kept. A bigger gap = a real JUMP: new take, punch-in,
  // and the captions get a "[...]" marker. Mirrors engine/statement.py JUMP_GAP.
  const sel = ST.segments.filter((s) => s.sel).sort((a, b) => a.in - b.in);
  const runs = [];
  for (const s of sel) {
    const last = runs[runs.length - 1];
    if (last && s.in - last.out < 1.5) { last.out = Math.max(last.out, s.out); last.segs.push(s); }
    else runs.push({ in: s.in, out: s.out, segs: [s] });
  }
  let shot = null;
  runs.forEach((r, i) => {
    const user = r.segs.find((s) => s.userShot);
    r.shot = user ? user.userShot
           : shot === null ? "general"                    // open on the wider, sharpest framing
           : shot === "close" ? "general" : "close";      // punch only across jumps
    shot = r.shot;
    r.segs.forEach((s) => { s.shot = r.shot; s._run = i; });
  });
}

function stRenderSegList() {
  const list = $st("#st-seg-list");
  const keepScroll = list.scrollTop;                         // ticking rebuilds the list — don't yank the user back to the top
  list.innerHTML = "";
  ST.segments.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "st-seg" + (s.sel ? " is-sel" : "");
    row.innerHTML = `
      <input type="checkbox" ${s.sel ? "checked" : ""} aria-label="Keep sentence ${s.id}" />
      <span class="st-seg__dur">${(s.out - s.in).toFixed(1)}s</span>
      <input class="st-seg__text" value="${esc(s.text)}" title="Caption text (edit small slips)" />
      <span class="st-seg__shot" ${s.sel ? "" : "hidden"}>
        <button type="button" class="st-shot ${s.shot === "close" ? "is-on" : ""}" data-shot="close" title="Close-up">C</button>
        <button type="button" class="st-shot ${s.shot === "general" ? "is-on" : ""}" data-shot="general" title="General">G</button>
      </span>`;
    row.querySelector("input[type=checkbox]").onchange = (e) => {
      s.sel = e.target.checked;
      ST.frameT = null;                                      // new selection → back to the default preview frame
      stAutoShots(); stRenderSegList();
    };
    row.querySelector(".st-seg__text").onchange = (e) => { s.text = e.target.value; };
    row.querySelectorAll(".st-shot").forEach((b) => {
      b.onclick = () => {
        ST.segments.forEach((x) => { if (x.sel && x._run === s._run && x !== s) delete x.userShot; });
        s.userShot = b.dataset.shot;                   // one take = one framing; latest click wins
        stAutoShots(); stRenderSegList(); stSave();
      };
    });
    list.appendChild(row);
  });
  list.scrollTop = keepScroll;
  const sel = ST.segments.filter((s) => s.sel);
  const total = sel.reduce((a, s) => a + (s.out - s.in), 0);
  $st("#st-seg-total").innerHTML = sel.length
    ? `<strong>${sel.length}</strong> sentences · <strong>${mmss(total)}</strong> selected ${total > 95 ? "· <em>over 90s — consider trimming</em>" : ""}`
    : "Nothing selected yet.";
  const ready = sel.length > 0;
  $st("#st-card-frame").hidden = !ready;
  $st("#st-card-brand").hidden = !ready;
  $st("#st-render").hidden = !ready;
  if (ready) stFrameRefresh();
}

// ---------- E6: framing — each frame is its own editor: drag to reposition + zoom ----------
const PRESET_CANVAS = { reels: [1080, 1920], square: [1080, 1080], feed45: [1080, 1350], event: [1920, 1080] }; // mirrors engine PRESETS
const stClamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
let frameTimer = null;

function stDefaultFraming() {
  return { general: { x: 0.5, y: 0.40, zoom: 1.0 }, close: { x: 0.5, y: 0.40, zoom: 1.5 } };
}

// JS mirror of the engine's crop sizing — drives drag scaling and the locked-axis hints.
function stCropSize(shot) {
  const preset = document.querySelector('input[name="st-preset"]:checked').value;
  const [cw, ch] = PRESET_CANVAS[preset] || PRESET_CANVAS.reels;
  const sw = ST.probe.width, sh = ST.probe.height;
  const ar = cw / ch;
  const gw = (sw / sh >= ar) ? sh * ar : sw;
  const gh = (sw / sh >= ar) ? sh : sw / ar;
  const z = Math.max(1, ST.framing[shot].zoom || 1);
  return { w: gw / z, h: gh / z, sw, sh };
}

function stFrameHint(shot) {
  const { w, h, sw, sh } = stCropSize(shot);
  const bits = [];
  const lockX = sw - w < 2, lockY = sh - h < 2;
  if (lockX && lockY) bits.push("Whole frame in use — zoom in to reposition.");
  else if (lockY) bits.push("Full height in use — drag sideways; zoom in to move up/down.");
  else if (lockX) bits.push("Full width in use — drag up/down; zoom in to move sideways.");
  if ((ST.framing[shot].zoom || 1) >= 1.5) bits.push(`⚠ Only ~${w}px of source stretched to full width — softens the picture.`);
  $st(shot === "general" ? "#st-hint-general" : "#st-hint-close").textContent = bits.join(" ");
}

function stFrameT() {
  if (ST.frameT != null) return ST.frameT;
  const sel = ST.segments.find((s) => s.sel);
  return sel ? (sel.in + sel.out) / 2 : Math.min(60, ST.probe.duration / 2);
}
// Default preview frame is the first kept sentence; "Try another frame" jumps to a
// random point inside a random kept sentence, so a wide/in-between opening shot isn't
// the only reference for setting the crop.
function stFrameAnother() {
  const sel = ST.segments.filter((s) => s.sel);
  if (!sel.length) return;
  const s = sel[Math.floor(Math.random() * sel.length)];
  ST.frameT = +(s.in + Math.random() * Math.max(0.1, s.out - s.in)).toFixed(2);
  stFrameRefresh();
  stSave();
}
$st("#st-frame-another").onclick = stFrameAnother;

function stFrameURL(shot, width) {
  const preset = document.querySelector('input[name="st-preset"]:checked').value;
  const f = ST.framing[shot];
  return `${ENGINE}/api/statement/still?src=${encodeURIComponent(ST.src)}&t=${stFrameT().toFixed(2)}` +
         `&shot=${shot}&preset=${preset}&sx=${f.x.toFixed(3)}&sy=${f.y.toFixed(3)}&zoom=${(f.zoom || 1).toFixed(2)}` +
         `&width=${width}&cb=${Date.now()}`;
}
function stFrameLoad(onlyShot) {
  for (const shot of ["general", "close"]) {
    if (onlyShot && shot !== onlyShot) continue;
    $st(shot === "general" ? "#st-frame-general" : "#st-frame-close").src = stFrameURL(shot, 420);
    stFrameHint(shot);
  }
}
function stFrameRefresh() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(stFrameLoad, 250);
}

// Drag the picture itself — content follows the pointer; locked axes simply don't move
// (their clamp range collapses to a point). Throttled refetch while dragging, exact on release.
function stWireDrag(sel, shot) {
  const img = $st(sel);
  let drag = null;
  img.addEventListener("pointerdown", (e) => {
    if (!ST.probe || !ST.src) return;
    e.preventDefault();
    drag = { x0: e.clientX, y0: e.clientY, fx: ST.framing[shot].x, fy: ST.framing[shot].y, last: 0 };
    img.classList.add("is-dragging");
    try { img.setPointerCapture(e.pointerId); } catch (err) { /* keep dragging without capture */ }
  });
  img.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const { w, h, sw, sh } = stCropSize(shot);
    const f = ST.framing[shot];
    f.x = stClamp(drag.fx - (e.clientX - drag.x0) * (w / r.width) / sw, w / (2 * sw), 1 - w / (2 * sw));
    f.y = stClamp(drag.fy - (e.clientY - drag.y0) * (h / r.height) / sh, h / (2 * sh), 1 - h / (2 * sh));
    if (Date.now() - drag.last > 300) { drag.last = Date.now(); stFrameLoad(shot); }
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    img.classList.remove("is-dragging");
    stFrameLoad(shot);
    stSave();
  };
  img.addEventListener("pointerup", end);
  img.addEventListener("pointercancel", end);
}
stWireDrag("#st-frame-general", "general");
stWireDrag("#st-frame-close", "close");

$st("#st-zoom-general").oninput = (e) => { ST.framing.general.zoom = e.target.value / 100; stFrameHint("general"); stFrameRefresh(); stSave(); };
$st("#st-zoom-close").oninput = (e) => { ST.framing.close.zoom = e.target.value / 100; stFrameHint("close"); stFrameRefresh(); stSave(); };
document.querySelectorAll('input[name="st-preset"]').forEach((r) => (r.onchange = stFrameRefresh));

// ---------- E8: render + thumbnail ----------
// ---------- E7: subtitles (ON/OFF + Social/Event style with preview) ----------
function stSetSubStyle(style) {
  ST.subsStyle = style;
  $st("#st-substyle-box").classList.toggle("cd-button--outline", style !== "box");
  $st("#st-substyle-event").classList.toggle("cd-button--outline", style === "box");
  const img = $st("#st-subs-preview");                 // box = 9:16 reel, event = 16:9 — set intrinsic size to avoid stretch/shift
  img.width = 360; img.height = style === "box" ? 640 : 203;
  img.src = style === "box" ? "img/ex-sub-box.jpg" : "img/ex-sub-event.jpg";
  $st("#st-subs-cap").textContent = style === "box"
    ? "Social — white text on a grey box (feeds & reels)."
    : "Event — clean white text over a soft gradient (16:9 screens).";
}
function stTailVis() {
  const st = (document.querySelector('input[name="st-ending"]:checked') || {}).value;
  const row = $st("#st-tail-row");
  if (row) row.hidden = st !== "over_footage";
}
document.querySelectorAll('input[name="st-ending"]').forEach((r) =>
  r.addEventListener("change", () => { stTailVis(); stSave(); }));
stTailVis();
$st("#st-tail").addEventListener("change", stSave);

$st("#st-substyle-box").onclick = () => { stSetSubStyle("box"); stSave(); };
$st("#st-substyle-event").onclick = () => { stSetSubStyle("gradient"); stSave(); };
$st("#st-captions").addEventListener("change", () => { $st("#st-subs-opts").hidden = !$st("#st-captions").checked; });
// the format sets the sensible default look (reels/feed = boxed; event screen = clean)
document.querySelectorAll('input[name="st-preset"]').forEach((r) =>
  r.addEventListener("change", () => stSetSubStyle(r.value === "event" ? "gradient" : "box")));
stSetSubStyle("box");

/* ---- location strips: the SHARED component (browser/location.js) ----
   The Titles & branding tab mounts the same one — one implementation, both tabs. */
const stLoc = OchaLocation.mount({
  rows: $st("#st-loc-rows"), add: $st("#st-loc-add"),
  onChange: () => stSave(),
});


// ---------- E7: lower thirds (same multi-row component as the Titles tab) ----------
const stFmtMMSS = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };
function stAddLt(v) {
  v = v || {};
  const row = document.createElement("div");
  row.className = "lt-row";
  row.innerHTML =
    `<input class="cd-form__input lt-name" placeholder="First Name Last Name" autocomplete="off">
     <input class="cd-form__input lt-org" placeholder="Job title" autocomplete="off">
     <input class="cd-form__input lt-org2" placeholder="Additional info" autocomplete="off">
     <div class="lt-meta">
       <span class="lt-cell lt-cell--start"><span class="lt-cap">Start</span>
         <span class="lt-start timefield">
           <input class="cd-form__input timefield__input" type="text" inputmode="numeric" value="00:02" maxlength="5" aria-label="Start (mm:ss)">
           <span class="timefield__spin"><button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button><button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button></span>
         </span>
       </span>
       <span class="lt-cell lt-cell--dur"><span class="lt-cap">Duration</span>
         <span class="lt-dur timefield">
           <input class="cd-form__input durfield__input" type="text" inputmode="numeric" value="5" maxlength="3" aria-label="Duration (seconds)">
           <span class="durfield__unit" aria-hidden="true">sec</span>
           <span class="timefield__spin"><button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button><button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button></span>
         </span>
       </span>
       <span class="lt-cell lt-cell--align"><span class="lt-cap">Alignment</span>
         <select class="cd-form__input lt-align"><option value="center">Centre</option><option value="left">Left</option></select>
       </span>
       <button class="cd-button cd-button--outline cd-button--small lt-remove" type="button" title="Remove this lower third"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="cd-button__text">Remove</span></button>
     </div>`;
  const tf = row.querySelector(".timefield__input"), df = row.querySelector(".durfield__input");
  if (v.name) row.querySelector(".lt-name").value = v.name;
  if (v.org) row.querySelector(".lt-org").value = v.org;
  if (v.org2) row.querySelector(".lt-org2").value = v.org2;
  if (v.start != null) tf.value = stFmtMMSS(v.start);
  if (v.duration != null) df.value = String(v.duration);
  if (v.align) row.querySelector(".lt-align").value = v.align;
  const setTf = (s) => { tf.value = stFmtMMSS(s); stSave(); };
  tf.addEventListener("blur", () => setTf(parseT(tf.value) || 0));
  row.querySelector(".timefield__up").onclick = () => setTf((parseT(tf.value) || 0) + 1);
  row.querySelector(".timefield__down").onclick = () => setTf((parseT(tf.value) || 0) - 1);
  const setDf = (n) => { df.value = String(Math.max(1, Math.round(n || 1))); stSave(); };
  df.addEventListener("blur", () => setDf(parseFloat(df.value)));
  row.querySelector(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
  row.querySelector(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);
  row.querySelector(".lt-remove").onclick = () => { row.remove(); stSave(); };
  $st("#st-lt-rows").appendChild(row);
  return row;
}
function stEnsureLt() { if (!$st("#st-lt-rows").children.length) stAddLt(); }
function stCollectLts() {
  return [...$st("#st-lt-rows").querySelectorAll(".lt-row")].map((r) => ({
    name: r.querySelector(".lt-name").value.trim(),
    org: r.querySelector(".lt-org").value.trim(),
    org2: r.querySelector(".lt-org2").value.trim(),
    start: parseT(r.querySelector(".timefield__input").value) || 0,
    duration: parseFloat(r.querySelector(".durfield__input").value) || 5,
    align: r.querySelector(".lt-align").value,
  })).filter((l) => l.name);
}
$st("#st-lt-add").onclick = () => { stAddLt(); stSave(); };
stEnsureLt();

$st("#st-render").onclick = async () => {
  if (OchaFolder.block($st("#st-folder"), ST.jobDir, (m) => stStatus(m, "error"))) return;
  const sel = ST.segments.filter((s) => s.sel);
  if (!sel.length) return stStatus("Tick at least one sentence.", "warn");
  const body = {
    src: ST.src,
    segments: sel.map((s) => ({ in: s.in, out: s.out, shot: s.shot, userShot: s.userShot, text: s.text, words: s.words })),
    framing: ST.framing,
    subject: { x: ST.framing.general.x, y: ST.framing.general.y },   // legacy field for old engine copies
    preset: document.querySelector('input[name="st-preset"]:checked').value,
    lower_thirds: stCollectLts(),
    ending: { style: document.querySelector('input[name="st-ending"]:checked').value,
              tail: (() => { const v = parseFloat(($st("#st-tail") || {}).value); return Number.isFinite(v) ? v : undefined; })() },
    captions: $st("#st-captions").checked,
    subtitles: { on: $st("#st-captions").checked, style: ST.subsStyle || "box" },
    bug: { on: $st("#st-bug-on").checked },
    pins: stLoc.collect(),
    dir: ST.jobDir,
  };
  try {
    $st("#st-render").disabled = true;
    stStatus("Cutting and branding — a minute or two…", "busy");
    const r = await fetch(`${ENGINE}/api/statement/render`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Render failed");
    const { job_id } = await r.json();
    const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Rendering…", "busy", jj.percent));
    ST.renderJob = job_id;
    $st("#st-player").src = `${ENGINE}/api/preview/${job_id}?cb=${Date.now()}`;
    $st("#st-download").href = `${ENGINE}/api/export/${job_id}?name=` +
      encodeURIComponent(ST.projName ? stSafeName(ST.projName).replace(/\s+/g, "_") : "statement_clip");
    $st("#st-download").download = (ST.projName ? stSafeName(ST.projName).replace(/\s+/g, "_") : "statement_clip") + ".mp4";
    const saved = $st("#st-saved");
    if (j.result && j.result.export) {
      saved.hidden = false;
      saved.querySelector(".cd-alert__message").innerHTML =
        `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Saved to <strong>${esc(j.result.export)}</strong> (in the job's <code>export/</code> folder). ` +
        `<button type="button" class="cd-button cd-button--outline cd-button--small" id="st-open-export"><span class="cd-button__text">Open folder</span></button>`;
      $st("#st-open-export").onclick = () => stOpenFolder(ST.jobDir);
    } else { saved.hidden = true; }
    stThumbs(body.preset);
    $st("#st-card-out").hidden = false;
    stStatus("Done. Preview below — and pick a thumbnail.", "ok");
    $st("#st-card-out").scrollIntoView({ behavior: "smooth" });
  } catch (e) { stStatus("Render failed: " + e.message, "error"); }
  finally { $st("#st-render").disabled = false; }
};

// A pool of candidate thumbnail times, quietest-first (mouth most likely closed):
// the END of each kept sentence (natural pause) — longest first — then the moment
// just BEFORE each sentence starts, then sentence midpoints as fallback variety.
function stThumbPool() {
  const byLen = ST.segments.filter((s) => s.sel).sort((a, b) => (b.out - b.in) - (a.out - a.in));
  const ends = byLen.map((s) => +(s.out - 0.15).toFixed(2));
  const starts = byLen.filter((s) => s.in > 0.4).map((s) => +(s.in - 0.20).toFixed(2));
  const mids = byLen.map((s) => +((s.in + s.out) / 2).toFixed(2));
  const pool = [];
  for (const t of [...ends, ...starts, ...mids]) {
    if (t >= 0 && !pool.some((u) => Math.abs(u - t) < 0.3)) pool.push(t);   // ≥0.3s apart
  }
  return pool;
}

// Show 3 thumbnails from the pool. reshuffle=true advances to the next 3.
function stThumbs(preset, reshuffle) {
  if (preset) ST.thumbPreset = preset;
  if (!reshuffle) { ST.thumbPool = stThumbPool(); ST.thumbPage = 0; }
  else { ST.thumbPage = (ST.thumbPage || 0) + 1; }
  const pool = ST.thumbPool || [];
  const start = (ST.thumbPage * 3) % Math.max(1, pool.length);
  const cands = pool.length
    ? Array.from({ length: Math.min(3, pool.length) }, (_, k) => pool[(start + k) % pool.length])
    : [];
  const wrap = $st("#st-thumbs");
  wrap.innerHTML = "";
  const dl = $st("#st-thumb-dl");
  const fg = ST.framing.general;
  const urlFor = (t, w, d) => `${ENGINE}/api/statement/still?src=${encodeURIComponent(ST.src)}&t=${t}` +
    `&shot=general&preset=${ST.thumbPreset}&sx=${fg.x.toFixed(3)}&sy=${fg.y.toFixed(3)}&zoom=${(fg.zoom || 1).toFixed(2)}&width=${w}` +
    (d ? `&download=1&dir=${encodeURIComponent(ST.jobDir || "")}` : "");
  cands.forEach((t, i) => {
    const img = document.createElement("img");
    img.src = urlFor(t, 300, 0);
    img.className = "st-thumb" + (i === 0 ? " is-on" : "");
    img.onclick = () => {
      wrap.querySelectorAll(".st-thumb").forEach((x) => x.classList.remove("is-on"));
      img.classList.add("is-on");
      dl.href = urlFor(t, 0, 1);
    };
    wrap.appendChild(img);
  });
  if (cands.length) dl.href = urlFor(cands[0], 0, 1);
  $st("#st-thumb-more").hidden = pool.length <= 3;           // nothing new to shuffle to
}
$st("#st-thumb-more").onclick = () => stThumbs(null, true);

// ---------- E5: Use AI (copy prompt → any LLM → paste selection back) ----------
function stAIPrompt() {
  const lines = ST.segments.map((s) => `${s.id} (${(s.out - s.in).toFixed(1)}s): ${s.text.trim()}`);
  return `You are helping the UN Office for the Coordination of Humanitarian Affairs (OCHA) cut a spoken statement into a short social-media video (a "statement clip").

Below is the full transcript, split into NUMBERED sentences (with each sentence's duration in seconds). The video will KEEP a subset of these sentences, in their original order, spoken on camera. Sentences cannot be reworded, split or merged — only kept or dropped.

BEFORE choosing, ask me (the editor) these questions and WAIT for my answers:
1. Any key ideas or messages the clip must focus on? (If a statement document or key-messages file exists, ask me to attach it.)
2. What is the target maximum duration? (Suggest 60-90 seconds if I have no preference.)

Then choose the sentences that make the strongest clip for OCHA's audience:
- open strong: the news or the human impact, not procedure or greetings;
- keep complete thoughts — never leave a sentence that depends on a dropped one;
- prefer concrete facts and human consequences;
- if there is a call to action or appeal, keep it near the end;
- add up the sentence durations and stay within the target; never exceed 90 seconds unless I asked for longer.

FINAL ANSWER FORMAT (critical): after our Q&A, reply with ONE short paragraph explaining your choice, then on its own line output exactly this JSON and nothing after it:
{"keep": [the sentence numbers you selected, in ascending order]}

TRANSCRIPT:
${lines.join("\n")}`;
}

function stAIParse(text) {
  // 1) any {...} containing "keep" (tolerates fences and chatter around it)
  for (const c of text.match(/\{[^{}]*?"keep"[\s\S]*?\}/g) || []) {
    try { const o = JSON.parse(c); if (Array.isArray(o.keep)) return o.keep.map(Number); } catch (e) { /* try next */ }
  }
  // 2) a "keep: 2, 5, 6" style line
  const m = text.match(/keep[^0-9\n]*((?:\d+[\s,;]*)+)/i);
  if (m) { const ids = (m[1].match(/\d+/g) || []).map(Number); if (ids.length) return ids; }
  // 3) the paste is essentially just a list of numbers
  if (/^[\s0-9,;()[\]]+$/.test(text.trim())) {
    const ids = (text.match(/\d+/g) || []).map(Number);
    if (ids.length) return ids;
  }
  return null;
}

$st("#st-ai").onclick = () => {
  if (!ST.segments.length) return;
  $st("#st-ai-paste").value = "";
  $st("#st-ai-result").textContent = "";
  $st("#st-ai-copied").textContent = "";
  $st("#st-ai-long").hidden = stAIPrompt().length < 7500;    // Copilot truncates very long pastes
  $st("#st-ai-modal").hidden = false;
};
$st("#st-ai-close").onclick = () => { $st("#st-ai-modal").hidden = true; };
$st("#st-ai-modal").addEventListener("click", (e) => { if (e.target === $st("#st-ai-modal")) $st("#st-ai-modal").hidden = true; });

$st("#st-ai-copy").onclick = async () => {
  const p = stAIPrompt();
  try { await navigator.clipboard.writeText(p); }
  catch (e) {                                                // clipboard API blocked → hidden textarea fallback
    const ta = document.createElement("textarea");
    ta.value = p; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  $st("#st-ai-copied").textContent = "Copied — now paste it into Copilot (or any AI chat).";
};

$st("#st-ai-apply").onclick = () => {
  const res = $st("#st-ai-result");
  const ids = stAIParse($st("#st-ai-paste").value || "");
  if (!ids) { res.textContent = 'Couldn\'t find a selection in that. Paste the AI\'s whole final answer — it should contain {"keep": [...]}.'; return; }
  const valid = new Set(ids.filter((i) => i >= 1 && i <= ST.segments.length));
  if (!valid.size) { res.textContent = `Those numbers don't match this transcript (sentences are 1–${ST.segments.length}).`; return; }
  ST.segments.forEach((s) => { s.sel = valid.has(s.id); });
  ST.frameT = null;
  stAutoShots(); stRenderSegList(); stSave();
  const total = ST.segments.filter((s) => s.sel).reduce((a, s) => a + (s.out - s.in), 0);
  $st("#st-ai-modal").hidden = true;
  stStatus(`AI selected ${valid.size} sentences · ${mmss(total)} — review the list below and adjust freely.`, "ok");
};

// ---------- Autosave & resume (browser localStorage + <folder>/<name>.ochaquickvid.json) ----------
const LS_KEY = "quickvid.project.v1";
let stSaveTimer = null, stPendingResume = null;

function stRangeRows() {
  return [...document.querySelectorAll("#st-ranges .st-range")].map((r) => ({
    from: r.querySelector(".st-range-from").value, to: r.querySelector(".st-range-to").value,
  }));
}
function stSnapshot() {
  const val = (sel) => (document.querySelector(sel) || {}).value;
  return {
    v: 1, savedAt: Date.now(),
    name: (($st("#st-proj-name") || {}).value || ST.projName || "").trim(),
    type: val('input[name="st-type"]:checked') || "statement",
    jobDir: ST.jobDir, src: ST.src, probe: ST.probe, offset: ST.offset,
    ranges: stRangeRows(), segments: ST.segments, framing: ST.framing, frameT: ST.frameT,
    preset: val('input[name="st-preset"]:checked') || "reels",
    ending: val('input[name="st-ending"]:checked') || "over_footage",
    captions: $st("#st-captions").checked,
    subsStyle: ST.subsStyle || "box",
    bug: $st("#st-bug-on").checked,
    pins: stLoc.collect(),
    tail: parseFloat(($st("#st-tail") || {}).value),
    lts: stCollectLts(),
  };
}
const stWorthResuming = (p) => !!(p && (p.src || (p.segments && p.segments.length) || p.jobDir));
function stAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60); if (m < 60) return m + " min ago";
  return Math.round(m / 60) + "h ago";
}
function stSaveNow() {
  if (ST._restoring) return;
  const snap = stSnapshot();
  if (!stWorthResuming(snap)) return;                        // nothing meaningful yet — never clobber a real save with an empty one
  try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch (e) { /* quota/full */ }
  if (ST.jobDir) {                                           // durable, portable copy in the folder
    fetch(`${ENGINE}/api/statement/save-project`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: ST.jobDir, project: snap, name: snap.name || undefined }),
    }).then((r) => { if (!r.ok) throw new Error(); ST._saveWarned = false; })
      .catch(() => {                                    // silent loss is how test files end up loose
        if (ST._saveWarned) return;
        ST._saveWarned = true;
        stStatus("Couldn't write the project file into the job folder — check the folder still exists.", "warn");
      });
  }
  const box = $st("#st-autosave"), txt = $st("#st-autosave-txt");
  if (box && txt) { box.hidden = false; txt.textContent = "Saved " + stAgo(snap.savedAt); }
}
function stSave() { if (ST._restoring) return; clearTimeout(stSaveTimer); stSaveTimer = setTimeout(stSaveNow, 700); }

function stRestore(p) {
  if (!p) return;
  ST._restoring = true;
  try {
    const check = (name, v) => { const el = document.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
    check("st-type", p.type || "statement");
    ST.projName = p.name || null;
    if (p.name) $st("#st-proj-name").value = p.name;
    ST.jobDir = p.jobDir || null;
    if (ST.jobDir) {
      $st("#st-folder-path").innerHTML =
        `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Saving to <strong>${esc(ST.jobDir)}</strong>.` + stOpenBtn("st-open-dir3");
      $st("#st-open-dir3").onclick = () => stOpenFolder(ST.jobDir);
    }
    ST.src = p.src || null; ST.probe = p.probe || null; ST.offset = p.offset || 0;
    const df = stDefaultFraming();
    if (p.framing) ST.framing = { general: { ...df.general, ...p.framing.general },
                                  close: { ...df.close, ...p.framing.close } };
    else if (p.subject) ST.framing = { general: { ...df.general, ...p.subject },
                                       close: { ...df.close, ...p.subject } };   // old single-point projects
    else ST.framing = df;
    ST.frameT = (p.frameT == null ? null : p.frameT);
    ST.segments = p.segments || [];
    check("st-preset", p.preset || "reels");
    check("st-ending", p.ending || "over_footage");
    if (Number.isFinite(p.tail)) $st("#st-tail").value = p.tail;
    stTailVis();
    $st("#st-lt-rows").innerHTML = "";
    let lts = p.lts;
    if (!lts && p.lt && p.lt.name)                             // old single-LT projects
      lts = [{ name: p.lt.name, org: p.lt.title, org2: p.lt.title2, start: 2, duration: 5, align: p.lt.align }];
    (lts && lts.length ? lts : [{}]).forEach(stAddLt);
    $st("#st-captions").checked = p.captions !== false;
    stSetSubStyle(p.subsStyle || ((p.preset === "event") ? "gradient" : "box"));
    $st("#st-subs-opts").hidden = !$st("#st-captions").checked;
    $st("#st-bug-on").checked = !!p.bug;                       // off by default — including for older saved projects
    stLoc.restore(p.pins || p.pin);      // `pin` = a project saved before Jul 2026
    $st("#st-zoom-general").value = Math.round((ST.framing.general.zoom || 1) * 100);
    $st("#st-zoom-close").value = Math.round((ST.framing.close.zoom || 1.5) * 100);
    if (ST.src && ST.probe) {
      const info = $st("#st-src-info"); info.hidden = false;
      info.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> <strong>${esc(ST.src.split("/").pop())}</strong> · ${ST.probe.width}×${ST.probe.height} · ${mmss(ST.probe.duration)}`;
      $st("#st-card-sync").hidden = false;
      stInitSync();
      $st("#st-card-tr").hidden = false;
      $st("#st-ranges").innerHTML = "";
      const rows = (p.ranges && p.ranges.length) ? p.ranges : [{ from: "", to: "" }];
      rows.forEach((r) => stAddRange(r.from || "", r.to || ""));
      stLoadScrubber();
    }
    let target = "#st-wizard";
    if (ST.segments.length) { stRenderSegList(); $st("#st-card-sel").hidden = false; target = "#st-card-sel"; }
    else if (ST.src) target = "#st-card-tr";
    stStatus("Restored your project — continue where you left off.", "ok");
    const el = $st(target); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    stStatus("Couldn't fully restore the saved project: " + e.message, "warn");
  } finally {
    ST._restoring = false;
    stSaveNow();
  }
}

function stOfferResume(project, whenLabel) {
  stPendingResume = project;
  $st("#st-resume-when").textContent = whenLabel || "";
  $st("#st-resume").hidden = false;
}
function stMaybeOfferResume() {
  if (ST._resumeChecked) return;
  ST._resumeChecked = true;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
  if (stWorthResuming(saved)) {
    stShowPanel("edit");                                     // land back on Edit so the banner is visible
    stOfferResume(saved, (saved.name ? "\u201C" + saved.name + "\u201D \u2014 " : "") + "autosaved " + stAgo(saved.savedAt) + ".");
  }
}
$st("#st-resume-yes").onclick = () => { $st("#st-resume").hidden = true; stRestore(stPendingResume); stPendingResume = null; };
$st("#st-resume-no").onclick = () => { $st("#st-resume").hidden = true; stPendingResume = null; try { localStorage.removeItem(LS_KEY); } catch (e) {} };

// Autosave on any form edit in the Edit panel; button-driven changes call stSave() directly.
$st("#panel-edit").addEventListener("input", stSave);
$st("#panel-edit").addEventListener("change", stSave);
window.addEventListener("pagehide", () => { try { const s = stSnapshot(); if (!ST._restoring && stWorthResuming(s)) localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} });

// Catch up with engine detection. app.js may have detected the engine BEFORE this
// file finished loading (fast local engine + slow network page = the hosted case),
// in which case its stModeChanged call hit the typeof-guard and the Edit tab would
// stay locked until a reload. Sync now that everything above is defined.
if (typeof state !== "undefined") stModeChanged(!!state.engineUp);
