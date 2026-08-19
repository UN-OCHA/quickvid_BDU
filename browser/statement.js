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
  // Every long step on this tab (download, sync bake, transcribe, render) polls
  // through here, so the waiting lines hook in ONCE rather than at four call sites.
  const wait = window.OchaWaiting ? OchaWaiting.start($st("#st-waiting")) : { stop() {} };
  let j;
  try {
    do {
      await sleep(1200);
      j = await (await fetch(`${ENGINE}/api/jobs/${jobId}`)).json();
      if (onTick) onTick(j);
    } while (j.status === "queued" || j.status === "running");
  } finally {
    wait.stop();                       // also on throw — a stale "grab a coffee" under an error is grim
  }
  if (j.status === "error") throw new Error(j.error || "Job failed");
  return j;
}

// ---------- tabs + gating (called from app.js when the mode chip updates) ----------
function stModeChanged(full) {
  $st("#st-wizard").hidden = !full;                          // the global gate (app.js) owns the install card
  if (full) stMaybeOfferResume();                            // engine up → offer to restore an autosave
}
function stShowPanel(which) {
  // three panels since the Toolbox tab (v0.13) — keep the sets in lockstep
  [["titles", "#panel-titles", "#tab-titles"],
   ["edit", "#panel-edit", "#tab-edit"],
   ["toolbox", "#panel-toolbox", "#tab-toolbox"]].forEach(([k, panel, tab]) => {
    const pEl = $st(panel), tEl = $st(tab);
    if (pEl) pEl.hidden = which !== k;
    if (tEl) { tEl.classList.toggle("is-active", which === k); tEl.setAttribute("aria-selected", which === k); }
  });
  // Element previews skip while off-screen (they run ffmpeg), so the tab that
  // just appeared has to be told to catch up.
  if (window.OchaBrandPreview) OchaBrandPreview.refreshAll();
}
$st("#tab-titles").onclick = () => stShowPanel("titles");
$st("#tab-edit").onclick = () => stShowPanel("edit");
$st("#tab-toolbox").onclick = () => stShowPanel("toolbox");

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
/* Bring a picked file INTO the job folder before using it.

   Until now the project only remembered WHERE the file was, so a job folder was
   not self-contained: move it to another machine, or let the original be tidied
   away, and the project opened with its source missing. Everything the job needs
   now lives in one folder.

   Returns the path to use. A file already inside the folder is left alone -
   re-copying is how you end up with "clip (2).mp4". Failure is never fatal: the
   copy is a convenience, so we fall back to the original path. */
async function stAdoptSource(path) {
  if (!ST.jobDir) return path;                       // no folder yet, nothing to adopt into
  try {
    const r = await fetch(`${ENGINE}/api/statement/adopt-source`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: path, dir: ST.jobDir }),
    });
    if (!r.ok) return path;
    const j = await r.json();
    if (!j.job_id) return j.path || path;            // already inside the folder
    const done = await stJob(j.job_id, (jj) =>
      stStatus(jj.progress || "Copying into the project folder\u2026", "busy", jj.percent));
    return (done.result && done.result.path) || path;
  } catch (e) {
    return path;
  }
}

async function stUseSource(path, opts = {}) {
  const r = await fetch(`${ENGINE}/api/statement/probe?src=${encodeURIComponent(path)}`);
  if (!r.ok) { stStatus("Couldn't read that video.", "error"); return; }
  ST.fromWebtv = !!opts.webtv;                         // UN feeds usually need the +4f fix — preselect it
  ST.src = path;
  ST.probe = await r.json();
  const p = ST.probe;
  const info = $st("#st-src-info");
  info.hidden = false;
  info.innerHTML = `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> <strong>${esc(path.split("/").pop())}</strong> · ${p.width}×${p.height} · ${mmss(p.duration)}`;
  stStatus("");
  st4kSync();                                    // source dims known → enable/disable 4K
  OchaBrandPreview.refreshAll();                  // element previews can now use real footage
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
    if (path) await stUseSource(await stAdoptSource(path));
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
    const parent = path.replace(/[/\\]+$/, "");
    // Don't nest a job folder inside a job folder. Picking a folder you had already
    // created gave you "Ebola/Ebola/"; if the chosen folder IS one, use it as-is.
    let jobDir = parent + "/" + stSafeName(name);
    try {
      const k = await (await fetch(`${ENGINE}/api/statement/folder-kind?dir=${encodeURIComponent(parent)}`)).json();
      if (k.kind === "job") jobDir = parent;
    } catch (e) { /* fall back to creating the subfolder */ }
    ST.jobDir = jobDir;
    OchaFolder.mark($st("#st-folder"), false);               // requirement satisfied
    $st("#st-folder-path").innerHTML =
      `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Project folder: <strong>${esc(ST.jobDir)}</strong> — download, final clip, thumbnail and the project file all live here.` + stOpenBtn("st-open-dir1");
    $st("#st-open-dir1").onclick = () => stOpenFolder(ST.jobDir);
    stSave();                                                // creates the folder + first autosave
    try {                                                    // same-named project already there? offer to reopen it
      const lr = await fetch(`${ENGINE}/api/statement/load-project?dir=${encodeURIComponent(ST.jobDir)}`);
      if (lr.ok) { const proj = await lr.json(); if (stWorthResuming(proj)) stOfferResume(proj, `“${proj.name || name}” already exists here — continue it?`); }
    } catch (e) { /* none */ }
  } catch (e) { stStatus("Couldn't open the folder picker.", "warn"); }
};

