// OCHA QuickVid — the web UI for the LOCAL engine (engine-only since v0.4:
// the in-browser "Lite" renderer is gone; every job runs through real ffmpeg).
// One canonical host: localhost and 127.0.0.1 are DIFFERENT origins to the browser,
// so autosave (localStorage) done on one is invisible on the other. Normalize early.
if (location.hostname === "localhost") location.replace(location.href.replace("//localhost", "//127.0.0.1"));
const $ = (s) => document.querySelector(s);
const ENGINE = 'http://127.0.0.1:17870';                 // the local companion engine
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { url: null, engineUp: false, engine: null, enginePath: null, jobDir: null };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const ALERT = { busy: "", ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" };
function setStatus(text, kind, percent) {
  const el = $("#status");
  if (!text) { el.innerHTML = ""; return; }
  const p = typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const bar = p === null ? "" :
    `<div class="cd-progress"><div class="cd-progress__fill" style="width:${p}%"></div></div><div class="cd-progress__pct">${p}%</div>`;
  el.innerHTML = `<div class="cd-alert ${ALERT[kind] || ""}"><div class="cd-alert__message"><p>${esc(text)}</p>${bar}</div></div>`;
}

// ---- engine version contract ----------------------------------------------
// The page always ships the newest code (GitHub Pages); the engine reports its
// version in /api/health. So the page just compares.
//  * ENGINE_MIN   — oldest engine whose /api contract matches THIS page. Below it,
//    the engine would silently drop new fields (Paolo's v0.2 → dropped subtitles,
//    tail, runs cutting…), so we HARD-GATE: block + "reinstall to update". Bump this
//    ONLY when the page starts sending/expecting something older engines can't handle
//    — not for UI-only tweaks (else people get nagged to reinstall for nothing).
//  * ENGINE_LATEST — newest version worth prompting a (non-blocking) update to. Keep
//    == ENGINE_MIN unless a newer engine adds a real user benefit an older-but-still-
//    compatible engine lacks; then the soft banner appears.
const ENGINE_MIN = "0.5.0";
// Newest published version. SEEDED here (so the banner still works offline) and then
// corrected from the repo's VERSION file at load — see trackLatestVersion below.
// It used to be hardcoded only, which meant the banner quietly went stale every
// release: it was still advertising 0.6.3 while main had moved on to 0.7.0.
// This page's OWN version — the repo's VERSION at the time it was published. It is
// also the newest published version by definition (the page always ships from main),
// so ENGINE_LATEST seeds from it: one constant to bump, not two that can drift.
const APP_VERSION = "2026.0.38";
let ENGINE_LATEST = APP_VERSION;
const ENGINE_LATEST_URL = "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/VERSION";

// numeric semver-ish compare: cmpVer("0.2.0","0.3.0") < 0
function cmpVer(a, b) {
  const pa = String(a || "0").split("."), pb = String(b || "0").split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ---- engine gate: the app IS the engine's UI ----
// Three states: UP (compatible) · OUTDATED (reachable but too old → hard gate) · DOWN (unreachable).
async function detectEngine() {
  let reachable = false, version = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 900);
    const r = await fetch(ENGINE + "/api/health", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const h = await r.json();
    if (h && h.app === "ocha-quickvid-engine") { reachable = true; version = h.version || "0"; state.engine = h; }
  } catch (e) { /* not running */ }
  const outdated = reachable && cmpVer(version, ENGINE_MIN) < 0;
  const up = reachable && !outdated;
  if (up !== state.engineUp || outdated !== state.engineOutdated || version !== state.engineVersion || !state._gated) {
    state.engineUp = up; state.engineOutdated = outdated; state.engineVersion = version; state._gated = true;
    gate();
  }
}

function gate() {
  const up = state.engineUp, outdated = state.engineOutdated, ver = state.engineVersion;
  // the gate card shows whenever the app can't run: engine DOWN or too OLD
  $("#st-need-engine").hidden = up;
  document.querySelector(".mode-tabs").hidden = !up;
  if (!up) { $("#panel-titles").hidden = true; $("#panel-edit").hidden = true; $("#panel-toolbox").hidden = true; }
  else if ($("#panel-titles").hidden && $("#panel-edit").hidden) {
    (typeof stShowPanel === "function") ? stShowPanel("edit") : ($("#panel-edit").hidden = false);
  }
  // gate card copy: OUTDATED reuses the same install buttons (re-running the installer IS the updater)
  $("#st-gate-title").textContent = outdated ? "Update the OCHA QuickVid engine" : "Set up OCHA QuickVid on this computer";
  $("#st-gate-intro").hidden = outdated;
  const al = $("#st-gate-alert");
  if (outdated) {
    al.hidden = false;
    al.querySelector("p").innerHTML =
      `Your engine is <strong>v${esc(ver)}</strong>, but this page needs <strong>v${ENGINE_MIN}</strong> or newer — an old engine would quietly produce wrong output. ` +
      `<strong>Re-run the installer below to update it</strong> (~2 min, your projects are safe). If it says the engine is already running, close it first (Mac: quit “OCHA QuickVid engine”; Windows: close the minimized engine window), then run the installer. <em>After this one update, OCHA QuickVid keeps itself current automatically — you won’t need to do this again.</em>`;
  } else { al.hidden = true; }
  // footer engine-status chip (always visible; the reinstall path lives beside it)
  const fe = $("#foot-engine"), fet = $("#foot-engine-txt");
  if (fe && fet) {
    const ff = state.engine && state.engine.ffmpeg;
    fe.classList.toggle("is-down", !up);
    fet.textContent = up ? `Engine ${ver}${ff ? " · ffmpeg ✓" : ""}`
                         : outdated ? `Engine ${ver} — update needed`
                                    : "Engine not running";
  }
  if ($("#news-ver")) $("#news-ver").textContent = ver ? `v${ver}` : "";
  // chip
  const el = $("#mode-chip");
  el.className = "mode-chip " + (up ? "mode-chip--full" : "mode-chip--browser");
  el.innerHTML = up
    ? `<i class="fa-regular fa-bolt" aria-hidden="true"></i> Engine connected · v${esc(ver || "")}`
    : outdated
      ? `<i class="fa-regular fa-triangle-exclamation" aria-hidden="true"></i> Engine v${esc(ver)} — update needed`
      : '<i class="fa-regular fa-plug" aria-hidden="true"></i> Engine not running — set up below';
  // soft, dismissible "update available" banner — only when UP and behind ENGINE_LATEST
  const banner = $("#st-update-banner");
  if (up && !state._updDismissed && cmpVer(ver, ENGINE_LATEST) < 0) {
    $("#st-upd-cur").textContent = ver; $("#st-upd-new").textContent = ENGINE_LATEST;
    banner.hidden = false;                       // engine self-updates on next Start — no download link
  } else { banner.hidden = true; }
  // The caption editor needs an engine that understands `cues` (0.11.0+): an older
  // one silently IGNORES the field, and the user's edits would vanish into a normal
  // render. Feature-gate the buttons instead of hard-gating the whole app.
  const capsOk = up && cmpVer(ver, "0.11.0") >= 0;
  document.querySelectorAll(".cap-review").forEach((el) => { el.hidden = !capsOk; });
  // …and the Look picker needs 0.12.0+ (`look` field) for the same reason.
  const lookOk = up && cmpVer(ver, "0.12.0") >= 0;
  document.querySelectorAll(".look-review").forEach((el) => { el.hidden = !lookOk; });
  // Text on screen needs 2026.0.14+ (`texts` field + the engine renderer).
  const txOk = up && cmpVer(ver, "2026.0.14") >= 0;
  document.querySelectorAll(".texton-review").forEach((el) => { el.hidden = !txOk; });
  // The Toolbox tab needs 0.13.0+ (/api/compress). Older engine → the whole tab
  // hides; if the user was ON it when the engine changed, fall back to Edit.
  const tbOk = up && cmpVer(ver, "0.13.0") >= 0;
  const tbTab = $("#tab-toolbox");
  if (tbTab) {
    tbTab.hidden = !tbOk;
    if (!tbOk && up && !$("#panel-toolbox").hidden) stShowPanel("edit");
  }
  if (typeof stModeChanged === "function") stModeChanged(up);     // Edit wizard shows/hides
}

// Ask GitHub what the newest published version actually is, so the "update available"
// banner can't drift out of date between releases. Falls back silently to the seeded
// ENGINE_LATEST when offline (VPN, blocked, no network) — this must never block the UI.
(function trackLatestVersion() {
  try {
    fetch(ENGINE_LATEST_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => {
        const v = String(t || "").trim();
        if (/^\d+\.\d+/.test(v) && cmpVer(v, ENGINE_LATEST) > 0) {
          ENGINE_LATEST = v;
          gate();                                   // repaint the banner with the real number
        }
      })
      .catch(() => {});
  } catch (e) { /* no fetch available — keep the seeded value */ }
})();
document.addEventListener("click", (e) => {
  if (e.target.closest("#st-upd-dismiss")) { state._updDismissed = true; $("#st-update-banner").hidden = true; }
  // copy the Mac install one-liner
  const copyBtn = e.target.closest("#mac-install-copy");
  if (copyBtn) {
    const cmd = $("#mac-install-cmd").textContent.trim();
    const label = copyBtn.querySelector(".cd-button__text");
    const done = () => { if (label) { label.textContent = "Copied!"; setTimeout(() => { label.textContent = "Copy"; }, 1600); } };
    // navigator.clipboard needs a secure context; fall back to a hidden textarea (works on 127.0.0.1)
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(cmd).then(done).catch(() => fallbackCopy(cmd, done));
    else fallbackCopy(cmd, done);
  }
});
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) {}
  document.body.removeChild(ta);
}

  // Bring a picked file into the job folder, with progress. Mirrors the Edit tab's
  // stAdoptSource: both tabs must behave the same, or a project made on one is not
  // portable in the way a project made on the other is.
  async function tAdoptSource(path) {
    if (!path || !state.jobDir) return path;
    try {
      const r = await fetch(ENGINE + "/api/statement/adopt-source", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: path, dir: state.jobDir }),
      });
      if (!r.ok) return path;
      const j = await r.json();
      if (!j.job_id) return j.path || path;          // already inside the folder
      let done = null;
      for (;;) {
        await sleep(700);
        done = await (await fetch(ENGINE + "/api/jobs/" + j.job_id)).json();
        setStatus(done.progress || "Copying into the project folder\u2026", "busy", done.percent);
        if (done.status !== "queued" && done.status !== "running") break;
      }
      setStatus("");
      return (done.result && done.result.path) || path;
    } catch (e) { return path; }
  }

