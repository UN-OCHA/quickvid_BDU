/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "0.19.0";           // keep in sync with CSXS/manifest.xml

const $ = (id) => document.getElementById(id);

// theme — default dark, persisted; parity with the DataViz plugin's toggle.
// Set before first paint to avoid a flash.
const THEME_KEY = "ocha-branding-theme";
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
try { applyTheme(localStorage.getItem(THEME_KEY) || "dark"); } catch (e) { applyTheme("dark"); }

// badge FIRST — it doubles as the "panel JS loaded" indicator
$("ver").textContent = "v" + PANEL_VERSION;

// any uncaught error surfaces in the status line (self-diagnosing panel)
window.onerror = (msg, src, line) => {
  const s = $("status");
  if (s) { s.className = "status status--err"; s.textContent = `Panel error: ${msg} (${(src || "").split("/").pop()}:${line})`; }
};

// graceful outside Premiere (plain-browser preview): stub the CEP bridge
const bridge = window.__adobe_cep__ || {
  evalScript: (src, cb) => cb && cb("none"),
  getSystemPath: () => "",
};

// extension root on disk — host.jsx resolves MOGRTs relative to this.
// The raw bridge returns a URI-encoded path (CSInterface normally decodes it):
// strip any file:// scheme + percent-decode, or MOGRT paths won't resolve.
let EXT_ROOT = "";
try {
  EXT_ROOT = decodeURIComponent(String(bridge.getSystemPath("extension") || ""))
    .replace(/^file:\/\//, "");
} catch (e) { /* leave empty; host reports MOGRT-not-found with detail */ }

let curEl = "lt";
let curFmt = null;

/* ---------- host bridge ---------- */
function jsx(call) {
  return new Promise((resolve) => bridge.evalScript(call, resolve));
}
// JSON.stringify produces a valid JS string literal — safe to embed any user
// text (quotes, backslashes, unicode) into the evalScript source.
const lit = (s) => JSON.stringify(String(s));

let hostReady = false;
let hostErr = "";
async function loadHost() {
  hostErr = "";
  // Fast path: the manifest ScriptPath loads host.jsx when Premiere STARTS, so
  // after a restart the functions are already here. Check that first.
  let t = await jsx("typeof ochaGetFormat");
  if (t === "function") { hostReady = true; return true; }
  // Not present (panel reopened after a host edit without a restart) — source
  // the file directly in the JSX engine.
  try {
    if (EXT_ROOT) await jsx("$.evalFile(" + lit(EXT_ROOT + "/jsx/host.jsx") + ")");
  } catch (e) { hostErr = "evalFile: " + (e && e.message ? e.message : e); }
  t = await jsx("typeof ochaGetFormat");
  hostReady = (t === "function");
  if (!hostReady && !hostErr) hostErr = "not sourced (typeof=" + t + ") — restart Premiere";
  return hostReady;
}

/* ---------- format chip ---------- */
async function refresh() {
  const chip = $("fmt");
  if (!hostReady) { await loadHost(); }          // self-heal if the host went away
  const res = await jsx("ochaGetFormat()");
  const parts = (res || "none").split("|");
  if (parts.length < 4 || !parts[2]) {
    curFmt = null;
    $("add").disabled = true;
    if (parts.length === 4) {
      chip.textContent = `${parts[0]}×${parts[1]} — unsupported`;
    } else if (!hostReady) {
      chip.textContent = "host: " + (hostErr || "not loaded");
    } else {
      chip.textContent = "no sequence";
    }
    chip.className = "chip";
    return;
  }
  curFmt = parts[2];
  chip.textContent = `${parts[0]}×${parts[1]} · ${parts[3]}`;
  chip.className = "chip is-ok";
  $("add").disabled = false;
}

/* ---------- status ---------- */
function show(msg, kind) {
  const s = $("status");
  s.className = "status status--" + kind;
  s.innerHTML = msg;
}
function hideStatus() { $("status").className = "status is-off"; }

/* ---------- add ---------- */
const RS = "\u001E", US = "\u001F";      // record / unit separators (untypeable)

function collectValues() {
  const kv = [];
  const push = (key, val) => kv.push(key + US + val);
  if (curEl === "lt") {
    const n = $("lt-name").value.trim(), t1 = $("lt-title").value.trim(), t2 = $("lt-title2").value.trim();
    if (n)  push("Name", n);
    if (t1) push("Title", t1);
    if (t2) push("Title line 2 (optional)", t2);
    push("Centre align", $("lt-centre").checked);
  } else if (curEl === "loc") {
    const p = $("loc-place").value.trim(), d = $("loc-date").value.trim();
    if (p) push("Place", p);
    if (d) push("Date", d);
    const blue = document.querySelector("#pin-colour .seg__opt.is-active");
    push("Pin colour", (blue && blue.dataset.col === "blue") ? 1 : 0);   // 0-based: Red=0, Blue=1
    push("Show pin icon", $("loc-icon").checked);
  } else if (curEl === "ending") {
    push("Over black", $("end-black").checked);
  }
  // shared Size + Position → Motion (all four elements; skip values at default)
  const size = clampNum($("adj-size-n").value, 100);
  const px = clampNum($("adj-x-n").value, 0);
  const py = clampNum($("adj-y-n").value, 0);
  if (size !== 100) push("@scale", size);
  if (px !== 0) push("@posX", px);
  if (py !== 0) push("@posY", py);
  return kv.join(RS);
}

function clampNum(v, dflt) {
  const n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

const EL_LABEL = { lt: "Lower third", loc: "Location", bug: "OCHA logo", ending: "Ending" };

async function addElement() {
  hideStatus();
  if (!curFmt) return show("This sequence isn’t one of the OCHA formats (9:16, 4:5, 1:1, 16:9).", "warn");
  const btn = $("add");
  btn.disabled = true;
  show("Adding…", "ok");
  try {
    const call = `ochaAdd(${lit(curEl)},${lit(curFmt)},${lit(EXT_ROOT)},${lit(collectValues())})`;
    const res = await jsx(call) || "";
    if (res.indexOf("OK|") === 0) {
      const track = (res.match(/track=([^|]*)/) || [])[1] || "";
      const set = ((res.match(/set=([^|]*)/) || [])[1] || "").split(",").filter(Boolean);
      const warn = (res.match(/warn=(.*)$/) || [])[1];
      let msg = `Added <strong>${EL_LABEL[curEl]}</strong> on ${track} at the playhead.`;
      if (set.length) msg += ` Applied: ${set.join(", ")}.`;
      if (warn) msg += ` <em>${warn}</em>`;
      show(msg, warn ? "warn" : "ok");
    } else {
      show(res.replace(/^ERR\|/, "") || "No response from Premiere.", "err");
    }
  } catch (e) {
    show("Error: " + (e && e.message ? e.message : e), "err");
  } finally {
    btn.disabled = !curFmt;
  }
}

/* ---------- Size & position controls ----------
   All three are RELATIVE to the template's built-in transform: Size 100% and
   X/Y 0 leave the graphic exactly as designed (the host reads/writes position
   as an offset from the format centre, size as a % of Motion Scale). Each value
   has its own reset back to that default. */
// [slider id, number id, default, per-row reset id]
const ADJ_PAIRS = [
  ["adj-size", "adj-size-n", 100, "adj-size-r"],
  ["adj-x", "adj-x-n", 0, "adj-x-r"],
  ["adj-y", "adj-y-n", 0, "adj-y-r"],
];
function linkPair(sliderId, numId) {
  const s = $(sliderId), n = $(numId);
  s.addEventListener("input", () => { n.value = s.value; });
  n.addEventListener("input", () => {
    // number can exceed the slider range (e.g. Size 300%); clamp the slider only
    const v = parseFloat(n.value);
    if (!isNaN(v)) s.value = Math.max(+s.min, Math.min(+s.max, v));
  });
}
function resetAdjust() {
  ADJ_PAIRS.forEach(([sId, nId, dflt]) => { $(sId).value = dflt; $(nId).value = dflt; });
}
// reset a single value to its default; in selection mode this writes live too
function resetOne(sId, nId, dflt) {
  $(sId).value = dflt; $(nId).value = dflt;
  adjLiveWrite();   // no-op in placement mode; pushes to the bound clip in edit mode
}
ADJ_PAIRS.forEach(([sId, nId, dflt, rId]) => {
  linkPair(sId, nId);
  const r = $(rId);
  if (r) r.addEventListener("click", () => resetOne(sId, nId, dflt));
});

// advanced accordion — collapsed by default; caution note inside
function setAdjustOpen(open) {
  $("adj-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  $("adj-body").hidden = !open;
}
function collapseAdjust() { setAdjustOpen(false); }
$("adj-toggle").addEventListener("click", () => {
  setAdjustOpen($("adj-toggle").getAttribute("aria-expanded") !== "true");
});

/* selection-aware editing: bind the sliders to a selected OCHA clip.
   In edit mode, slider changes apply live to that clip; with nothing selected
   the sliders are placement defaults for the next Add. */
let adjEditClip = null;   // bound clip's name, or null (placement mode)
let adjDragging = false, adjTimer = null;
["adj-size", "adj-x", "adj-y", "adj-size-n", "adj-x-n", "adj-y-n"].forEach((id) => {
  const el = $(id);
  el.addEventListener("pointerdown", () => { adjDragging = true; });
  el.addEventListener("pointerup", () => { adjDragging = false; });
  el.addEventListener("input", adjLiveWrite);
});
function adjLiveWrite() {
  if (!adjEditClip) return;                     // placement mode → nothing to write
  clearTimeout(adjTimer);
  adjTimer = setTimeout(() => {
    jsx(`ochaWriteMotion(${clampNum($("adj-size-n").value, 100)},${clampNum($("adj-x-n").value, 0)},${clampNum($("adj-y-n").value, 0)})`);
  }, 100);
}
function setAdjustEditing(name) {
  const warn = document.querySelector(".adj-warn"), tag = document.querySelector(".adj-tag");
  if (name) {
    if (warn) warn.textContent = "Editing the selected clip — changes apply live.";
    if (tag) { tag.textContent = "editing"; tag.style.color = "var(--accent)"; tag.style.borderColor = "var(--accent)"; tag.style.background = "var(--accent-bg)"; }
  } else {
    if (warn) warn.innerHTML = "Relative to each template's built-in size &amp; position: <strong>100%</strong> and <strong>0, 0</strong> leave it exactly as designed. Nudge from there only if a shot needs it.";
    if (tag) { tag.textContent = "advanced"; tag.style.color = ""; tag.style.borderColor = ""; tag.style.background = ""; }
  }
}
async function syncAdjust() {
  if (!hostReady || adjDragging) return;
  if (!document.querySelector('.sec[data-sec="brand"]').classList.contains("is-open")) return;
  const res = await jsx("ochaReadMotion()") || "none";
  if (res === "none" || res.indexOf("|") < 0) {
    if (adjEditClip !== null) { adjEditClip = null; setAdjustEditing(null); }
    return;
  }
  const p = res.split("|");
  if (p[0] !== adjEditClip) {                    // newly selected clip → bind + populate
    adjEditClip = p[0];
    setAdjustEditing(p[0]);
    setAdjustOpen(true);
    $("adj-size").value = $("adj-size-n").value = Math.round(+p[1]) || 100;
    $("adj-x").value = $("adj-x-n").value = Math.round(+p[2]) || 0;
    $("adj-y").value = $("adj-y-n").value = Math.round(+p[3]) || 0;
  }
}

/* ---------- UI wiring ---------- */
function selectEl(el) {
  curEl = el;
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-active", c.dataset.el === el));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("is-open", p.dataset.pane === el));
  resetAdjust();       // each element starts at default size/pos …
  collapseAdjust();    // … with the advanced panel closed
  hideStatus();
}
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => selectEl(c.dataset.el)));

document.querySelectorAll("#pin-colour .seg__opt").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#pin-colour .seg__opt").forEach((q) => q.classList.toggle("is-active", q === b));
  });
});