/* The source video isn't where the project says it is — folder moved, drive not
   mounted, or the file is still online-only in Dropbox/OneDrive. Everything else
   about the project is intact, so say so and offer to re-point it, rather than
   letting it fail later at the first still or render. */
function stSourceMissing(name) {
  const el = $st("#st-status");
  el.innerHTML =
    `<div class="cd-alert cd-alert--warning"><div class="cd-alert__message">` +
    `<p><strong>Can't find the source video${name ? ` (${esc(name)})` : ""}.</strong> ` +
    `Everything else in the project is fine. It may have moved, or still be an ` +
    `online-only cloud file — make it available offline, or point me at it.</p>` +
    `<button type="button" class="cd-button cd-button--small" id="st-relocate">` +
    `<span class="cd-button__text">Locate the video…</span></button>` +
    `</div></div>`;
  $st("#st-relocate").onclick = async () => {
    try {
      const r = await fetch(`${ENGINE}/api/statement/relocate-source`, { method: "POST" });
      if (!r.ok) { stStatus((await r.json()).detail || "Couldn't open the picker.", "warn"); return; }
      const { src } = await r.json();
      ST.src = src;
      stSave();
      stStatus("Source reconnected — carry on where you left off.", "ok");
      stFrameRefresh();
    } catch (e) { stStatus("Couldn't reconnect the source: " + e.message, "error"); }
  };
}

