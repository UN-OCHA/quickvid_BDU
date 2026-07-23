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
let ENGINE_LATEST = "2026.0.14";
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
  // chip
  const el = $("#mode-chip");
  el.className = "mode-chip " + (up ? "mode-chip--full" : "mode-chip--browser");
  el.innerHTML = up
    ? `<i class="fa-solid fa-bolt" aria-hidden="true"></i> Engine connected · v${esc(ver || "")}`
    : outdated
      ? `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Engine v${esc(ver)} — update needed`
      : '<i class="fa-solid fa-plug" aria-hidden="true"></i> Engine not running — set up below';
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

// native picker on the engine → a path it reads straight off disk (no upload, no size limit)
async function enginePick() {
  try {
    const r = await fetch(ENGINE + "/api/pick-file", { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (path) {
      const changed = state.enginePath && state.enginePath !== path;
      state.enginePath = path; $("#drop-text").textContent = path.split(/[\\/]/).pop(); $("#drop").classList.add("has-file"); setStatus("");
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
      `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Job folder: <strong>${esc(state.jobDir)}</strong> — the finished video lands in its <code>export/</code> folder, and your settings autosave here.`;
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
async function renderViaEngine(lowerThirds, ending, subtitles, bug, pins, cues, look, texts) {
  const body = { video: state.enginePath, lower_thirds: lowerThirds, ending: { style: ending.style },
                 subtitles: subtitles || { on: false, style: "box" }, bug: bug || { on: false },
                 pins: pins || [], cues: cues || undefined, look: look || undefined,
                 texts: (texts && texts.length) ? texts : undefined, dir: state.jobDir };
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
  rows: $("#lt-rows"), add: $("#lt-add"), onChange: () => ftSave(),
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

function ftSnapshot() {
  const f = ftCollect();
  return {
    v: 1, mode: "titles", name: ($("#f-proj-name").value || "").trim(),
    video: state.enginePath || null,
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
    ftLt.restore(p.lower_thirds);
    const end = document.querySelector(`input[name="ending"][value="${(p.ending || {}).style || "none"}"]`);
    if (end) end.checked = true;
    if (p.subtitles) { $("#t-subs-on").checked = !!p.subtitles.on; tSetSubStyle(p.subtitles.style || "box"); }
    if (p.bug) $("#t-bug-on").checked = !!p.bug.on;
    tLook.restore(p.look);
    tTexts.restore(p.texts);
    tLoc.restore(p.pins || p.pin);        // `pin` = a project saved before Jul 2026
    document.querySelectorAll("#panel-titles input, #panel-titles select")
      .forEach((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
  } finally { ftRestoring = false; }
}

// any edit in the Titles panel schedules a save (no-op until a folder is picked)
["input", "change"].forEach((ev) =>
  document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest("#panel-titles")) ftSave(); }));

// One reader for the whole Titles form — used by both "Add titles & branding" and
// the autosave, so the saved project can never drift from what gets rendered.
function ftCollect() {
  return {
    lowerThirds: ftLt.collect(),
    ending: { style: document.querySelector('input[name="ending"]:checked').value },
    subtitles: { on: $("#t-subs-on").checked, style: tSubsStyle },
    bug: { on: $("#t-bug-on").checked },
    pins: tLoc.collect(),
    look: tLook.collect(),
    texts: tTexts.collect(),
  };
}

$("#run").onclick = async () => {
  if (!state.enginePath) return setStatus("Choose a video first.", "warn");
  if (OchaFolder.block($("#f-folder"), state.jobDir, (m) => setStatus(m, "error"))) return;
  const { lowerThirds, ending, subtitles, bug, pins, look, texts } = ftCollect();
  if (!lowerThirds.length && ending.style === "none" && !subtitles.on && !bug.on && !pins.length && !texts.length)
    return setStatus("Add at least one lower third, subtitles, text on screen, the bug, a location strip, or pick an ending.", "warn");

  // Reviewed captions ride along only while they still match the chosen video —
  // otherwise the engine transcribes fresh (never burn one clip's text on another).
  const cues = subtitles.on ? tCaps.collect(state.enginePath) : null;
  const staleNote = subtitles.on && tCaps.stale(state.enginePath)
    ? " (video changed since the caption review — using fresh automatic captions)" : "";

  $("#run").disabled = true;
  const t0 = performance.now();
  try {
    setStatus("Rendering with the OCHA engine…" + staleNote, "busy");
    const blob = await renderViaEngine(lowerThirds, ending, subtitles, bug, pins, cues, look, texts);  // real ffmpeg, no limits
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(blob);
    $("#player").src = state.url;
    const dl = $("#download");
    dl.href = state.url;
    dl.download = state.enginePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") + "_OCHA.mp4";
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
  const img = $("#t-subs-preview");                    // box = 9:16 reel, event = 16:9 — set intrinsic size to avoid stretch/shift
  img.width = 360; img.height = style === "box" ? 640 : 203;
  img.src = style === "box" ? "img/ex-sub-box.jpg" : "img/ex-sub-event.jpg";
  $("#t-subs-cap").textContent = style === "box"
    ? "Social — white text on a grey box (feeds & reels)."
    : "Event — clean white text over a soft gradient (16:9 screens).";
}
$("#t-substyle-box").onclick = () => tSetSubStyle("box");
$("#t-substyle-event").onclick = () => tSetSubStyle("gradient");

/* ---- caption editor: the SHARED component (browser/captions.js) ----
   The Edit tab mounts the same one. Generate = transcribe once (a job), review
   the text, then Render sends the edited cues and skips re-transcribing. */
const tCaps = OchaCaptions.mount({ list: $("#t-caps-list"), status: $("#t-caps-status") });

/* ---- footage Look: the SHARED component (browser/look.js) — Edit tab mounts
   the same one. Preview stills use the engine's own conversion + chain. */
const tLook = OchaLook.mount({
  grid: $("#t-look-grid"), fix: $("#t-look-fix"), previewBtn: $("#t-look-prev"),
  getVideo: () => state.enginePath, getTime: () => 1, engine: ENGINE,
  onChange: () => ftSave(),
});
// Text on screen — the SHARED component (browser/texton.js); Edit tab mounts the same one.
const tTexts = OchaTextOn.mount({
  on: "t-tx-on", fields: "t-tx-fields", l1: "t-tx-l1", l2: "t-tx-l2", l3: "t-tx-l3",
  start: "t-tx-start", dur: "t-tx-dur", onChange: () => ftSave(),
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
    tCaps.setCues((job.result || {}).cues || [], state.enginePath);
    setStatus("Captions ready — review below, then render.", "ok");
  } catch (e) { setStatus("Error: " + (e && e.message || e), "error"); }
  finally { btn.disabled = false; }
};
/* ---- location strips: the SHARED component (browser/location.js) ----
   The Edit tab mounts the same one. Change the strip's fields, defaults or
   behaviour in location.js and BOTH tabs move together. */
const tLoc = OchaLocation.mount({
  rows: $("#t-loc-rows"), add: $("#t-loc-add"), onChange: () => ftSave(),
});

$("#t-subs-on").addEventListener("change", () => { $("#t-subs-opts").hidden = !$("#t-subs-on").checked; });

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

detectEngine();     // gate the app on the engine

// While the engine is down, keep listening so the page unlocks BY ITSELF the
// moment the installer/starter finishes — the install card promises this.
// Localhost-only ping every few seconds; a refused connection resolves instantly.
setInterval(() => { if (!state.engineUp) detectEngine(); }, 4000);