// native picker on the engine → a path it reads straight off disk (no upload, no size limit)
async function enginePick() {
  try {
    const r = await fetch(ENGINE + "/api/pick-file", { method: "POST" });
    if (!r.ok) return;
    const { path: picked } = await r.json();
    // Copy it into the job folder first, so the folder is self-contained
    // (same contract as the Edit tab). Falls back to the original on any problem.
    const path = await tAdoptSource(picked);
    if (path) {
      const changed = state.enginePath && state.enginePath !== path;
      state.enginePath = path; $("#drop-text").textContent = path.split(/[\\/]/).pop(); $("#drop").classList.add("has-file"); setStatus("");
      OchaBrandPreview.refreshAll();              // element previews can now use real footage
      // Load the Look stills straight away. They used to wait for a button press,
      // and the magnifier is hidden until a still exists — so "open the bigger
      // view" simply did nothing, with no way to tell why. The stills are cached
      // server-side, so this costs one render per video, not per visit.
      try { tLook.preview(); } catch (e) {}
      tCaptionDefault(path);                      // caption look follows the video's shape
      if (changed) tCaps.clear("Video changed — captions reset.");   // stale cue text must never burn onto another clip
      if (changed) tLook.resetPreview();                             // stills belong to the old clip
    }
  } catch (e) { setStatus("Couldn't open the file picker.", "warn"); }
}

