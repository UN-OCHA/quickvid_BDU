/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "0.15.0";           // keep in sync with CSXS/manifest.xml

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

/* ---------- Size & position controls ---------- */
// each pair: slider id, number id, default — kept in sync both ways
const ADJ_PAIRS = [["adj-size", "adj-size-n", 100], ["adj-x", "adj-x-n", 0], ["adj-y", "adj-y-n", 0]];
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
ADJ_PAIRS.forEach(([sId, nId]) => linkPair(sId, nId));
$("adj-reset").addEventListener("click", resetAdjust);

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
    if (warn) warn.textContent = "Each template is already sized and placed for its format — change these only if a particular shot needs it.";
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

/* ---------- Toolbox (v1: safe readiness / detection — the actions wire in next) ---------- */
async function runTool(label, call) {
  hideStatus();
  if (!hostReady) return show("Premiere host not ready.", "warn");
  show(label + "…", "ok");
  const res = await jsx(call) || "";
  const kind = res.indexOf("OK|") === 0 ? "ok" : (res.indexOf("WARN|") === 0 ? "warn" : "err");
  show(res.replace(/^(OK|WARN|ERR)\|/, "") || "No response from Premiere.", kind);
}
$("tool-reel").addEventListener("click", () => runTool("Building reel (on a clone)", "ochaSquareToReel()"));
$("tool-collect").addEventListener("click", () => runTool("Scanning media", "ochaCollectReport()"));
$("tool-clean").addEventListener("click", () => runTool("Scanning templates", "ochaCleanReport()"));

// theme toggle
$("theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
});

loadHost().then(refresh);
setInterval(refresh, 2500);
setInterval(syncAdjust, 900);   // bind Adjust sliders to a selected OCHA clip
