// OCHA QuickVid (browser) — drives the in-browser engine. No server, no upload.
// One canonical host: localhost and 127.0.0.1 are DIFFERENT origins to the browser,
// so autosave (localStorage) done on one is invisible on the other. Normalize early.
if (location.hostname === "localhost") location.replace(location.href.replace("//localhost", "//127.0.0.1"));
const $ = (s) => document.querySelector(s);
const ENGINE = 'http://127.0.0.1:17870';                 // local companion engine → full mode
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { file: null, url: null, mode: 'browser', engine: null, enginePath: null };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const ALERT = { busy: "", ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" };
function setStatus(text, kind) {
  const el = $("#status");
  if (!text) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="cd-alert ${ALERT[kind] || ""}"><div class="cd-alert__message"><p>${esc(text)}</p></div></div>`;
}

// ---- engine detection: FULL mode when the local companion answers, else BROWSER mode ----
async function detectEngine() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 900);
    const r = await fetch(ENGINE + "/api/health", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const h = await r.json();
    if (h && h.app === "ocha-quickvid-engine") { state.mode = "full"; state.engine = h; return setChip(); }
  } catch (e) { /* no engine → browser mode */ }
  state.mode = "browser"; state.engine = null; setChip();
}

function setChip() {
  const el = $("#mode-chip");
  const full = state.mode === "full";
  el.className = "mode-chip " + (full ? "mode-chip--full" : "mode-chip--browser");
  el.innerHTML = full
    ? '<i class="fa-solid fa-bolt" aria-hidden="true"></i> Engine connected — full quality, no limits'
    : '<i class="fa-solid fa-globe" aria-hidden="true"></i> Browser mode';
  document.body.classList.toggle("is-full", full);
  if (typeof stModeChanged === "function") stModeChanged(full);   // Edit tab unlocks with the engine
  if (!state.file && !state.enginePath)
    $("#drop-text").textContent = full
      ? "Choose a video — any size, any codec, kept full-resolution."
      : "Choose a video, or drop it here — MP4 works best.";
}

// full mode: native picker on the engine → a path it reads straight off disk (no upload, no size limit)
async function enginePick() {
  try {
    const r = await fetch(ENGINE + "/api/pick-file", { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (path) { state.enginePath = path; state.file = null; $("#drop-text").textContent = path.split("/").pop(); $("#drop").classList.add("has-file"); setStatus(""); }
  } catch (e) { setStatus("Couldn't open the file picker.", "warn"); }
}

// full mode: hand the job to the engine (real ffmpeg) and stream the result back over localhost
async function renderViaEngine(lowerThirds, ending) {
  const body = { video: state.enginePath, lower_thirds: lowerThirds, ending: { style: ending.style } };
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

// ---- file input + drag/drop ----
function setFile(f) {
  if (!f) return;
  state.file = f;
  $("#drop-text").textContent = f.name + "  ·  " + (f.size / 1e6).toFixed(1) + " MB";
  $("#drop").classList.add("has-file");
  setStatus("");
}
$("#file").onchange = (e) => setFile(e.target.files[0]);
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", e => {
  if (state.mode === "full") return setStatus("In full mode, click the box to choose your video — it stays full-resolution.", "warn");
  const f = e.dataTransfer.files[0]; if (f && f.type.startsWith("video")) setFile(f);
});
drop.addEventListener("click", e => { if (state.mode === "full") { e.preventDefault(); enginePick(); } });

// ---- run ----
$("#run").onclick = async () => {
  const haveVideo = state.mode === "full" ? state.enginePath : state.file;
  if (!haveVideo) return setStatus("Choose a video first.", "warn");
  const lowerThirds = [...document.querySelectorAll(".lt-row")].map((r) => ({
    name: r.querySelector(".lt-name").value.trim(),
    org: r.querySelector(".lt-org").value.trim(),
    start: parseTime(r.querySelector(".timefield__input").value),
    duration: parseFloat(r.querySelector(".durfield__input").value) || 4,
    align: r.querySelector(".lt-align").value,
  })).filter((lt) => lt.name);
  const ending = { style: document.querySelector('input[name="ending"]:checked').value };
  if (!lowerThirds.length && ending.style === "none")
    return setStatus("Add at least one lower third, or pick an ending.", "warn");

  $("#run").disabled = true;
  const t0 = performance.now();
  try {
    let blob, meta = null;
    if (state.mode === "full") {
      setStatus("Rendering with the OCHA engine…", "busy");
      blob = await renderViaEngine(lowerThirds, ending);           // real ffmpeg, no limits
    } else {
      meta = await QVEngine.render(state.file, { lowerThirds, ending }, (m) => setStatus(m, "busy")); // in-tab WebCodecs
      blob = meta.blob;
    }
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(blob);
    $("#player").src = state.url;
    const dl = $("#download");
    dl.href = state.url;
    const srcName = state.mode === "full" ? state.enginePath.split("/").pop() : state.file.name;
    dl.download = srcName.replace(/\.[^.]+$/, "") + "_OCHA.mp4";
    $("#preview").hidden = false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const done = state.mode === "full"
      ? `Done — full quality (OCHA engine) · ${(blob.size / 1e6).toFixed(1)} MB · ${secs}s.`
      : `Done — ${meta.W}×${meta.H} ${meta.orient}${meta.hasAudio ? " · with audio" : " · no audio"} · ${(blob.size / 1e6).toFixed(1)} MB · ${secs}s.`;
    setStatus(done + " Preview below.", "ok");
    $("#preview").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e && e.message || e), "error");
  } finally {
    $("#run").disabled = false;
  }
};

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

detectEngine();     // decide full vs browser mode on load

// Browser mode: keep listening for the engine so the Edit tab unlocks BY ITSELF
// the moment "Start QuickVid" finishes its first-run setup — the install steps
// promise this ("come back to this page"), so no manual reload is needed.
// Localhost-only ping every few seconds; a refused connection resolves instantly.
setInterval(() => { if (state.mode !== "full") detectEngine(); }, 4000);