// Job folder for Titles & branding — same contract as the Edit tab: the finished
// video lands in <chosen folder>/<project name>/export/ with a README, instead of a
// temporary spot inside the app (which a reinstall would wipe). Optional: skip it and
// the old download-from-temp flow still works.
function ftSafeName(s) {
  return (s || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80);
}
/* The job folder is REQUIRED on both tabs — the behaviour lives in field.js so
   the Edit tab and this one can never drift apart. */
const ftFolderMissing = (on) => OchaFolder.mark($("#f-folder"), on);

const ftPick = document.getElementById("f-folder-pick");
if (ftPick) ftPick.onclick = async () => {
  const name = ($("#f-proj-name").value || "").trim();
  if (!name) {
    setStatus("Give the job a name first — the folder is created with that name.", "warn");
    $("#f-proj-name").focus();
    return;
  }
  try {
    const q = encodeURIComponent(`Choose WHERE to create the "${name}" job folder`);
    const r = await fetch(`${ENGINE}/api/pick-folder?prompt=${q}`, { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (!path) return;
    state.jobDir = path.replace(/[\/\\]+$/, "") + "/" + ftSafeName(name);
    $("#f-folder-path").innerHTML =
      `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Job folder: <strong>${esc(state.jobDir)}</strong> — the finished video lands in its <code>export/</code> folder, and your settings autosave here.`;
    setStatus("");
    ftFolderMissing(false);                           // requirement satisfied
    // Same-named job already there? Offer to pick up where it left off.
    try {
      const lr = await fetch(`${ENGINE}/api/statement/load-project?dir=${encodeURIComponent(state.jobDir)}`);
      if (lr.ok) {
        const project = await lr.json();          // this endpoint returns the project ITSELF
        if (project && project.mode === "titles" &&
            confirm(`"${name}" already exists here. Reload its saved settings?`)) {
          ftRestore(project);
          setStatus("Reloaded the saved settings for this job.", "ok");
          return;                                     // don't overwrite what we just read
        }
      }
    } catch (e) { /* no project there yet — fine */ }
    ftSaveNow();                                      // first autosave creates the file
  } catch (e) { setStatus("Couldn't open the folder picker.", "warn"); }
};

// full mode: hand the job to the engine (real ffmpeg) and stream the result back over localhost
async function renderViaEngine(lowerThirds, ending, subtitles, bug, pins, cues, look, texts, rtl) {
  const body = { video: state.enginePath, lower_thirds: lowerThirds,
                 ending: { style: ending.style, logo_y_frac: ending.logo_y_frac },
                 subtitles: subtitles || { on: false, style: "box" }, bug: bug || { on: false },
                 pins: pins || [], cues: cues || undefined, look: look || undefined,
                 texts: (texts && texts.length) ? texts : undefined,
                 rtl: rtl, dir: state.jobDir };
  // Which features actually get used — the whole point of the pings. Renders are
  // counted every time (the volume figure); each feature counts once per session.
  try {
    OchaAnalytics.ping("render:titles", false);
    if (subtitles && subtitles.on) OchaAnalytics.ping("use:captions");
    if (lowerThirds && lowerThirds.length) OchaAnalytics.ping("use:lowerthird");
    if (ending && ending.style && ending.style !== "none") OchaAnalytics.ping("use:ending");
    if (pins && pins.length) OchaAnalytics.ping("use:pin");
    if (texts && texts.length) OchaAnalytics.ping("use:texton");
    if (look) OchaAnalytics.ping("use:look");
    if (rtl) OchaAnalytics.ping("use:rtl");
  } catch (e) {}
  const r = await fetch(ENGINE + "/api/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { let m = "Engine error"; try { m = (await r.json()).detail || m; } catch (e) {} throw new Error(m); }
  const { job_id } = await r.json();
  let job;
  do {
    await sleep(1000);
    job = await (await fetch(ENGINE + "/api/jobs/" + job_id)).json();
    setStatus(job.progress || "Rendering with the OCHA engine…", "busy", job.percent);
  } while (job.status !== "done" && job.status !== "error");
  if (job.status === "error") throw new Error(job.error || "Render failed");
  return (await fetch(ENGINE + "/api/export/" + job_id)).blob();
}

// "53", "0:53", "1:23:04" → seconds ; seconds → mm:ss
const parseTime = (s) => {
  s = String(s).trim(); if (!s) return 0;
  if (s.includes(":")) { const p = s.split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; }
  return parseFloat(s) || 0;
};
const fmtMMSS = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); };

/* lower thirds: the SHARED component (browser/lowerthird.js) — the Edit tab mounts
   the same one. Titles default: appears at 0:10, left-aligned, 4s. */
const ftLt = OchaLowerThirds.mount({
  rows: $("#lt-rows"), add: $("#lt-add"),
  onChange: () => { ftSave(); OchaBrandPreview.refreshAll(); },
  defaults: { start: 10, duration: 4, align: "left" },
});
ftLt.ensure();

// ---- the video box: click → the engine's native file picker ----
const drop = $("#drop");
drop.addEventListener("click", enginePick);
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enginePick(); } });

