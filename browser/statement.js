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
  subject: { x: 0.5, y: 0.40 },
  frameT: null,         // framing-preview time override ("Try another frame"); null = first kept sentence
  jobDir: null,         // the user's chosen job folder (source/export/info/assets); null = temp workspace
  renderJob: null,
};

const $st = (s) => document.querySelector(s);
const stStatus = (text, kind) => {
  const el = $st("#st-status");
  if (!text) { el.innerHTML = ""; return; }
  const cls = { ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" }[kind] || "";
  el.innerHTML = `<div class="cd-alert ${cls}"><div class="cd-alert__message"><p>${esc(text)}</p></div></div>`;
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
  $st("#st-need-engine").hidden = full;
  $st("#st-wizard").hidden = !full;
  $st("#edit-lock").hidden = full;
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

// ---------- E2: source ----------
async function stUseSource(path) {
  const r = await fetch(`${ENGINE}/api/statement/probe?src=${encodeURIComponent(path)}`);
  if (!r.ok) { stStatus("Couldn't read that video.", "error"); return; }
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
    const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Downloading…", "busy"));
    await stUseSource(j.result.path);
  } catch (e) { stStatus("Download failed: " + e.message, "error"); }
  finally { $st("#st-get").disabled = false; }
};

$st("#st-pick").onclick = async () => {
  try {
    const r = await fetch(`${ENGINE}/api/pick-file`, { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (path) await stUseSource(path);
  } catch (e) { stStatus("Couldn't open the file picker.", "warn"); }
};

// ---------- E1: job folder (everything saves here) ----------
$st("#st-folder-pick").onclick = async () => {
  try {
    const q = encodeURIComponent("Choose a folder to save this statement clip");
    const r = await fetch(`${ENGINE}/api/pick-folder?prompt=${q}`, { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (!path) return;
    ST.jobDir = path;
    $st("#st-folder-path").innerHTML =
      `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Saving to <strong>${esc(path)}</strong> — download, final clip and thumbnail land in <code>source/</code>, <code>export/</code>.`;
    stSave();                                                // start persisting into this folder
    try {                                                    // folder already holds a project? offer to reopen it
      const lr = await fetch(`${ENGINE}/api/statement/load-project?dir=${encodeURIComponent(path)}`);
      if (lr.ok) { const proj = await lr.json(); if (stWorthResuming(proj)) stOfferResume(proj, "This folder already has a saved project."); }
    } catch (e) { /* none */ }
  } catch (e) { stStatus("Couldn't open the folder picker.", "warn"); }
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
  stSyncPreview(0, row.children[SYNC_OFFSETS.indexOf(0)]);   // default selection = "As is"
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

async function stSyncContinue(skip) {
  if (skip) ST.offset = 0;                                    // "it's in sync" → use the original, no re-encode
  const btns = [$st("#st-sync-ok"), $st("#st-sync-skip")];
  try {
    btns.forEach((b) => (b.disabled = true));
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
  finally { btns.forEach((b) => (b.disabled = false)); }
}
$st("#st-sync-ok").onclick = () => stSyncContinue(false);
$st("#st-sync-skip").onclick = () => stSyncContinue(true);
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
    await stJob(job_id, (jj) => stStatus(jj.progress || "Transcribing…", "busy"));
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
  // Alternate close/general, toggling only across a GAP (a real cut). User overrides win.
  let shot = "close", prevOut = null;
  ST.segments.forEach((s) => {
    if (!s.sel) return;
    if (prevOut !== null && s.in - prevOut > 0.25) shot = shot === "close" ? "general" : "close";
    s.shot = s.userShot || shot;
    shot = s.shot;                                     // an override re-anchors the alternation
    prevOut = s.out;
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
      b.onclick = () => { s.userShot = b.dataset.shot; stAutoShots(); stRenderSegList(); stSave(); };
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

// ---------- E6: framing ----------
let frameTimer = null;
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
function stFrameRefresh() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => {
    const preset = document.querySelector('input[name="st-preset"]:checked').value;
    const q = (shot) => `${ENGINE}/api/statement/still?src=${encodeURIComponent(ST.src)}&t=${stFrameT().toFixed(2)}
      &shot=${shot}&preset=${preset}&sx=${ST.subject.x}&sy=${ST.subject.y}&width=420&cb=${Date.now()}`.replace(/\s+/g, "");
    $st("#st-frame-general").src = q("general");
    $st("#st-frame-close").src = q("close");
  }, 250);
}
$st("#st-sx").oninput = (e) => { ST.subject.x = e.target.value / 100; stFrameRefresh(); };
$st("#st-sy").oninput = (e) => { ST.subject.y = e.target.value / 100; stFrameRefresh(); };
document.querySelectorAll('input[name="st-preset"]').forEach((r) => (r.onchange = stFrameRefresh));

// ---------- E8: render + thumbnail ----------
$st("#st-render").onclick = async () => {
  const sel = ST.segments.filter((s) => s.sel);
  if (!sel.length) return stStatus("Tick at least one sentence.", "warn");
  const body = {
    src: ST.src,
    segments: sel.map((s) => ({ in: s.in, out: s.out, shot: s.shot, text: s.text, words: s.words })),
    subject: ST.subject,
    preset: document.querySelector('input[name="st-preset"]:checked').value,
    lower_third: {
      name: $st("#st-lt-name").value.trim(),
      title: $st("#st-lt-title").value.trim(),
      title2: $st("#st-lt-title2").value.trim(),
      align: $st("#st-lt-align").value,
    },
    ending: { style: document.querySelector('input[name="st-ending"]:checked').value },
    captions: $st("#st-captions").checked,
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
    const j = await stJob(job_id, (jj) => stStatus(jj.progress || "Rendering…", "busy"));
    ST.renderJob = job_id;
    $st("#st-player").src = `${ENGINE}/api/preview/${job_id}?cb=${Date.now()}`;
    $st("#st-download").href = `${ENGINE}/api/export/${job_id}`;
    const saved = $st("#st-saved");
    if (j.result && j.result.export) {
      saved.hidden = false;
      saved.querySelector(".cd-alert__message").innerHTML =
        `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Saved to <strong>${esc(j.result.export)}</strong> (in the job's <code>export/</code> folder).`;
    } else { saved.hidden = true; }
    stThumbs(body.preset);
    $st("#st-card-out").hidden = false;
    stStatus("Done. Preview below — and pick a thumbnail.", "ok");
    $st("#st-card-out").scrollIntoView({ behavior: "smooth" });
  } catch (e) { stStatus("Render failed: " + e.message, "error"); }
  finally { $st("#st-render").disabled = false; }
};

function stThumbs(preset) {
  // Thumbnail = clean GENERAL still, same size as the video, mouth likely closed →
  // offer the quiet moments: the END of the three longest selected sentences.
  const sel = ST.segments.filter((s) => s.sel);
  const cands = [...sel].sort((a, b) => (b.out - b.in) - (a.out - a.in)).slice(0, 3)
    .map((s) => +(s.out - 0.15).toFixed(2));
  const wrap = $st("#st-thumbs");
  wrap.innerHTML = "";
  const dl = $st("#st-thumb-dl");
  const urlFor = (t, w, d) => `${ENGINE}/api/statement/still?src=${encodeURIComponent(ST.src)}&t=${t}` +
    `&shot=general&preset=${preset}&sx=${ST.subject.x}&sy=${ST.subject.y}&width=${w}` +
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
}

// ---------- Autosave & resume (browser localStorage + <folder>/quickvid-project.json) ----------
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
    type: val('input[name="st-type"]:checked') || "statement",
    jobDir: ST.jobDir, src: ST.src, probe: ST.probe, offset: ST.offset,
    ranges: stRangeRows(), segments: ST.segments, subject: ST.subject, frameT: ST.frameT,
    preset: val('input[name="st-preset"]:checked') || "reels",
    ending: val('input[name="st-ending"]:checked') || "over_footage",
    captions: $st("#st-captions").checked,
    lt: { name: $st("#st-lt-name").value, title: $st("#st-lt-title").value,
          title2: $st("#st-lt-title2").value, align: $st("#st-lt-align").value },
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
      body: JSON.stringify({ dir: ST.jobDir, project: snap }),
    }).catch(() => {});
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
    ST.jobDir = p.jobDir || null;
    if (ST.jobDir) $st("#st-folder-path").innerHTML =
      `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Saving to <strong>${esc(ST.jobDir)}</strong>.`;
    ST.src = p.src || null; ST.probe = p.probe || null; ST.offset = p.offset || 0;
    ST.subject = p.subject || { x: 0.5, y: 0.40 }; ST.frameT = (p.frameT == null ? null : p.frameT);
    ST.segments = p.segments || [];
    check("st-preset", p.preset || "reels");
    check("st-ending", p.ending || "over_footage");
    if (p.lt) { $st("#st-lt-name").value = p.lt.name || ""; $st("#st-lt-title").value = p.lt.title || "";
                $st("#st-lt-title2").value = p.lt.title2 || ""; $st("#st-lt-align").value = p.lt.align || "center"; }
    $st("#st-captions").checked = p.captions !== false;
    $st("#st-sx").value = Math.round((ST.subject.x != null ? ST.subject.x : 0.5) * 100);
    $st("#st-sy").value = Math.round((ST.subject.y != null ? ST.subject.y : 0.4) * 100);
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
    stOfferResume(saved, "Autosaved " + stAgo(saved.savedAt) + ".");
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
if (typeof state !== "undefined") stModeChanged(state.mode === "full");
