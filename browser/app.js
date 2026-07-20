// OCHA QuickVid — the web UI for the LOCAL engine (engine-only since v0.4:
// the in-browser "Lite" renderer is gone; every job runs through real ffmpeg).
// One canonical host: localhost and 127.0.0.1 are DIFFERENT origins to the browser,
// so autosave (localStorage) done on one is invisible on the other. Normalize early.
if (location.hostname === "localhost") location.replace(location.href.replace("//localhost", "//127.0.0.1"));
const $ = (s) => document.querySelector(s);
const ENGINE = 'http://127.0.0.1:17870';                 // the local companion engine
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { url: null, engineUp: false, engine: null, enginePath: null };
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
let ENGINE_LATEST = "0.7.0";
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
  if (!up) { $("#panel-titles").hidden = true; $("#panel-edit").hidden = true; }
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
    if (path) { state.enginePath = path; $("#drop-text").textContent = path.split(/[\\/]/).pop(); $("#drop").classList.add("has-file"); setStatus(""); }
  } catch (e) { setStatus("Couldn't open the file picker.", "warn"); }
}

// full mode: hand the job to the engine (real ffmpeg) and stream the result back over localhost
async function renderViaEngine(lowerThirds, ending, subtitles, bug, pin) {
  const body = { video: state.enginePath, lower_thirds: lowerThirds, ending: { style: ending.style },
                 subtitles: subtitles || { on: false, style: "box" }, bug: bug || { on: false },
                 pin: pin || { on: false } };
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

function addLtRow() {
  const row = document.createElement("div");
  row.className = "lt-row";
  row.innerHTML =
    `<input class="cd-form__input lt-name" placeholder="First Name Last Name" autocomplete="off">
     <input class="cd-form__input lt-org" placeholder="Job title" autocomplete="off">
     <input class="cd-form__input lt-org2" placeholder="Additional info" autocomplete="off">
     <div class="lt-meta">
       <span class="lt-cell lt-cell--start"><span class="lt-cap">Start</span>
         <span class="lt-start timefield">
           <input class="cd-form__input timefield__input" type="text" inputmode="numeric" value="00:10" maxlength="5" aria-label="Start time (mm:ss)" title="When it appears (mm:ss)">
           <span class="timefield__spin">
             <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
             <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
           </span>
         </span>
       </span>
       <span class="lt-cell lt-cell--dur"><span class="lt-cap">Duration</span>
         <span class="lt-dur timefield">
           <input class="cd-form__input durfield__input" type="text" inputmode="numeric" value="4" maxlength="3" aria-label="Duration in seconds" title="Seconds on screen">
           <span class="durfield__unit" aria-hidden="true">sec</span>
           <span class="timefield__spin">
             <button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button>
             <button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button>
           </span>
         </span>
       </span>
       <span class="lt-cell lt-cell--align"><span class="lt-cap">Alignment</span>
         <select class="cd-form__input lt-align" title="Alignment"><option value="left">Left</option><option value="center">Centre</option></select>
       </span>
       <button class="cd-button cd-button--outline cd-button--small lt-remove" type="button" title="Remove this lower third"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="cd-button__text">Remove</span></button>
     </div>`;
  const tf = row.querySelector(".timefield__input");
  const setTf = (sec) => { tf.value = fmtMMSS(sec); };
  tf.addEventListener("blur", () => setTf(parseTime(tf.value)));
  row.querySelector(".timefield__up").onclick = () => setTf(parseTime(tf.value) + 1);
  row.querySelector(".timefield__down").onclick = () => setTf(parseTime(tf.value) - 1);
  const df = row.querySelector(".durfield__input");
  const setDf = (n) => { df.value = String(Math.max(1, Math.round(n || 1))); };
  df.addEventListener("blur", () => setDf(parseFloat(df.value)));
  row.querySelector(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
  row.querySelector(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);
  row.querySelector(".lt-remove").onclick = () => row.remove();
  $("#lt-rows").appendChild(row);
}
$("#lt-add").onclick = addLtRow;
addLtRow();

// ---- the video box: click → the engine's native file picker ----
const drop = $("#drop");
drop.addEventListener("click", enginePick);
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enginePick(); } });

// ---- run ----
$("#run").onclick = async () => {
  if (!state.enginePath) return setStatus("Choose a video first.", "warn");
  const lowerThirds = [...document.querySelectorAll("#lt-rows .lt-row")].map((r) => ({
    name: r.querySelector(".lt-name").value.trim(),
    org: r.querySelector(".lt-org").value.trim(),
    org2: r.querySelector(".lt-org2").value.trim(),
    start: parseTime(r.querySelector(".timefield__input").value),
    duration: parseFloat(r.querySelector(".durfield__input").value) || 4,
    align: r.querySelector(".lt-align").value,
  })).filter((lt) => lt.name);
  const ending = { style: document.querySelector('input[name="ending"]:checked').value };
  const subtitles = { on: $("#t-subs-on").checked, style: tSubsStyle };
  const bug = { on: $("#t-bug-on").checked };
  const pin = tCollectPin();
  if (!lowerThirds.length && ending.style === "none" && !subtitles.on && !bug.on && !pin.on)
    return setStatus("Add at least one lower third, subtitles, the bug, a location strip, or pick an ending.", "warn");

  $("#run").disabled = true;
  const t0 = performance.now();
  try {
    setStatus("Rendering with the OCHA engine…", "busy");
    const blob = await renderViaEngine(lowerThirds, ending, subtitles, bug, pin);  // real ffmpeg, no limits
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
// ---- Titles location strip (pin locator): opts toggle + colour + collector ----
let tPinColor = "red";
function tSetPinColor(c) {
  tPinColor = c;
  $("#t-pin-red").classList.toggle("cd-button--outline", c !== "red");
  $("#t-pin-blue").classList.toggle("cd-button--outline", c === "red");
}
$("#t-pin-red").onclick = () => tSetPinColor("red");
$("#t-pin-blue").onclick = () => tSetPinColor("blue");
$("#t-pin-on").addEventListener("change", () => { $("#t-pin-opts").hidden = !$("#t-pin-on").checked; });
// Start (mm:ss) + Duration (sec) steppers — identical behaviour to the lower-third fields
(function () {
  const tf = $("#t-pin-start"), setTf = (s) => { tf.value = fmtMMSS(Math.max(0, s)); };
  tf.addEventListener("blur", () => setTf(parseTime(tf.value)));
  $("#t-pin-start-up").onclick = () => setTf(parseTime(tf.value) + 1);
  $("#t-pin-start-down").onclick = () => setTf(parseTime(tf.value) - 1);
  const df = $("#t-pin-dur"), setDf = (n) => { df.value = String(Math.max(2, Math.round(n || 2))); };
  df.addEventListener("blur", () => setDf(parseFloat(df.value)));
  $("#t-pin-dur-up").onclick = () => setDf((parseFloat(df.value) || 0) + 1);
  $("#t-pin-dur-down").onclick = () => setDf((parseFloat(df.value) || 0) - 1);
})();
function tCollectPin() {
  const on = $("#t-pin-on").checked;
  return {
    on, place: $("#t-pin-place").value.trim(), date: $("#t-pin-date").value.trim(),
    icon: $("#t-pin-icon").checked, color: tPinColor,
    start: parseTime($("#t-pin-start").value),
    duration: parseFloat($("#t-pin-dur").value) || 5,
  };
}

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