// Reopen an earlier project from its .ochaquickvid.json file (native picker on the engine).
$st("#st-open-proj").onclick = async () => {
  try {
    stStatus("Opening the project file…", "busy");
    const r = await fetch(`${ENGINE}/api/statement/open-project`, { method: "POST" });
    if (!r.ok) { stStatus((await r.json()).detail || "Couldn't open that file.", "warn"); return; }
    const { project, dir, source, source_name } = await r.json();
    stRestore(project);
    if (source === "missing") stSourceMissing(source_name);
    else if (source === "moved") stStatus("Source video found in this folder — path updated.", "ok");
    if (dir) {                                               // the file's real location wins over any stored (possibly moved) path
      ST.jobDir = dir;
      OchaFolder.mark($st("#st-folder"), false);             // reopening a project satisfies it too
      $st("#st-folder-path").innerHTML =
        `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Reopened from <strong>${esc(dir)}</strong> — edits save back here.` + stOpenBtn("st-open-dir2");
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
        // pass the percent through — every other step does; without it the bake
        // ran with no bar and looked frozen
        const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Syncing…", "busy", jj.percent));
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
    // Whisper can output ENGLISH for any spoken language (it only translates
    // INTO English). The user reviews/edits the result like any caption.
    if (($st("#st-translate") || {}).checked) body.translate = true;
    const ranges = stCollectRanges();
    if (ranges.length) body.ranges = ranges;                 // else: whole video
    try { OchaAnalytics.ping(body.translate ? "transcribe:translate" : "transcribe", false); } catch (e) {}
    const r = await fetch(`${ENGINE}/api/statement/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Transcribe failed");
    const { job_id } = await r.json();
    await stJob(job_id, (jj) => stStatus(jj.progress || "Transcribing…", "busy", jj.percent));
    const segs = (await (await fetch(`${ENGINE}/api/statement/segments/${job_id}`)).json()).segments;
    setTimeout(stAutoRtl, 0);                              // Arabic speech -> tick RTL
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

// The old stFrameHint() lived here: a line under each slider that appeared and
// vanished with the crop-lock state ("Full height in use — drag sideways…"). It
// changed the row height as you dragged, which is what made the panel jump, and
// nobody could tell what it meant. Deleted on Javi's call (2026-07-30). The zoom
// readout below and the drag tip on the picture do the same job plainly.
function stZoomLabel(shot) {
  const el = $st(shot === "general" ? "#st-zoomv-general" : "#st-zoomv-close");
  if (el) el.textContent = `${(ST.framing[shot].zoom || 1).toFixed(2).replace(/0$/, "")}×`;
}

// Show the "drag to reposition" badge briefly. Fires on first load and whenever the
// pictures are replaced (new frame / new format), never while the user is dragging —
// they have clearly got the idea by then.
const stTipTimers = {};
function stDragTip(shot) {
  const el = $st(shot === "general" ? "#st-tip-general" : "#st-tip-close");
  if (!el) return;
  clearTimeout(stTipTimers[shot]);
  el.classList.add("is-on");
  stTipTimers[shot] = setTimeout(() => el.classList.remove("is-on"), 3000);
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
         // No cache-buster: every parameter that changes the picture is already in
         // the URL, so the same URL is always the same image. `cb=Date.now()` made
         // every request unique, so dragging back to a framing you had just seen
         // cost a fresh round trip instead of hitting the browser cache.
         `&width=${width}`;
}
function stFrameLoad(onlyShot) {
  for (const shot of ["general", "close"]) {
    if (onlyShot && shot !== onlyShot) continue;
    $st(shot === "general" ? "#st-frame-general" : "#st-frame-close").src = stFrameURL(shot, 420);
    stZoomLabel(shot);
  }
}
// `shot` omitted = refresh both (preset or time changed). Passing a shot matters:
// the zoom sliders used to call this bare, so nudging the general zoom ALSO
// re-rendered the close-up — twice the ffmpeg work per tick, and the other picture
// flickered. That is most of why framing felt slow on a slower machine.
function stFrameRefresh(shot) {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => stFrameLoad(shot), 250);
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

$st("#st-zoom-general").oninput = (e) => { ST.framing.general.zoom = e.target.value / 100; stZoomLabel("general"); stFrameRefresh("general"); stSave(); };
$st("#st-zoom-close").oninput = (e) => { ST.framing.close.zoom = e.target.value / 100; stZoomLabel("close"); stFrameRefresh("close"); stSave(); };
// The arrow matters: this used to be `r.onchange = stFrameRefresh`, so the handler
// received the EVENT as its `shot` argument. stFrameLoad then skipped both shots
// (`shot !== onlyShot` for an Event is always true) and changing format silently
// refreshed NOTHING — you kept looking at the previous format's framing.
document.querySelectorAll('input[name="st-preset"]').forEach((r) => (r.onchange = () => { stFrameRefresh(); stDragTip("general"); stDragTip("close"); }));
// Tip again when the picture itself changes — a new frame or a new format is a new
// thing to aim at. `once` per image load would re-fire on every drag refetch.
["#st-frame-general", "#st-frame-close"].forEach((sel, i) => {
  const img = $st(sel);
  if (img) img.addEventListener("load", () => stDragTip(i === 0 ? "general" : "close"), { once: true });
});
$st("#st-frame-another").addEventListener("click", () => { stDragTip("general"); stDragTip("close"); });

// ---------- E8: render + thumbnail ----------
// ---------- E7: subtitles (ON/OFF + Social/Event style with preview) ----------
/* Declared HERE, above stSetSubStyle: that function reads stBp, and it is called
   during load (stSetSubStyle("box")) — well before the mounts further down. A
   `const` read in its temporal dead zone THROWS rather than reading undefined,
   which killed the rest of this file and every listener it had left to register. */
const stBp = {};
// The EXAMPLE for the current style. The live preview owns the <img> (see
// browser/brandpreview.js) and calls this when there's no video yet — so the
// picker and the preview never write the same element from two places.
function stSubExample() {
  const box = ST.subsStyle !== "gradient";
  return {                                             // box = 9:16 reel, event = 16:9 — intrinsic size avoids stretch/shift
    src: box ? "img/ex-sub-box.jpg" : "img/ex-sub-event.jpg",
    width: 360, height: box ? 640 : 203,
    caption: box ? "Boxed — white text on a grey box. Reels and 4:5 feed posts."
                 : "Clean — white text over a soft dark gradient. Square and 16:9 screens.",
  };
}
function stSetSubStyle(style) {
  ST.subsStyle = style;
  $st("#st-substyle-box").classList.toggle("cd-button--outline", style !== "box");
  $st("#st-substyle-event").classList.toggle("cd-button--outline", style === "box");
  if (stBp.subs) stBp.subs.refresh();                  // repaints example OR live frame
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
// The format sets the caption look. The map lives in OchaCaptions.styleFor so the
// two tabs and the engine cannot disagree about it.
document.querySelectorAll('input[name="st-preset"]').forEach((r) =>
  r.addEventListener("change", () => stSetSubStyle(OchaCaptions.styleFor(r.value))));
// reels is the default format, so start from its caption look
stSetSubStyle(OchaCaptions.styleFor("reels"));

/* ---- caption editor: the SHARED component (browser/captions.js) ----
   The Titles tab mounts the same one. Here the cues come from the CURRENT
   selection instantly (the words are already transcribed — no waiting): review
   the text, and Render burns your words with the engine's timing. The
   fingerprint ties edits to the selection + format — change the cut and stale
   edits step aside for fresh automatic captions. */
const stCaps = OchaCaptions.mount({ list: $st("#st-caps-list"), status: $st("#st-caps-status") });
const stCapsSegs = () => ST.segments.filter((s) => s.sel)
  .map((s) => ({ in: s.in, out: s.out, shot: s.shot, userShot: s.userShot, text: s.text, words: s.words }));
const stCapsFp = () => JSON.stringify({
  sel: ST.segments.filter((s) => s.sel).map((s) => [s.in, s.out]),
  preset: (document.querySelector('input[name="st-preset"]:checked') || {}).value || "reels",
});
/* ---- footage Look: the SHARED component (browser/look.js) ----
   The Titles tab mounts the same one. Preview stills come from the engine with
   the exact conversion + chain the render applies. */
const stLook = OchaLook.mount({
  grid: $st("#st-look-grid"), fix: $st("#st-look-fix"), previewBtn: $st("#st-look-prev"),
  adjust: $st("#st-look-adjust"),
  getVideo: () => ST.src,
  getTime: () => { const sSel = ST.segments.find((x) => x.sel); return sSel ? sSel.in + 0.3 : 1; },
  engine: ENGINE, onChange: () => stSave(),
});

// Text on screen — the SHARED component (browser/texton.js); Titles tab mounts the same one.
// Auto-tick RTL when Arabic shows up — in the transcript or anything typed here.
// Still a checkbox: the OCHA bug has no text to detect from, and a mixed-language
// video has to mirror as ONE layout rather than element by element.
const ST_AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function stAutoRtl() {
  const box = $st("#st-rtl");
  if (!box || box.dataset.touched) return;                // never fight a manual choice
  const typed = [...document.querySelectorAll("#panel-edit input[type=text]")]
    .map((el) => el.value).join(" ");
  const spoken = (ST.segments || []).map((x) => x.text || "").join(" ");
  if (ST_AR_RE.test(typed + " " + spoken)) box.checked = true;
}
document.addEventListener("input", (e) => {
  if (e.target.closest && e.target.closest("#panel-edit")) stAutoRtl();
});
$st("#st-rtl").addEventListener("change", (e) => { e.target.dataset.touched = "1"; });

const stTexts = OchaTextOn.mount({
  rows: $st("#st-tx-rows"), add: $st("#st-tx-add"), onChange: () => stSave(),
});

// How many SPOKEN sentences were dropped immediately before each kept one.
// The engine turns this into the "[...]" marker (>= OMIT_MIN_SENTENCES there):
// counting sentences is the honest signal — a long pause removes no words, and a
// single dropped sentence is usually a false start, not a break in the argument.
// Only the UI can count this: it owns the FULL transcript, the engine only ever
// receives the selection.
function stWithDropped(list) {
  let pending = 0;
  return (list || []).map((s) => {
    if (!s.sel) { if ((s.text || "").trim()) pending++; return null; }
    const out = { ...s, dropped: pending };
    pending = 0;
    return out;
  }).filter(Boolean);
}

$st("#st-caps-gen").onclick = async () => {
  const segs = stWithDropped(ST.segments).filter((x) => x.sel).length
    ? stWithDropped(ST.segments) : stCapsSegs();
  if (!segs.length) return stStatus("Tick at least one sentence first (step 5).", "warn");
  try {
    const r = await fetch(`${ENGINE}/api/statement/cues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segs,
        preset: (document.querySelector('input[name="st-preset"]:checked') || {}).value || "reels",
        style: ST.subsStyle || "box" }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Couldn't build the captions.");
    stCaps.setShape(ENGINE, (document.querySelector('input[name="st-preset"]:checked') || {}).value || "reels");
    stCaps.setCues((await r.json()).cues || [], stCapsFp());
  } catch (e) { stStatus("Captions: " + (e && e.message || e), "error"); }
};

/* ---- location strips: the SHARED component (browser/location.js) ----
   The Titles & branding tab mounts the same one — one implementation, both tabs. */
const stLoc = OchaLocation.mount({
  rows: $st("#st-loc-rows"), add: $st("#st-loc-add"),
  onChange: () => stSave(),
});

/* ---- "show it on MY video": the five element previews (browser/brandpreview.js).
   Each posts to the engine, which composites with the REAL overlay graph — so a
   preview can never disagree with the export. The Titles tab mounts the same five.
   Each section sends ONLY its own element: one thing at a time is what you want
   when you are positioning that thing. */
const stBpTime = () => { const s = ST.segments.find((x) => x.sel); return s ? s.in + 0.3 : 1; };
const stBpCanvas = () => PRESET_CANVAS[(document.querySelector('input[name="st-preset"]:checked')
  || {}).value] || PRESET_CANVAS.reels;
const stBpBase = () => ({ look: stLook.collect(), rtl: $st("#st-rtl").checked || undefined });
const stBpCommon = { getVideo: () => ST.src, getTime: stBpTime, engine: ENGINE,
                     canvas: stBpCanvas, base: stBpBase };

stBp.lt = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-lt"),
  collect: () => { const l = stCollectLts(); return l.length ? { lower_thirds: l } : null; },
  watch: () => [...document.querySelectorAll("#st-lt-rows input, #st-lt-rows select")],
});