$("add").addEventListener("click", addElement);

// captions: copy the bundled OCHA .prtextstyle files into Premiere's global
// Text Styles folder so they appear in the native Style dropdown
$("cap-install").addEventListener("click", async () => {
  hideStatus();
  if (!hostReady) return show("Premiere host not ready.", "warn");
  show("Installing OCHA caption styles…", "ok");
  const res = await jsx(`ochaInstallCaptionStyles(${lit(EXT_ROOT)})`) || "";
  if (res.indexOf("OK|") === 0) {
    const inst = (res.match(/installed=([^|]*)/) || [])[1] || "";
    const warn = (res.match(/warn=(.*)$/) || [])[1];
    let msg = `Installed: <strong>${inst}</strong>. Pick them under Style when creating captions.`;
    if (warn) msg += ` <em>${warn}</em>`;
    show(msg, warn ? "warn" : "ok");
  } else {
    show(res.replace(/^ERR\|/, "") || "No response from Premiere.", "err");
  }
});

// section tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    const sec = t.dataset.sec;
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x === t));
    document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("is-open", s.dataset.sec === sec));
    hideStatus();
  });
});

/* ---------- Toolbox (DataViz pattern: tile → modal with info + a CTA to run) ----------
   Each tool has an `info` call (read-only — populates the modal) and an `action`
   call (mutates the project). Count-gated tools disable the CTA when there's
   nothing to do; the info readout may carry a trailing "|<count>". */
