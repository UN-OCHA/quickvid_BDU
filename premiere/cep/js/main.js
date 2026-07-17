/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "0.6.0";           // keep in sync with CSXS/manifest.xml

const $ = (id) => document.getElementById(id);

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

/* ---------- format chip ---------- */
async function refresh() {
  const chip = $("fmt");
  const res = await jsx("ochaGetFormat()");
  const parts = (res || "none").split("|");
  if (parts.length < 4 || !parts[2]) {
    curFmt = null;
    $("add").disabled = true;
    if (parts.length === 4) {
      chip.textContent = `${parts[0]}×${parts[1]} — unsupported`;
    } else if (res && res.indexOf("EvalScript") !== -1) {
      // host script didn't load/parse — say so instead of a misleading "no sequence"
      const t = await jsx("typeof ochaGetFormat");
      chip.textContent = t === "function" ? "host error" : "host script not loaded";
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
    push("Pin colour", (blue && blue.dataset.col === "blue") ? 2 : 1);
    push("Show pin icon", $("loc-icon").checked);
  } else if (curEl === "ending") {
    push("Over black", $("end-black").checked);
  }
  return kv.join(RS);
}

const EL_LABEL = { lt: "Lower third", loc: "Location", bug: "Bug", ending: "Ending" };

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

/* ---------- UI wiring ---------- */
function selectEl(el) {
  curEl = el;
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-active", c.dataset.el === el));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("is-open", p.dataset.pane === el));
  hideStatus();
}
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => selectEl(c.dataset.el)));

document.querySelectorAll("#pin-colour .seg__opt").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#pin-colour .seg__opt").forEach((q) => q.classList.toggle("is-active", q === b));
  });
});

$("add").addEventListener("click", addElement);

refresh();
setInterval(refresh, 2500);