stBp.subs = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-subs"), example: stSubExample,
  base: () => ({ ...stBpBase(), subtitle: { box: ST.subsStyle !== "gradient" } }),
  // A caption the length of a real one — the point is the box, the wrap and the
  // position, and only a realistic line shows those honestly.
  collect: () => ($st("#st-captions").checked
    ? { cues: [[0, (stCaps.collect(stCapsFp()) || [])[0]?.[1]
                   || "This is how a subtitle will look on your video."]] }
    : null),
  watch: () => [$st("#st-captions")],
});

stBp.bug = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-bug"),
  collect: () => ($st("#st-bug-on").checked ? { bug: { on: true } } : null),
  watch: () => [$st("#st-bug-on")],
});

stBp.pin = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-pin"),
  collect: () => { const p = stLoc.collect(); return p && p.length ? { pins: p } : null; },
  watch: () => [...document.querySelectorAll("#st-loc-rows input, #st-loc-rows select")],
});

stBp.texton = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-texton"),
  collect: () => { const t = stTexts.collect(); return t && t.length ? { texts: t } : null; },
  watch: () => [...document.querySelectorAll("#st-tx-rows input, #st-tx-rows textarea, #st-tx-rows select")],
});

/* Ending logo — the one preview with a control attached. The slider writes
   `logo_y_frac`, which the render already honours; 0.5 (centred) is the standard,
   and moving it is for the case where the logo lands on a face. */
const stEndStyle = () => (document.querySelector('input[name="st-ending"]:checked') || {}).value;
const stLogoY = () => (parseInt(($st("#st-logoy") || {}).value, 10) || 50) / 100;
function stLogoYLabel() {
  const v = Math.round(stLogoY() * 100);
  $st("#st-logoy-val").textContent = v === 50 ? "Centred (standard)" : `${v}% down the frame`;
}
function stLogoYVis() {
  $st("#st-logoy-row").hidden = stEndStyle() !== "over_footage";
}
stBp.ending = OchaBrandPreview.mount({
  ...stBpCommon, figure: $st("#st-bp-ending"),
  // A preview only means something where the logo sits over the picture. Over
  // black it is a black card the body graph never draws — see brand_preview.py.
  collect: () => (stEndStyle() === "over_footage"
    ? { ending: { style: "over_footage", logo_y_frac: stLogoY() } } : null),
  watch: () => [...document.querySelectorAll('input[name="st-ending"]'), $st("#st-logoy")],
});
$st("#st-logoy").addEventListener("input", () => { stLogoYLabel(); stSave(); });
document.querySelectorAll('input[name="st-ending"]').forEach((r) =>
  r.addEventListener("change", stLogoYVis));
