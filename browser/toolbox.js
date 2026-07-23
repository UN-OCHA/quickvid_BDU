// OCHA QuickVid — Toolbox tab: quick utilities, deliberately NO project folder.
// First tool: the compressor (heavy file → distribution H.264/AAC MP4, saved
// next to the original). Uses app.js globals: $, ENGINE, sleep, esc, fmtMMSS.

const TB = { src: null, probe: null, level: "balanced" };

const tbMB = (b) => (b >= 100e6 ? (b / 1e6).toFixed(0) : (b / 1e6).toFixed(1)) + " MB";

function tbStatus(text, kind, percent) {
  const el = $("#tb-status");
  if (!text) { el.innerHTML = ""; return; }
  const cls = { ok: "cd-alert--status", warn: "cd-alert--warning", error: "cd-alert--error" }[kind] || "";
  const p = typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const bar = p === null ? "" :
    `<div class="cd-progress"><div class="cd-progress__fill" style="width:${p}%"></div></div><div class="cd-progress__pct">${p}%</div>`;
  el.innerHTML = `<div class="cd-alert ${cls}"><div class="cd-alert__message"><p>${esc(text)}</p>${bar}</div></div>`;
}

// tile → reveal the tool card
$("#tb-tile-compress").onclick = () => {
  const card = $("#tb-card-compress");
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth" });
};

// pick the heavy file (native picker via the engine — same as the other tabs)
async function tbPick() {
  try {
    const r = await fetch(ENGINE + "/api/pick-file", { method: "POST" });
    if (!r.ok) return;
    const { path } = await r.json();
    if (!path) return;
    const pr = await fetch(ENGINE + "/api/statement/probe?src=" + encodeURIComponent(path));
    if (!pr.ok) return tbStatus("Couldn't read that video.", "error");
    TB.src = path;
    TB.probe = await pr.json();
    const p = TB.probe;
    const info = $("#tb-src-info");
    info.hidden = false;
    info.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> <strong>${esc(path.split(/[\\/]/).pop())}</strong>`
      + ` · ${p.width}×${p.height} · ${fmtMMSS(p.duration)}` + (p.bytes ? ` · ${tbMB(p.bytes)}` : "");
    $("#tb-drop-text").textContent = path.split(/[\\/]/).pop();
    $("#tb-drop").classList.add("has-file");
    $("#tb-run").disabled = false;
    $("#tb-done").hidden = true;
    $("#tb-preview").hidden = true;
    tbStatus("");
  } catch (e) { tbStatus("Couldn't open the file picker.", "warn"); }
}
$("#tb-drop").addEventListener("click", tbPick);
$("#tb-drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tbPick(); } });

// level cards — one active
document.querySelectorAll(".tb-level").forEach((b) => {
  b.addEventListener("click", () => {
    TB.level = b.dataset.level;
    document.querySelectorAll(".tb-level").forEach((x) => x.classList.toggle("is-active", x === b));
  });
});

$("#tb-run").onclick = async () => {
  if (!TB.src) return tbStatus("Choose a video first.", "warn");
  const btn = $("#tb-run");
  btn.disabled = true;
  $("#tb-done").hidden = true;
  $("#tb-preview").hidden = true;
  try {
    tbStatus("Compressing — this can take a while on long videos…", "busy");
    const r = await fetch(ENGINE + "/api/compress", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: TB.src, level: TB.level }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Couldn't start the compression.");
    const { job_id } = await r.json();
    let job;
    do {
      await sleep(1000);
      job = await (await fetch(ENGINE + "/api/jobs/" + job_id)).json();
      tbStatus(job.progress || "Compressing…", "busy", job.percent);
    } while (job.status !== "done" && job.status !== "error");
    if (job.status === "error") throw new Error(job.error || "Compression failed.");

    const res = job.result || {};
    tbStatus("");
    const saved = Math.round(res.saved_pct || 0);
    const headline = saved > 0
      ? `<strong>${tbMB(res.in_bytes)} → ${tbMB(res.out_bytes)}</strong> — ${saved}% smaller.`
      : `<strong>${tbMB(res.in_bytes)} → ${tbMB(res.out_bytes)}</strong> — this file was already efficiently compressed.`;
    $("#tb-done-msg").innerHTML =
      `<p><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${headline}<br>` +
      `Saved next to the original: <strong>${esc(res.path || "")}</strong> ` +
      `<button type="button" class="cd-button cd-button--outline cd-button--small" id="tb-open"><span class="cd-button__text">Open folder</span></button></p>`;
    $("#tb-done").hidden = false;
    $("#tb-open").onclick = () => {
      const dir = (res.path || "").replace(/[\\/][^\\/]+$/, "");
      fetch(ENGINE + "/api/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: dir }) }).catch(() => {});
    };
    $("#tb-player").src = ENGINE + "/api/preview/" + job_id + "?cb=" + Date.now();
    const name = (TB.src.split(/[\\/]/).pop() || "video").replace(/\.[^.]+$/, "") + "_compressed";
    $("#tb-download").href = ENGINE + "/api/export/" + job_id + "?name=" + encodeURIComponent(name);
    $("#tb-preview").hidden = false;
  } catch (e) {
    tbStatus("Error: " + (e && e.message || e), "error");
  } finally {
    btn.disabled = false;
  }
};