// ---- run ----
/* ---------- Titles & branding: project autosave ----------
   Same contract as the Edit tab, reusing its (mode-agnostic) endpoints: the form
   state is written to <job folder>/<name>.ochaquickvid.json so a job can be
   reopened later. Only runs once a folder has been picked — without one there's
   nowhere durable to put it. Debounced, and suppressed while restoring so
   repopulating the form doesn't save over the file it just read. */
let ftSaveTimer = null, ftRestoring = false;

/* Path of the video RELATIVE to the job folder, when it lives inside it. Mirrors
   statement.js stRelSrc() — that is what survives the folder being renamed, moved,
   or opened on another machine. */
function ftRelSrc() {
  if (!state.enginePath || !state.jobDir) return null;
  const dir = state.jobDir.replace(/[/\\]+$/, "");
  const norm = (x) => x.replace(/\\/g, "/");
  return norm(state.enginePath).startsWith(norm(dir) + "/")
    ? norm(state.enginePath).slice(norm(dir).length + 1) : null;
}

function ftSnapshot() {
  const f = ftCollect();
  return {
    v: 1, mode: "titles", name: ($("#f-proj-name").value || "").trim(),
    // `src` + `src_rel` are the keys the ENGINE's _resolve_src() reads, so a moved or
    // renamed folder still finds the video. This used to store `video` only, which
    // that resolver never looks at — every reopened Titles job reported its source
    // missing. `video` is still written for projects saved before 2026-08-06.
    video: state.enginePath || null,
    src: state.enginePath || null, src_rel: ftRelSrc(),
    lower_thirds: f.lowerThirds, ending: f.ending,
    subtitles: f.subtitles, bug: f.bug, pins: f.pins, look: f.look,
    saved_at: new Date().toISOString(),
  };
}

async function ftSaveNow() {
  if (!state.jobDir || ftRestoring) return;
  const snap = ftSnapshot();
  try {
    await fetch(`${ENGINE}/api/statement/save-project`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: state.jobDir, project: snap, name: snap.name || undefined }),
    });
  } catch (e) { /* autosave is best-effort — never interrupt the user */ }
}
function ftSave() { if (ftRestoring) return; clearTimeout(ftSaveTimer); ftSaveTimer = setTimeout(ftSaveNow, 700); }