const TOOLS = {
  reel: {
    title: "Square → Reel",
    info: "ochaReelInfo()",
    action: "ochaSquareToReel()",
    cta: () => "Create reel",
    working: "Building the reel on a clone…",
  },
  package: {
    title: "Package project",
    info: "ochaPackageInfo()",
    action: "ochaPackageProject()",
    cta: (n) => (n > 0 ? `Package ${n} file${n === 1 ? "" : "s"}` : "Nothing to package"),
    countGated: true,
    working: "Copying media + saving a relinked copy… (large projects take a while)",
  },
  clean: {
    title: "Clean unused MOGRTs",
    info: "ochaCleanInfo()",
    action: "ochaCleanMogrts()",
    cta: (n) => (n > 0 ? `Remove ${n} unused` : "Nothing to remove"),
    countGated: true,
    danger: true,
    working: "Removing unused templates…",
  },
};
let curTool = null;

function modalResult(msg, kind) {
  const r = $("modal-result");
  r.hidden = false;
  r.className = "modal-result is-" + kind;
  r.innerHTML = msg;
}
function openTool(key) {
  const cfg = TOOLS[key];
  if (!cfg) return;
  curTool = key;
  $("modal-title").textContent = cfg.title;
  $("modal-desc").textContent = "Checking the project…";
  $("modal-result").hidden = true;
  const run = $("modal-run");
  run.textContent = cfg.cta(0);
  run.disabled = true;
  run.classList.toggle("is-danger", !!cfg.danger);
  $("tool-modal").hidden = false;
  loadInfo();
}
async function loadInfo() {
  const cfg = TOOLS[curTool];
  if (!hostReady) { await loadHost(); }
  if (!hostReady) { $("modal-desc").textContent = "Premiere host not ready — restart Premiere with a project open."; return; }
  const res = await jsx(cfg.info) || "";
  const parts = res.split("|");
  const ok = parts[0] === "OK";
  const desc = parts[1] || (ok ? "" : (res.replace(/^ERR\|/, "") || "Couldn't read the project."));
  const count = parts.length > 2 ? parseInt(parts[2], 10) : null;
  $("modal-desc").textContent = desc;
  const run = $("modal-run");
  if (!ok) { run.disabled = true; run.textContent = cfg.cta(0); return; }
  run.textContent = cfg.cta(isNaN(count) ? 0 : (count == null ? 1 : count));
  run.disabled = cfg.countGated ? !(count > 0) : false;
}
async function runToolAction() {
  const cfg = TOOLS[curTool];
  const run = $("modal-run"), cancel = $("modal-cancel");
  run.disabled = true; cancel.disabled = true;
  modalResult(cfg.working, "run");
  const res = await jsx(cfg.action) || "";
  const ok = res.indexOf("OK|") === 0;
  modalResult(res.replace(/^(OK|WARN|ERR)\|/, "") || "No response from Premiere.", ok ? "ok" : "err");
  cancel.disabled = false;
  cancel.textContent = ok ? "Done" : "Close";
  if (ok) { refresh(); loadInfo(); }   // refresh format chip + re-read counts
  else { run.disabled = false; }
}
function closeModal() {
  $("tool-modal").hidden = true;
  $("modal-cancel").textContent = "Cancel";
  $("modal-cancel").disabled = false;
  curTool = null;
}
$("tool-reel").addEventListener("click", () => openTool("reel"));
$("tool-package").addEventListener("click", () => openTool("package"));
$("tool-clean").addEventListener("click", () => openTool("clean"));
$("modal-run").addEventListener("click", runToolAction);
$("modal-cancel").addEventListener("click", closeModal);
$("modal-x").addEventListener("click", closeModal);
$("modal-scrim").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("tool-modal").hidden) closeModal(); });

// theme toggle
$("theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
});

loadHost().then(refresh);
setInterval(refresh, 2500);
setInterval(syncAdjust, 900);   // bind Adjust sliders to a selected OCHA clip
