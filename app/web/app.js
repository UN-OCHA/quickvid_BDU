// OCHA QuickVid — SPA. Vanilla JS: drive the API, poll jobs, wire the 3 steps.
const $ = (sel) => document.querySelector(sel);
const state = { folder: "", transcribeJob: null, renderJob: null };

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Status messages render as OCHA cd-alert components.
const ALERT_VARIANT = { busy: "", ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" };
function setStatus(el, text, kind) {
  if (!text) { el.innerHTML = ""; return; }
  const v = ALERT_VARIANT[kind] || "";
  el.innerHTML =
    `<div class="cd-alert ${v}"><div class="cd-alert__message"><p>${esc(text)}</p></div></div>`;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

// Poll a job until it finishes; onUpdate fires each tick.
function pollJob(id, onUpdate) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await api(`/api/jobs/${id}`);
        onUpdate(job);
        if (job.status === "done") return resolve(job);
        if (job.status === "error") return reject(new Error(job.error || "Job failed"));
        setTimeout(tick, 1500);
      } catch (e) { reject(e); }
    };
    tick();
  });
}

// Step 1 — native folder picker (falls back silently to manual entry).
$("#browse").onclick = async () => {
  try {
    const { path } = await api("/api/pick-folder", { method: "POST" });
    $("#folder").value = path;
  } catch (_) { /* user can type the path */ }
};

// Step 1 — transcribe.
$("#transcribe").onclick = async () => {
  const folder = $("#folder").value.trim();
  if (!folder) return setStatus($("#t-status"), "Choose or paste a folder path first.", "warn");
  state.folder = folder;
  $("#transcribe").disabled = true;
  setStatus($("#t-status"), "Starting…", "busy");
  try {
    const { job_id } = await api("/api/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    state.transcribeJob = job_id;
    await pollJob(job_id, (j) => setStatus($("#t-status"), j.progress || j.status, "busy"));
    const { transcript } = await api(`/api/jobs/${job_id}/transcript`);
    $("#transcript").value = transcript;
    $("#step-instruct").hidden = false;
    setStatus($("#t-status"), "Transcript ready — copy it into your LLM, or write a keep-list below.", "ok");
  } catch (e) {
    setStatus($("#t-status"), "Error: " + e.message, "error");
  } finally {
    $("#transcribe").disabled = false;
  }
};

$("#copy-transcript").onclick = async () => {
  await navigator.clipboard.writeText($("#transcript").value);
  setStatus($("#t-status"), "Copied — paste into Claude/Copilot to get an instruction.", "ok");
};

// Step 2 — run the cut.
$("#run").onclick = async () => {
  if (!state.transcribeJob) return;
  const instruction = $("#instruction").value.trim();
  if (!instruction) return setStatus($("#r-status"), 'Paste the instruction JSON (at least {"keep":[…]}).', "warn");
  $("#run").disabled = true;
  setStatus($("#r-status"), "Starting render…", "busy");
  try {
    const { job_id } = await api("/api/render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_job_id: state.transcribeJob, instruction }),
    });
    state.renderJob = job_id;
    await pollJob(job_id, (j) => setStatus($("#r-status"), j.progress || j.status, "busy"));
    $("#player").src = `/api/preview/${job_id}`;
    $("#download").href = `/api/export/${job_id}`;
    $("#step-preview").hidden = false;
    setStatus($("#r-status"), "Done — preview below.", "ok");
    $("#step-preview").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    setStatus($("#r-status"), "Error: " + e.message, "error");
  } finally {
    $("#run").disabled = false;
  }
};

// ==================== MODE SWITCHING ====================
function switchMode(mode) {
  const edit = mode === "edit";
  $("#mode-edit").hidden = !edit;
  $("#mode-finish").hidden = edit;
  $("#tab-edit").classList.toggle("is-active", edit);
  $("#tab-finish").classList.toggle("is-active", !edit);
  $("#tab-edit").setAttribute("aria-selected", String(edit));
  $("#tab-finish").setAttribute("aria-selected", String(!edit));
}
$("#tab-edit").onclick = () => switchMode("edit");
$("#tab-finish").onclick = () => switchMode("finish");

// ==================== TITLES & BRANDING MODE ====================
// Accept "53", "0:53" or "1:23:04" → seconds.
const parseTime = (s) => {
  s = String(s).trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const p = s.split(":").map(Number);
    return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
  }
  return parseFloat(s) || 0;
};

// Seconds → mm:ss, for the start-time selector.
const fmtMMSS = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
};