function ftRestore(p) {
  if (!p) return;
  ftRestoring = true;
  try {
    if (p.name) $("#f-proj-name").value = p.name;
    // The video itself, not just the settings — restoring the form onto no video
    // left the tab looking ready while every render and preview had nothing to work
    // from. `src` is resolved by the engine (it may have moved); `video` is the
    // pre-2026-08-06 key.
    const vid = p.src || p.video;
    if (vid) {
      state.enginePath = vid;
      $("#drop-text").textContent = vid.split(/[\\/]/).pop();
      $("#drop").classList.add("has-file");
    }
    ftLt.restore(p.lower_thirds);
    const end = document.querySelector(`input[name="ending"][value="${(p.ending || {}).style || "none"}"]`);
    if (end) end.checked = true;
    const ly = (p.ending || {}).logo_y_frac;
    if (Number.isFinite(ly)) $("#t-logoy").value = Math.round(ly * 100);
    tLogoYLabel(); tLogoYVis();
    if (p.subtitles) { $("#t-subs-on").checked = !!p.subtitles.on; tSetSubStyle(p.subtitles.style || "box"); }
    if (p.bug) $("#t-bug-on").checked = !!p.bug.on;
    tLook.restore(p.look);
    tTexts.restore(p.texts);
    $("#t-rtl").checked = !!p.rtl;
    tLoc.restore(p.pins || p.pin);        // `pin` = a project saved before Jul 2026
    document.querySelectorAll("#panel-titles input, #panel-titles select")
      .forEach((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
  } finally { ftRestoring = false; }
  // outside the guard: these must run with saving re-enabled
  if (state.enginePath) {
    OchaBrandPreview.refreshAll();
    try { tLook.preview(); } catch (e) {}
  }
}

/* Reopen an earlier job from its .ochaquickvid.json. Same engine endpoint the Edit
   tab uses — it is mode-agnostic — so the MODE is checked here: a project saved on
   the other tab would half-restore and look like a bug. */
$("#f-open-proj").onclick = async () => {
  try {
    setStatus("Opening the project file…", "busy");
    const r = await fetch(`${ENGINE}/api/statement/open-project`, { method: "POST" });
    if (!r.ok) { setStatus((await r.json()).detail || "Couldn't open that file.", "warn"); return; }
    const { project, dir, source, source_name } = await r.json();
    if (project && project.mode !== "titles") {
      setStatus("That's an Edit project — open it on the “Edit a video” tab instead.", "warn");
      return;
    }
    ftRestore(project);
    if (dir) {                                    // where the file IS beats any stored path
      state.jobDir = dir;
      ftFolderMissing(false);
      $("#f-folder-path").innerHTML =
        `<i class="fa-regular fa-circle-check" aria-hidden="true"></i> Reopened from <strong>${esc(dir)}</strong> — edits save back here.`;
    }
    if (source === "missing") {
      setStatus(`Opened “${project.name || "project"}”, but its video (${esc(source_name || "the source")}) isn't where it was — choose it again below.`, "warn");
    } else {
      if (source === "moved") setStatus("Source video found in this folder — path updated.", "ok");
      else setStatus(`Opened “${project.name || "project"}” — continue below.`, "ok");
    }
    ftSave();
  } catch (e) { setStatus("Couldn't open the project: " + e.message, "error"); }
};

// any edit in the Titles panel schedules a save (no-op until a folder is picked)
["input", "change"].forEach((ev) =>
  document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest("#panel-titles")) ftSave(); }));

// One reader for the whole Titles form — used by both "Add titles & branding" and
// the autosave, so the saved project can never drift from what gets rendered.
function ftCollect() {
  return {
    lowerThirds: ftLt.collect(),
    ending: { style: document.querySelector('input[name="ending"]:checked').value,
              logo_y_frac: tLogoY() },
    subtitles: { on: $("#t-subs-on").checked, style: tSubsStyle },
    bug: { on: $("#t-bug-on").checked },
    pins: tLoc.collect(),
    look: tLook.collect(),
    texts: tTexts.collect(),
    rtl: $("#t-rtl").checked || undefined,   // undefined = let the engine auto-detect
  };
}