stLogoYLabel(); stLogoYVis();


// ---------- E7: lower thirds — the SHARED component (browser/lowerthird.js) ----------
// Edit-tab defaults: appears at 0:02, centred, 5s (was a hand-rolled copy of the
// Titles rows that had drifted on defaults + alignment order).
const stLt = OchaLowerThirds.mount({
  rows: $st("#st-lt-rows"), add: $st("#st-lt-add"), onChange: () => stSave(),
  defaults: { start: 2, duration: 5, align: "center" },
});
const stCollectLts = () => stLt.collect();
stLt.ensure();

$st("#st-render").onclick = async () => {
  if (OchaFolder.block($st("#st-folder"), ST.jobDir, (m) => stStatus(m, "error"))) return;
  const sel = ST.segments.filter((s) => s.sel);
  if (!sel.length) return stStatus("Tick at least one sentence.", "warn");
  const body = {
    src: ST.src,
    segments: stWithDropped(ST.segments).map((s) => ({ in: s.in, out: s.out, shot: s.shot,
      userShot: s.userShot, text: s.text, words: s.words, dropped: s.dropped })),
    framing: ST.framing,
    subject: { x: ST.framing.general.x, y: ST.framing.general.y },   // legacy field for old engine copies
    preset: document.querySelector('input[name="st-preset"]:checked').value,
    canvas: ($st("#st-4k") || {}).checked ? [3840, 2160] : undefined,   // 4K event export
    lower_thirds: stCollectLts(),
    ending: { style: document.querySelector('input[name="st-ending"]:checked').value,
              tail: (() => { const v = parseFloat(($st("#st-tail") || {}).value); return Number.isFinite(v) ? v : undefined; })(),
              logo_y_frac: stLogoY() },
    captions: $st("#st-captions").checked,
    subtitles: { on: $st("#st-captions").checked, style: ST.subsStyle || "box" },
    // reviewed caption text — only while it still matches the selection + format
    cues: $st("#st-captions").checked ? (stCaps.collect(stCapsFp()) || undefined) : undefined,
    look: stLook.collect(),
    texts: stTexts.collect(),
    rtl: $st("#st-rtl").checked || undefined,   // undefined = engine auto-detects
    bug: { on: $st("#st-bug-on").checked },
    pins: stLoc.collect(),
    dir: ST.jobDir,
  };
  const capNote = $st("#st-captions").checked && stCaps.stale(stCapsFp())
    ? " (selection changed since the caption review — using fresh automatic captions)" : "";
  // Which format people actually make, and which features they switch on.
  try {
    OchaAnalytics.ping("render:" + body.preset, false);
    if (body.subtitles.on) OchaAnalytics.ping("use:captions");
    if (body.lower_thirds && body.lower_thirds.length) OchaAnalytics.ping("use:lowerthird");
    if (body.pins && body.pins.length) OchaAnalytics.ping("use:pin");
    if (body.texts && body.texts.length) OchaAnalytics.ping("use:texton");
    if (body.look) OchaAnalytics.ping("use:look");
    if (body.rtl) OchaAnalytics.ping("use:rtl");
    if (body.canvas) OchaAnalytics.ping("use:4k");
  } catch (e) {}
  try {
    $st("#st-render").disabled = true;
    stStatus("Cutting and branding — a minute or two…" + capNote, "busy");
    const r = await fetch(`${ENGINE}/api/statement/render`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Render failed");
    const { job_id } = await r.json();
    const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Rendering…", "busy", jj.percent));
    ST.renderJob = job_id;
    $st("#st-player").src = `${ENGINE}/api/preview/${job_id}?cb=${Date.now()}`;
    $st("#st-download").onclick = () => stOpenFolder(ST.jobDir);
    const saved = $st("#st-saved");
    if (j.result && j.result.export) {
      saved.hidden = false;
      saved.querySelector(".cd-alert__message").innerHTML =
        `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Saved to <strong>${esc(j.result.export)}</strong> (in the job's <code>export/</code> folder). ` +
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

// "Use the frame I'm viewing" — ANY frame of the clip, so the thumbnail choice is
// unlimited rather than the 3-at-a-time suggestions. The preview plays the CUT
// clip while stills are grabbed from the SOURCE, so map cut-time -> source-time
// through the same runs the engine builds (JUMP_GAP must match statement.py).
function stRunsJS() {
  const sel = ST.segments.filter((s) => s.sel).sort((a, b) => a.in - b.in);
  const runs = [];
  for (const s of sel) {
    const last = runs[runs.length - 1];
    if (last && s.in - last.out < 1.5) last.out = Math.max(last.out, s.out);
    else runs.push({ in: s.in, out: s.out });
  }
  return runs;
}
function stCutToSource(tCut) {
  let acc = 0;
  const runs = stRunsJS();
  for (const r of runs) {
    const len = r.out - r.in;
    if (tCut < acc + len) return r.in + (tCut - acc);
    acc += len;
  }
  return runs.length ? runs[runs.length - 1].out : 0;
}
$st("#st-thumb-here").onclick = () => {
  const v = $st("#st-player");
  if (!v || !v.src) return stStatus("Render the clip first, then scrub the preview to the frame you want.", "warn");
  const t = +stCutToSource(v.currentTime || 0).toFixed(2);
  const fg = ST.framing.general;
  const url = (w, d) => `${ENGINE}/api/statement/still?src=${encodeURIComponent(ST.src)}&t=${t}` +
    `&shot=general&preset=${ST.thumbPreset}&sx=${fg.x.toFixed(3)}&sy=${fg.y.toFixed(3)}&zoom=${(fg.zoom || 1).toFixed(2)}&width=${w}` +
    (d ? `&download=1&dir=${encodeURIComponent(ST.jobDir || "")}` : "");
  const wrap = $st("#st-thumbs");
  wrap.querySelectorAll(".st-thumb").forEach((x) => x.classList.remove("is-on"));
  const img = document.createElement("img");
  img.src = url(300, 0);
  img.className = "st-thumb is-on";
  img.onclick = () => {
    wrap.querySelectorAll(".st-thumb").forEach((x) => x.classList.remove("is-on"));
    img.classList.add("is-on");
    $st("#st-thumb-dl").href = url(0, 1);
  };
  wrap.prepend(img);
  $st("#st-thumb-dl").href = url(0, 1);
  stStatus(`Thumbnail taken from the frame at ${mmss(v.currentTime || 0)} of the clip.`, "ok");
};


// ---------- 4K export (Event screen only, real 4K sources only) ----------
// The engine accepts any canvas; everything except the captions is already a
// RATIO of canvas height, so a bigger canvas keeps identical proportions — the
// caption numbers are scaled by the same factor engine-side (statement.py csc).
// Gated hard on the SOURCE having the pixels: upscaling 1080 to 4K would just
// make a bigger, softer file and call it an upgrade.
function st4kSync() {
  const box = $st("#st-4k"), hint = $st("#st-4k-hint");
  if (!box) return;
  const preset = (document.querySelector('input[name="st-preset"]:checked') || {}).value;
  const p = ST.probe || {};
  const isEvent = preset === "event";
  const src4k = (p.width || 0) >= 3840 && (p.height || 0) >= 2160;
  const ok = isEvent && src4k;
  box.disabled = !ok;
  if (!ok) box.checked = false;
  $st("#st-4k-wrap").style.opacity = ok ? "" : "0.55";
  // No leading dash: the hint is its own line in the option card now, not a
  // continuation of the label.
  hint.innerHTML = !isEvent
    ? "Event screen only. Social formats stay 1080: Instagram, TikTok and X re-encode to 1080 anyway."
    : !src4k
      ? `Needs a 4K source; this one is ${p.width || "?"}×${p.height || "?"}. QuickVid never upscales.`
      : "Your source is 4K, so this exports true 4K (3840×2160). Same proportions, larger canvas. Punch-in shots are enlarged from the crop.";
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.name === "st-preset") st4kSync();
});

// ---------- E5: Use AI (copy prompt → any LLM → paste selection back) ----------
const stIds = (sel) => ((($st(sel) || {}).value) || "").match(/\d+/g)?.map(Number) || [];

// OCHA house style for the prompt. Generated engine-side from brand/ocha_style.json —
// the SAME file that already fixed the transcript's spelling — so the AI is told the
// rules the text it is reading has been through. Fetched once; if the engine is old
// or the file is missing the prompt simply goes out without the block.
let ST_STYLE = "";
fetch("/api/style/prompt")
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => { ST_STYLE = (j && j.block) || ""; })
  .catch(() => {});

const stAIMode = () => (document.querySelector('input[name="st-ai-mode"]:checked') || {}).value || "choose";
const stTranscriptLines = () =>
  ST.segments.map((s) => `${s.id} (${(s.out - s.in).toFixed(1)}s): ${s.text.trim()}`).join("\n");

function stAIPrompt() {
  return stAIMode() === "match" ? stAIPromptMatch() : stAIPromptChoose();
}

// MODE A — the choice is already made; this is a LOOKUP, not an edit.
// No duration, no editorial criteria, no must/avoid: every one of those is a licence
// to drop something the editor picked, which is exactly what used to happen.
function stAIPromptMatch() {
  const script = (($st("#st-ai-script") || {}).value || "").trim();
  return `You are helping the UN Office for the Coordination of Humanitarian Affairs (OCHA) prepare a statement clip.

Below is a transcript of a spoken statement, split into NUMBERED sentences, and after it the SCRIPT that has already been chosen by the editor.

Your ONLY job is to find which transcript sentence each line of the script corresponds to, and return their numbers. You are NOT selecting, shortening, improving or judging anything - the choice is already made and it is final.

- Match on MEANING, not exact wording: the script has been lightly cleaned up for reading, while the transcript is what was actually said out loud. Small differences in wording, filler words and false starts are expected.
- If one script line spans two transcript sentences, return both numbers.
- Return every number in ascending order.
- There is NO duration limit and nothing to trim. Do not leave a sentence out because the result seems long.
- If a script line matches NO transcript sentence, or matches two equally well, put it in "unmatched" rather than guessing. Reporting it is far more useful to me than a wrong number.
${ST_STYLE ? "\n" + ST_STYLE + "\n" : ""}
FINAL ANSWER FORMAT (critical): reply with ONE short paragraph noting anything you could not place, then on its own line output exactly this JSON and nothing after it:
{"keep": [the matching sentence numbers, ascending], "unmatched": ["any script lines you could not place"]}

TRANSCRIPT:
${stTranscriptLines()}

CHOSEN SCRIPT:
${script || "(paste your script into QuickVid first - this prompt is incomplete without it)"}`;
}

// MODE B — still choosing. Editorial criteria apply.
function stAIPromptChoose() {
  const noLimit = ($st("#st-ai-nolimit") || {}).checked;
  const dur = parseInt(($st("#st-ai-dur") || {}).value, 10) || 90;
  const must = stIds("#st-ai-must");
  const avoid = stIds("#st-ai-avoid");
  const ask = ($st("#st-ai-ask") || {}).checked;
  const focus = (($st("#st-ai-focus") || {}).value || "").trim();

  // These used to be baked in: a forced Q&A and a hard 90s cap, with no way to say
  // "keep these exact sentences" or "no limit". They're the editor's call, so they
  // come from the panel now.
  const rules = [
    "open strong: the news or the human impact, not procedure or greetings",
    "keep complete thoughts - never leave a sentence that depends on a dropped one",
    "prefer concrete facts and human consequences",
    "if there is a call to action or appeal, keep it near the end",
  ];
  rules.push(noLimit
    ? "there is NO duration limit - keep every sentence that earns its place, and stop when the message is complete"
    : `add up the sentence durations and stay within about ${dur} seconds, counting the locked sentences`);
  if (avoid.length) rules.push(`do NOT keep these sentences: ${avoid.join(", ")}`);

  // Locked sentences sit ABOVE the criteria and outrank the duration explicitly.
  // As one more bullet in the list they read as a preference among six, and the AI
  // resolved the clash with the duration cap by trimming them (Javi, 2026-07-30).
  const lockBlock = must.length
    ? `\nLOCKED SENTENCES - my editorial decision, not a suggestion: ${must.join(", ")}.\n` +
      `Keep every one of them, in full. If keeping them goes over the duration target, the TARGET gives way - never the locked sentences. Choose the rest around them.\n`
    : "";
  const focusBlock = focus ? `\nWHAT THIS CLIP IS ABOUT (use this to steer your choice):\n${focus}\n` : "";

  const askBlock = ask
    ? `\nBEFORE choosing, ask me these and WAIT for my answers:\n` +
      `1. Any key ideas or messages the clip must focus on? (If a statement document or key-messages file exists, ask me to attach it.)\n` +
      `2. Anything to avoid?\n`
    : `\nDo not ask me anything first - I have already set the constraints below. Choose now.\n`;

  return `You are helping the UN Office for the Coordination of Humanitarian Affairs (OCHA) cut a spoken statement into a short social-media video (a "statement clip").

Below is the full transcript, split into NUMBERED sentences (with each sentence's duration in seconds). The video will KEEP a subset of these sentences, in their original order, spoken on camera. Sentences cannot be reworded, split or merged - only kept or dropped.
${askBlock}${lockBlock}${focusBlock}
Choose the sentences that make the strongest clip for OCHA's audience:
${rules.map((r) => "- " + r + ";").join("\n")}
${ST_STYLE ? "\n" + ST_STYLE + "\n" : ""}
FINAL ANSWER FORMAT (critical): reply with ONE short paragraph explaining your choice, then on its own line output exactly this JSON and nothing after it:
{"keep": [the sentence numbers you selected, in ascending order]}${must.length ? `\n\nBefore you answer, check that your "keep" list contains ${must.join(", ")}.` : ""}

TRANSCRIPT:
${stTranscriptLines()}`;
}

// Script lines the AI could not place (match mode). Same tolerant approach as
// stAIParse: find the JSON object that carries the key, whatever surrounds it.
function stAIUnmatched(text) {
  for (const c of text.match(/\{[\s\S]*?"unmatched"[\s\S]*?\}/g) || []) {
    try {
      const o = JSON.parse(c);
      if (Array.isArray(o.unmatched)) return o.unmatched.map(String).filter((s) => s.trim());
    } catch (e) { /* try the next candidate */ }
  }
  return [];
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
  stAISync();
  $st("#st-ai-long").hidden = stAIPrompt().length < 7500;    // Copilot truncates very long pastes
  $st("#st-ai-modal").hidden = false;
};
function stAISync() {
  const match = stAIMode() === "match";
  // Gates sit on plain wrappers — .opt-grid/.end-options set `display`, which beats
  // the UA's [hidden] rule and would leave the panel visible.
  if ($st("#st-ai-match")) $st("#st-ai-match").hidden = !match;
  if ($st("#st-ai-choose")) $st("#st-ai-choose").hidden = match;
  if ($st("#st-ai-title")) $st("#st-ai-title").textContent =
    match ? "Find my sentences in the transcript" : "Let AI pick the sentences";
  // "No limit" and a target duration are mutually exclusive — grey the number
  // field rather than leave two answers on screen.
  const nl = ($st("#st-ai-nolimit") || {}).checked;
  if ($st("#st-ai-dur")) $st("#st-ai-dur").disabled = nl;
  // Step 2 used to promise "it will ask you a couple of questions" — untrue whenever
  // the Q&A is off, and nonsense in match mode.
  const step2 = $st("#st-ai-step2");
  if (step2) {
    step2.textContent = match
      ? " It answers with the sentence numbers, and flags anything it couldn't place."
      : (($st("#st-ai-ask") || {}).checked
        ? " It will ask you a couple of questions first — answer them, and attach the statement or key-messages document if you have one."
        : " It answers straight away with its choice — you've already set the constraints above.");
  }
  if ($st("#st-ai-copied")) $st("#st-ai-copied").textContent = "";
}
["#st-ai-dur", "#st-ai-nolimit", "#st-ai-must", "#st-ai-avoid", "#st-ai-ask",
 "#st-ai-focus", "#st-ai-script"].forEach((sel) => {
  const el = $st(sel);
  if (!el) return;
  el.addEventListener("change", stAISync);
  el.addEventListener("input", stAISync);
});
document.querySelectorAll('input[name="st-ai-mode"]').forEach((r) => r.addEventListener("change", stAISync));

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
  // In match mode the AI reports script lines it could not place. Those are the ONLY
  // thing you'd otherwise have to spot by hand, so they are a warning, not a footnote.
  const missed = stAIUnmatched($st("#st-ai-paste").value || "");
  if (missed.length) {
    stStatus(`${valid.size} sentences matched · ${mmss(total)}. ${missed.length} script line${missed.length > 1 ? "s" : ""} could NOT be placed — check ${missed.length > 1 ? "them" : "it"} by hand: “${missed.join("” · “")}”`, "warn");
  } else {
    stStatus(stAIMode() === "match"
      ? `All ${valid.size} script lines matched · ${mmss(total)} — nothing left unplaced.`
      : `AI selected ${valid.size} sentences · ${mmss(total)} — review the list below and adjust freely.`, "ok");
  }
};