function addLtRow() {
  const row = document.createElement("div");
  row.className = "lt-row";
  row.innerHTML =
    `<input class="cd-form__input lt-name" placeholder="e.g. Vanessa May" autocomplete="off">
     <input class="cd-form__input lt-org" placeholder="e.g. OCHA Venezuela" autocomplete="off">
     <span class="lt-start timefield">
       <input class="cd-form__input timefield__input" type="text" inputmode="numeric" value="00:10" maxlength="5" aria-label="Start time (mm:ss)" title="When it appears (mm:ss)">
       <span class="timefield__spin">
         <button type="button" class="timefield__up" tabindex="-1" aria-label="One second later">&#9650;</button>
         <button type="button" class="timefield__down" tabindex="-1" aria-label="One second earlier">&#9660;</button>
       </span>
     </span>
     <span class="lt-dur timefield">
       <input class="cd-form__input durfield__input" type="text" inputmode="numeric" value="4" maxlength="3" aria-label="Duration in seconds" title="How many seconds it stays on screen">
       <span class="durfield__unit" aria-hidden="true">sec</span>
       <span class="timefield__spin">
         <button type="button" class="durfield__up" tabindex="-1" aria-label="One second longer">&#9650;</button>
         <button type="button" class="durfield__down" tabindex="-1" aria-label="One second shorter">&#9660;</button>
       </span>
     </span>
     <select class="cd-form__input lt-align" title="Alignment"><option value="left">Left</option><option value="center">Centre</option></select>
     <button class="cd-button cd-button--outline cd-button--small lt-remove" type="button" aria-label="Remove"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
  // Start-time selector: normalise to mm:ss on blur, ▲▼ nudge by one second.
  const tf = row.querySelector(".timefield__input");
  const setTf = (sec) => { tf.value = fmtMMSS(sec); };
  tf.addEventListener("blur", () => setTf(parseTime(tf.value)));
  row.querySelector(".timefield__up").onclick = () => setTf(parseTime(tf.value) + 1);
  row.querySelector(".timefield__down").onclick = () => setTf(parseTime(tf.value) - 1);
  // Duration selector: whole seconds, ▲▼ nudge, min 1s.
  const df = row.querySelector(".durfield__input");
  const setDf = (n) => { df.value = String(Math.max(1, Math.round(n || 1))); };
  df.addEventListener("blur", () => setDf(parseFloat(df.value)));
  row.querySelector(".durfield__up").onclick = () => setDf((parseFloat(df.value) || 1) + 1);
  row.querySelector(".durfield__down").onclick = () => setDf((parseFloat(df.value) || 1) - 1);
  row.querySelector(".lt-remove").onclick = () => row.remove();
  $("#lt-rows").appendChild(row);
}
$("#lt-add").onclick = addLtRow;
addLtRow();                                   // start with one empty row

$("#f-browse").onclick = async () => {
  try {
    const { path } = await api("/api/pick-file", { method: "POST" });
    $("#f-video").value = path;
  } catch (_) { /* user can type the path */ }
};

$("#f-run").onclick = async () => {
  const video = $("#f-video").value.trim();
  if (!video) return setStatus($("#f-status"), "Choose or paste your video first.", "warn");
  const lower_thirds = [...document.querySelectorAll(".lt-row")].map((r) => ({
    name: r.querySelector(".lt-name").value.trim(),
    org: r.querySelector(".lt-org").value.trim(),
    start: parseTime(r.querySelector(".timefield__input").value),
    duration: parseFloat(r.querySelector(".durfield__input").value) || 4,
    align: r.querySelector(".lt-align").value,
  })).filter((lt) => lt.name);
  const ending = { style: document.querySelector('input[name="f-ending"]:checked').value };
  if (!lower_thirds.length && ending.style === "none")
    return setStatus($("#f-status"), "Add at least one lower third, or pick an ending.", "warn");
  $("#f-run").disabled = true;
  setStatus($("#f-status"), "Working… HDR clips take a little longer.", "busy");
  try {
    const { job_id } = await api("/api/finish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video, lower_thirds, ending }),
    });
    await pollJob(job_id, (j) => setStatus($("#f-status"), j.progress || j.status, "busy"));
    $("#f-player").src = `/api/preview/${job_id}`;
    $("#f-download").href = `/api/export/${job_id}`;
    $("#f-preview").hidden = false;
    setStatus($("#f-status"), "Done — preview below.", "ok");
    $("#f-preview").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    setStatus($("#f-status"), "Error: " + e.message, "error");
  } finally {
    $("#f-run").disabled = false;
  }
};