$("#run").onclick = async () => {
  if (!state.enginePath) return setStatus("Choose a video first.", "warn");
  if (OchaFolder.block($("#f-folder"), state.jobDir, (m) => setStatus(m, "error"))) return;
  const { lowerThirds, ending, subtitles, bug, pins, look, texts, rtl } = ftCollect();
  if (!lowerThirds.length && ending.style === "none" && !subtitles.on && !bug.on && !pins.length && !texts.length)
    return setStatus("Add at least one lower third, subtitles, text on screen, the OCHA logo, a location strip, or pick an ending.", "warn");

  // Reviewed captions ride along only while they still match the chosen video —
  // otherwise the engine transcribes fresh (never burn one clip's text on another).
  const cues = subtitles.on ? tCaps.collect(state.enginePath) : null;
  const staleNote = subtitles.on && tCaps.stale(state.enginePath)
    ? " (video changed since the caption review — using fresh automatic captions)" : "";

  $("#run").disabled = true;
  const t0 = performance.now();
  try {
    setStatus("Rendering with the OCHA engine…" + staleNote, "busy");
    // Same shared waiting lines as the Edit tab — this render is the one long step
    // on this tab, so it hooks in here rather than in a poller.
    var _wait = window.OchaWaiting ? OchaWaiting.start($("#t-waiting")) : { stop: function () {} };
    let blob;
    try {
      blob = await renderViaEngine(lowerThirds, ending, subtitles, bug, pins, cues, look, texts, rtl);  // real ffmpeg, no limits
    } finally { _wait.stop(); }
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(blob);
    $("#player").src = state.url;
    // Already saved in the job folder's export/ — take them there rather than making
    // a second copy in Downloads (same change as the Edit tab).
    $("#download").onclick = () => {
      if (!state.jobDir) return;
      fetch(`${ENGINE}/api/open-folder`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.jobDir }),
      }).catch(() => {});
    };
    $("#preview").hidden = false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`Done — full quality · ${(blob.size / 1e6).toFixed(1)} MB · ${secs}s. Preview below.`, "ok");
    $("#preview").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e && e.message || e), "error");
  } finally {
    $("#run").disabled = false;
  }
};

// ---- Titles subtitles: ON/OFF + Social/Event style with preview ----
let tSubsStyle = "box";
function tSetSubStyle(style) {
  tSubsStyle = style;
  $("#t-substyle-box").classList.toggle("cd-button--outline", style !== "box");
  $("#t-substyle-event").classList.toggle("cd-button--outline", style === "box");
  if (tBp.subs) tBp.subs.refresh();                    // repaints example OR live frame
}
/* Declared above tSetSubStyle for the same reason as the Edit tab's stBp:
   tSetSubStyle reads it and runs during load, and a const read in its temporal
   dead zone throws instead of reading undefined. */
const tBp = {};
// The EXAMPLE for the current style. The live preview owns the <img> (see
// browser/brandpreview.js) and calls this when there's no video yet — so the
// picker and the preview never write the same element from two places.
function tSubExample() {
  const box = tSubsStyle !== "gradient";
  return {                                             // box = 9:16 reel, event = 16:9 — intrinsic size avoids stretch/shift
    src: box ? "img/ex-sub-box.jpg" : "img/ex-sub-event.jpg",
    width: 360, height: box ? 640 : 203,
    caption: box ? "Boxed — white text on a grey box. Reels and 4:5 feed posts."
                 : "Clean — white text over a soft dark gradient. Square and 16:9 screens.",
  };
}
/* This tab has no format picker - it brands a finished clip - so the caption look
   comes from the VIDEO'S OWN SHAPE. It never did: the style was hardcoded to boxed,
   so a finished 16:9 event clip got boxed captions here while the Edit tab gave it
   clean ones for the same footage. Same map as the Edit tab. */
async function tCaptionDefault(path) {
  if (tSubsTouched) return;                      // never override a manual choice
  try {
    const r = await fetch(`${ENGINE}/api/statement/probe?src=${encodeURIComponent(path)}`);
    if (!r.ok) return;
    const p = await r.json();
    state.probe = p;                 // the ending preview needs the duration
    if (!p.width || !p.height) return;
    tSetSubStyle(OchaCaptions.styleFor(OchaCaptions.fmtFromSize(p.width, p.height)));
  } catch (e) { /* a probe failure just leaves the default alone */ }
}
let tSubsTouched = false;
$("#t-substyle-box").onclick = () => { tSubsTouched = true; tSetSubStyle("box"); };
$("#t-substyle-event").onclick = () => { tSubsTouched = true; tSetSubStyle("gradient"); };

/* ---- caption editor: the SHARED component (browser/captions.js) ----
   The Edit tab mounts the same one. Generate = transcribe once (a job), review
   the text, then Render sends the edited cues and skips re-transcribing. */
const tCaps = OchaCaptions.mount({ list: $("#t-caps-list"), status: $("#t-caps-status") });

/* ---- footage Look: the SHARED component (browser/look.js) — Edit tab mounts
   the same one. Preview stills use the engine's own conversion + chain. */
const tLook = OchaLook.mount({
  grid: $("#t-look-grid"), fix: $("#t-look-fix"), previewBtn: $("#t-look-prev"),
  adjust: $("#t-look-adjust"),
  getVideo: () => state.enginePath, getTime: () => 1, engine: ENGINE,
  onChange: () => { ftSave(); OchaBrandPreview.refreshAll(); },
});
// Text on screen — the SHARED component (browser/texton.js); Edit tab mounts the same one.
// Auto-tick RTL the moment Arabic is typed anywhere in this tab. It stays a
// CHECKBOX (not pure detection) because the OCHA bug has no text to detect and a
// mixed-language video must mirror as ONE layout, not per element.
const AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function tAutoRtl() {
  const box = $("#t-rtl");
  if (!box || box.dataset.touched) return;               // never fight a manual choice
  const txt = [...document.querySelectorAll("#panel-titles input[type=text]")]
    .map((el) => el.value).join(" ");
  if (AR_RE.test(txt)) box.checked = true;
}
document.addEventListener("input", (e) => {
  if (e.target.closest && e.target.closest("#panel-titles")) tAutoRtl();
});
$("#t-rtl").addEventListener("change", (e) => { e.target.dataset.touched = "1"; });