// ---------- Autosave & resume (browser localStorage + <folder>/<name>.ochaquickvid.json) ----------
const LS_KEY = "quickvid.project.v1";
let stSaveTimer = null, stPendingResume = null;

function stRangeRows() {
  return [...document.querySelectorAll("#st-ranges .st-range")].map((r) => ({
    from: r.querySelector(".st-range-from").value, to: r.querySelector(".st-range-to").value,
  }));
}
// The source path relative to the job folder, when it lives inside it. Saving BOTH
// means the project survives the folder being renamed, moved, or opened on another
// machine — the absolute path alone did not.
function stRelSrc() {
  if (!ST.src || !ST.jobDir) return null;
  const dir = ST.jobDir.replace(/[/\\]+$/, "");
  const norm = (x) => x.replace(/\\/g, "/");
  return norm(ST.src).startsWith(norm(dir) + "/") ? norm(ST.src).slice(norm(dir).length + 1) : null;
}

function stSnapshot() {
  const val = (sel) => (document.querySelector(sel) || {}).value;
  return {
    v: 1, savedAt: Date.now(),
    name: (($st("#st-proj-name") || {}).value || ST.projName || "").trim(),
    type: val('input[name="st-type"]:checked') || "statement",
    jobDir: ST.jobDir, src: ST.src, src_rel: stRelSrc(), probe: ST.probe, offset: ST.offset,
    ranges: stRangeRows(), segments: ST.segments, framing: ST.framing, frameT: ST.frameT,
    preset: val('input[name="st-preset"]:checked') || "reels",
    ending: val('input[name="st-ending"]:checked') || "over_footage",
    captions: $st("#st-captions").checked,
    subsStyle: ST.subsStyle || "box",
    bug: $st("#st-bug-on").checked,
    pins: stLoc.collect(),
    tail: parseFloat(($st("#st-tail") || {}).value),
    logoY: stLogoY(),
    lts: stCollectLts(),
    look: stLook.collect(),
    texts: stTexts.collect(),
    rtl: $st("#st-rtl").checked,
    is4k: ($st("#st-4k") || {}).checked,
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
        `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Saving to <strong>${esc(ST.jobDir)}</strong>.` + stOpenBtn("st-open-dir3");
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
    if (Number.isFinite(p.logoY)) $st("#st-logoy").value = Math.round(p.logoY * 100);
    stLogoYLabel(); stLogoYVis();
    stTailVis();
    stLook.restore(p.look);
    stTexts.restore(p.texts);
    $st("#st-rtl").checked = !!p.rtl;
    st4kSync();
    if (p.is4k && !$st("#st-4k").disabled) $st("#st-4k").checked = true;
    let lts = p.lts;
    if (!lts && p.lt && p.lt.name)                             // old single-LT projects
      lts = [{ name: p.lt.name, org: p.lt.title, org2: p.lt.title2, start: 2, duration: 5, align: p.lt.align }];
    stLt.restore(lts || []);
    $st("#st-captions").checked = p.captions !== false;
    stSetSubStyle(p.subsStyle || OchaCaptions.styleFor(p.preset));
    $st("#st-subs-opts").hidden = !$st("#st-captions").checked;
    $st("#st-bug-on").checked = !!p.bug;                       // off by default — including for older saved projects
    stLoc.restore(p.pins || p.pin);      // `pin` = a project saved before Jul 2026
    $st("#st-zoom-general").value = Math.round((ST.framing.general.zoom || 1) * 100);
    $st("#st-zoom-close").value = Math.round((ST.framing.close.zoom || 1.5) * 100);
    if (ST.src && ST.probe) {
      const info = $st("#st-src-info"); info.hidden = false;
      info.innerHTML = `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> <strong>${esc(ST.src.split("/").pop())}</strong> · ${ST.probe.width}×${ST.probe.height} · ${mmss(ST.probe.duration)}`;
      $st("#st-card-sync").hidden = false;
      st4kSync();                                    // source dims known → enable/disable 4K
  OchaBrandPreview.refreshAll();                  // element previews can now use real footage
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
