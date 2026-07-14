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
function setStatus(text, kind) {
  const el = $("#status");
  if (!text) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="cd-alert ${ALERT[kind] || ""}"><div class="cd-alert__message"><p>${esc(text)}</p></div></div>`;
}

// ---- engine gate: the app IS the engine's UI — without it, show the install card ----
async function detectEngine() {
  let up = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 900);
    const r = await fetch(ENGINE + "/api/health", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const h = await r.json();
    if (h && h.app === "ocha-quickvid-engine") { up = true; state.engine = h; }
  } catch (e) { /* not running */ }
  if (up !== state.engineUp || !state._gated) { state.engineUp = up; state._gated = true; gate(); }
}

function gate() {
  const up = state.engineUp;
  $("#st-need-engine").hidden = up;                     // the install card IS the app when the engine is down
  document.querySelector(".mode-tabs").hidden = !up;
  if (!up) { $("#panel-titles").hidden = true; $("#panel-edit").hidden = true; }
  else if ($("#panel-titles").hidden && $("#panel-edit").hidden) {
    (typeof stShowPanel === "function") ? stShowPanel("titles") : ($("#panel-titles").hidden = false);
  }
  const el = $("#mode-chip");
  el.className = "mode-chip " + (up ? "mode-chip--full" : "mode-chip--browser");
  el.innerHTML = up
    ? `<i class="fa-solid fa-bolt" aria-hidden="true"></i> Engine connected · v${(state.engine || {}).version || ""}`
    : '<i class="fa-solid fa-plug" aria-hidden="true"></i> Engine not running — set up below';
  if (typeof stModeChanged === "function") stModeChanged(up);     // Edit wizard shows/hides
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
async function renderViaEngine(lowerThirds, ending, subtitles) {
  const body = { video: state.enginePath, lower_thirds: lowerThirds, ending: { style: ending.style },
                 subtitles: subtitles || { on: false, style: "box" } };
  const r = await fetch(ENGINE + "/api/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { let m = "Engine error"; try { m = (await r.json()).detail || m; } catch (e) {} throw new Error(m); }
  const { job_id } = await r.json();
  let job;
  do {
    await sleep(1000);
    job = await (await fetch(ENGINE + "/api/jobs/" + job_id)).json();
    setStatus(job.progress || "Rendering with the OCHA engine…", "busy");
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
    `<input class="cd-form__input lt-name" placeholder="e.g. Vanessa May" autocomplete="off">
     <input class="cd-form__input lt-org" placeholder="e.g. OCHA Venezuela" autocomplete="off">
     <input class="cd-form__input lt-org2" placeholder="2nd line (optional)" autocomplete="off">
     <span class="lt-start timefield">
       <input class="cd-form__input timefield__input" type="text" inputmode="numeric" value="00:10" maxlength="5" aria-label="Start time (mm:ss)" title="When it appears (mm:ss)">
       <span class="timefield__spin">
         <button type="button" class="timefield__up" tabindex="-1" aria-label="Later">&#9650;</button>
         <button type="button" class="timefield__down" tabindex="-1" aria-label="Earlier">&#9660;</button>
       </span>
     </span>
     <span class="lt-dur timefield">
       <input class="cd-form__input durfield__input" type="text" inputmode="numeric" value="4" maxlength="3" aria-label="Duration in seconds" title="Seconds on screen">
       <span class="durfield__unit" aria-hidden="true">sec</span>
       <span class="timefield__spin">
         <button type="button" class="durfield__up" tabindex="-1" aria-label="Longer">&#9650;</button>
         <button type="button" class="durfield__down" tabindex="-1" aria-label="Shorter">&#9660;</button>
       </span>
     </span>
     <select class="cd-form__input lt-align" title="Alignment"><option value="left">Left</option><option value="center">Centre</option></select>
     <button class="cd-button cd-button--outline cd-button--small lt-remove" type="button" aria-label="Remove"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
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
  if (!lowerThirds.length && ending.style === "none" && !subtitles.on)
    return setStatus("Add at least one lower third, subtitles, or pick an ending.", "warn");

  $("#run").disabled = true;
  const t0 = performance.now();
  try {
    setStatus("Rendering with the OCHA engine…", "busy");
    const blob = await renderViaEngine(lowerThirds, ending, subtitles);       // real ffmpeg, no limits
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