const tTexts = OchaTextOn.mount({
  rows: $("#t-tx-rows"), add: $("#t-tx-add"), onChange: () => { ftSave(); OchaBrandPreview.refreshAll(); },
});
$("#t-caps-gen").onclick = async () => {
  if (!state.enginePath) return setStatus("Choose a video first.", "warn");
  const btn = $("#t-caps-gen");
  btn.disabled = true;
  try {
    setStatus("Transcribing for captions — a few minutes for long videos…", "busy");
    const r = await fetch(ENGINE + "/api/captions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: state.enginePath }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Couldn't start the caption job.");
    const { job_id } = await r.json();
    let job;
    do {
      await sleep(1000);
      job = await (await fetch(ENGINE + "/api/jobs/" + job_id)).json();
      setStatus(job.progress || "Transcribing…", "busy", job.percent);
    } while (job.status !== "done" && job.status !== "error");
    if (job.status === "error") throw new Error(job.error || "Transcription failed.");
    tCaps.setShape(ENGINE, "reels");   // Titles tab brands a finished clip; reels is the tight case
    tCaps.setCues((job.result || {}).cues || [], state.enginePath);
    setStatus("Captions ready — review below, then render.", "ok");
  } catch (e) { setStatus("Error: " + (e && e.message || e), "error"); }
  finally { btn.disabled = false; }
};
/* ---- location strips: the SHARED component (browser/location.js) ----
   The Edit tab mounts the same one. Change the strip's fields, defaults or
   behaviour in location.js and BOTH tabs move together. */
const tLoc = OchaLocation.mount({
  rows: $("#t-loc-rows"), add: $("#t-loc-add"),
      // Rows are ADDED at runtime, so a preview wired only at mount never sees
      // them — and nothing else triggers a refresh, so the section sat on its
      // static example forever. The component's own onChange is the one event
      // that fires for add, remove AND edit.
  onChange: () => { ftSave(); OchaBrandPreview.refreshAll(); },
});

$("#t-subs-on").addEventListener("change", () => { $("#t-subs-opts").hidden = !$("#t-subs-on").checked; });

/* ---- "show it on MY video": the five element previews (browser/brandpreview.js).
   The SAME five the Edit tab mounts, against the same engine endpoint, which
   composites with the REAL overlay graph — a preview can't disagree with the
   export. This tab brands a finished clip, so the canvas stays the source's own
   size (canvas: null) rather than a chosen social format. */
const tBpCommon = {
  getVideo: () => state.enginePath, getTime: () => 1, engine: ENGINE,
  canvas: () => null,
  base: () => ({ look: tLook.collect(), rtl: $("#t-rtl").checked || undefined }),
};

// No sourceTime here: this tab brands a FINISHED clip, so an element's start time
// is already a time on the video itself.
tBp.lt = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-lt"),
  collectMany: () => (ftLt.collect() || []).filter((l) => l.name).map((l) => ({
    spec: { lower_thirds: [l] }, at: +l.start || 0,
    label: `${l.name} · ${OchaBrandPreview.clock(l.start)}`,
  })),
  watch: () => [...document.querySelectorAll("#lt-rows input, #lt-rows select")],
});

tBp.subs = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-subs"), example: tSubExample,
  base: () => ({ ...tBpCommon.base(), subtitle: { box: tSubsStyle !== "gradient" } }),
  // a realistic line: the box, the wrap and the position are the point
  collect: () => ($("#t-subs-on").checked
    ? { cues: [[0, (tCaps.collect(state.enginePath) || [])[0]?.[1]
                   || "This is how a subtitle will look on your video."]] }
    : null),
  watch: () => [$("#t-subs-on")],
});

tBp.bug = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-bug"),
  collect: () => ($("#t-bug-on").checked ? { bug: { on: true } } : null),
  watch: () => [$("#t-bug-on")],
});

tBp.pin = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-pin"),
  collectMany: () => (tLoc.collect() || []).filter((p) => p.place).map((p) => ({
    spec: { pins: [p] }, at: +p.start || 0,
    label: `${p.place} · ${OchaBrandPreview.clock(p.start)}`,
  })),
  watch: () => [...document.querySelectorAll("#t-loc-rows input, #t-loc-rows select")],
});

tBp.texton = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-texton"),
  collectMany: () => (tTexts.collect() || []).filter((t) => (t.lines || []).length).map((t) => ({
    spec: { texts: [t] }, at: +t.start || 0,
    label: `${t.lines[0]} · ${OchaBrandPreview.clock(t.start)}`,
  })),
  watch: () => [...document.querySelectorAll("#t-tx-rows input, #t-tx-rows textarea, #t-tx-rows select")],
});

/* Ending logo — the one preview with a control attached. The slider writes
   `logo_y_frac`; 0.5 (centred) is the standard, and moving it is for the case
   where the logo lands on a face. Same control the Edit tab has. */
const tEndStyle = () => (document.querySelector('input[name="ending"]:checked') || {}).value;
const tLogoY = () => (parseInt(($("#t-logoy") || {}).value, 10) || 50) / 100;
function tLogoYLabel() {
  const v = Math.round(tLogoY() * 100);
  $("#t-logoy-val").textContent = v === 50 ? "Centred (standard)" : `${v}% down the frame`;
}
function tLogoYVis() { $("#t-logoy-row").hidden = tEndStyle() !== "over_footage"; }
tBp.ending = OchaBrandPreview.mount({
  ...tBpCommon, figure: $("#t-bp-ending"),
  atEnd: true, getDuration: () => (state.probe && state.probe.duration) || 0,
  // Only meaningful where the logo sits over the picture; over black is a card
  // the body graph never draws — see engine/brand_preview.py.
  collect: () => (tEndStyle() === "over_footage"
    ? { ending: { style: "over_footage", logo_y_frac: tLogoY() } } : null),
  watch: () => [...document.querySelectorAll('input[name="ending"]'), $("#t-logoy")],
});
$("#t-logoy").addEventListener("input", () => { tLogoYLabel(); ftSave(); });
document.querySelectorAll('input[name="ending"]').forEach((r) =>
  r.addEventListener("change", tLogoYVis));
tLogoYLabel(); tLogoYVis();

// ---- step help (?) toggles — kit component .cd-help__btn / .cd-help__panel ----
document.addEventListener("click", (e) => {
  const b = e.target.closest(".cd-help__btn");
  if (!b) return;
  const panel = document.getElementById(b.getAttribute("aria-controls"));
  if (!panel) return;
  const open = panel.hidden;
  panel.hidden = !open;
  b.setAttribute("aria-expanded", String(open));
});

/* ---- footer: Help & reinstall + What's new (reachable in every state) ---- */
function footModal(id, open) { const m = $("#" + id); if (m) m.hidden = !open; }
const FOOT_MODALS = ["help-modal", "news-modal", "privacy-modal"];
$("#foot-help").onclick = () => footModal("help-modal", true);
$("#foot-whatsnew").onclick = () => footModal("news-modal", true);
$("#foot-privacy").onclick = () => footModal("privacy-modal", true);
$("#help-close").onclick = () => footModal("help-modal", false);
$("#news-close").onclick = () => footModal("news-modal", false);
$("#privacy-close").onclick = () => footModal("privacy-modal", false);
FOOT_MODALS.forEach((id) =>
  $("#" + id).addEventListener("click", (e) => { if (e.target === $("#" + id)) footModal(id, false); }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") FOOT_MODALS.forEach((id) => footModal(id, false));
});

/* ---- anonymous usage pings (see analytics.js for the full payload) ----
   The checkbox is the switch; analytics.js owns where the preference is stored. */
const optOut = $("#privacy-optout");
if (optOut && window.OchaAnalytics) {
  optOut.checked = OchaAnalytics.optedOut();
  optOut.onchange = () => OchaAnalytics.setOptOut(optOut.checked);
}
try { OchaAnalytics.init(APP_VERSION); } catch (e) { /* analytics must never break the app */ }
// Help modal is OS-aware, same pattern as the gate card's setup steps
// (statement.js stSetOS): auto-detect, with a manual toggle — people help
// colleagues on the other platform, and the detection can be wrong.
function helpSetOS(win) {
  $("#help-mac").hidden = win;
  $("#help-win").hidden = !win;
  $("#help-os-mac").classList.toggle("cd-button--outline", win);
  $("#help-os-win").classList.toggle("cd-button--outline", !win);
}
$("#help-os-mac").onclick = () => helpSetOS(false);
$("#help-os-win").onclick = () => helpSetOS(true);
helpSetOS(/Windows/i.test(navigator.userAgent));

$("#help-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("#help-cmd").textContent.trim());
    $("#help-copied").textContent = "Copied — paste it into Terminal.";
  } catch (e) { $("#help-copied").textContent = "Press ⌘C to copy the selected command."; }
  setTimeout(() => { $("#help-copied").textContent = ""; }, 4000);
};

detectEngine();     // gate the app on the engine

// While the engine is down, keep listening so the page unlocks BY ITSELF the
// moment the installer/starter finishes — the install card promises this.
// Localhost-only ping every few seconds; a refused connection resolves instantly.
setInterval(() => { if (!state.engineUp) detectEngine(); }, 4000);
