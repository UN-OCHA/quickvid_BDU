/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "0.28.2";           // keep in sync with CSXS/manifest.xml

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
  } else if (curEl === "text") {
    // one control per line — matches the template's "Line 1/2/3" EGP fields.
    // Empty lines are skipped: the template's expressions close the gap.
    ["text-l1", "text-l2", "text-l3"].forEach((id, i) => {
      const v = $(id).value.trim();
      if (v) push("Line " + (i + 1), v);
    });
    // the readability gradient is its OWN template with its own button + modal —
    // deliberately NOT part of this CTA, which adds the text only
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

const EL_LABEL = { lt: "Lower third", loc: "Location", bug: "OCHA logo", ending: "Ending", text: "Text" };

/* The readability scrim is a template of its own (OCHA Gradient), added by its own
   button + modal rather than riding along with the Text CTA — Text, Captions and the
   Toolbox all reach the same one. `pos` is bottom | top | full. */
function addGradient(pos, opacity) {
  try { Analytics.ping("gradient:" + pos); } catch (e) {}
  // NOTE THE INVERSION. The AE template's checkbox is NAMED "Top" but produces a
  // gradient at the BOTTOM when ticked — Linear Wipe clears the side its angle
  // points away from, and the built templates went out that way round. Rather than
  // mislabel the buttons (a user picking "Top" must get a scrim at the top), the
  // panel keeps honest labels and flips the value HERE, in one place. If the AE
  // templates are ever rebuilt with the expression corrected, drop the inversion.
  const kv = ["Top" + US + (pos === "bottom" ? "true" : "false"),
              "Full screen" + US + (pos === "full" ? "true" : "false"),
              "Opacity" + US + (opacity == null ? 80 : opacity)].join(RS);
  return jsx(`ochaAdd("gradient",${lit(curFmt)},${lit(EXT_ROOT)},${lit(kv)})`).then((r) => r || "");
}
function gradPos() {
  const g = document.querySelector("#grad-pos .seg__opt.is-active");
  return (g && g.dataset.pos) || "bottom";
}
function gradOpacity() { return clampNum($("grad-op-n").value, 80); }

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
      try { Analytics.ping("add:" + curEl + ":" + (curFmt || "?")); } catch (e) {}
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
linkPair("grad-op", "grad-op-n");     // gradient fade slider <-> number
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

// segmented controls (pin colour, text-gradient) — one active option each
["#pin-colour", "#grad-pos"].forEach((sel) => {
  document.querySelectorAll(sel + " .seg__opt").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(sel + " .seg__opt").forEach((q) => q.classList.toggle("is-active", q === b));
    });
  });
});

$("add").addEventListener("click", addElement);

// captions: copy the bundled OCHA .prtextstyle files into Premiere's global
// Text Styles folder so they appear in the native Style dropdown
// Captions: both actions are toolbox-style tiles that open an explaining modal.
$("cap-install").addEventListener("click", () => openTool("capstyles"));
$("cap-gradient").addEventListener("click", () => openTool("gradientBottom"));

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
   Each tool has: `explain` (static "what this does", always shown), an `info`
   call (read-only — the live status line, may carry a trailing "|<count>"), and
   an `action` call (mutates the project). Count-gated tools disable the CTA when
   there's nothing to do. */
const TOOLS = {
  reel: {
    title: "Square → Reel",
    explain: "Turns a <strong>square (1:1)</strong> sequence into a vertical <strong>9:16 reel</strong> for Stories, TikTok and Shorts. Your clip stays centred and sharp; a scaled, blurred copy of it fills the empty space above and below so there are no black bars. It builds on a <strong>duplicate</strong> sequence — your square original is never changed.",
    info: "ochaReelInfo()",
    action: "ochaSquareToReel()",
    cta: () => "Create reel",
    working: "Building the reel on a clone…",
  },
  package: {
    title: "Package project",
    explain: "Collects <strong>every file this project uses</strong> — footage, images, graphics, audio — from wherever they're scattered on the drive into one tidy folder next to your project, sorted into subfolders by type. It then saves a <strong>portable, relinked copy</strong> of the project inside that folder. Ideal before archiving or handing the project to someone else. Your original project and files are left untouched.",
    info: "ochaPackageInfo()",
    action: "ochaPackageProject()",
    cta: (n) => (n > 0 ? `Package ${n} file${n === 1 ? "" : "s"}` : "Nothing to package"),
    countGated: true,
    working: "Copying media + saving a relinked copy… (large projects take a while)",
  },
  gradient: {
    title: "Readability gradient",
    explain: "Drops a soft <strong>black gradient</strong> on its own track so white text stays legible over busy footage. It goes in as a <strong>separate clip</strong> — put it on a track <strong>below</strong> your text, and trim it to cover just the part you need.",
    settings: "all",                                  // position + fade
    needsFmt: true,
    ready: "Ready — the gradient goes in at the playhead, on its own track.",
    done: (r) => `Gradient added on <strong>${trackOf(r)}</strong>. Move it <strong>below</strong> your text and trim it to length.`,
    cta: () => "Add gradient",
    working: "Adding the gradient…",
    action: () => addGradient(gradPos(), gradOpacity()),
  },
  gradientBottom: {
    title: "Caption gradient",
    explain: "Adds the <strong>bottom</strong> gradient that the <strong>OCHA Clean</strong> (event) caption style is built to sit on — Clean has no box, so it needs the scrim for contrast. Drop it on a track <strong>below</strong> your caption track and trim it to match.",
    settings: "fade",                                 // bottom is fixed here
    needsFmt: true,
    ready: "Ready — the gradient goes in at the playhead, on its own track.",
    done: (r) => `Gradient added on <strong>${trackOf(r)}</strong>. Move it <strong>below</strong> your caption track and trim it to length.`,
    cta: () => "Add gradient",
    working: "Adding the gradient…",
    action: () => addGradient("bottom", gradOpacity()),
  },
  capstyles: {
    title: "OCHA captions — how it works",
    explain:
      "Premiere makes the captions; these two styles make them on-brand.<br><br>" +
      "<strong>1.</strong> Install once with the button below — it copies <strong>OCHA Boxed</strong> and " +
      "<strong>OCHA Clean</strong> into Premiere's own Text Styles.<br>" +
      "<strong>2.</strong> <strong>Window &gt; Text &gt; Captions</strong> → <strong>Create captions from transcript</strong>.<br>" +
      "<strong>3.</strong> In that dialog (or later via <strong>Track Style</strong>), pick <strong>OCHA Boxed</strong> " +
      "for social feeds, or <strong>OCHA Clean</strong> for events.<br>" +
      "<strong>4.</strong> Clean has <em>no box</em>, so it needs contrast: add the <strong>Caption gradient</strong> " +
      "and place that clip on a track <strong>below</strong> your captions.<br><br>" +
      "You only install once — the styles stay in Premiere for every future project.",
    ready: "Installs into Premiere itself — no project or sequence needed.",
    cta: () => "Install the styles",
    working: "Installing the OCHA caption styles…",
    done: (r) => `Installed <strong>${(r.match(/installed=([^|]*)/) || [])[1] || "the styles"}</strong>. ` +
                 `They're now in Premiere's Text Styles — pick one under <strong>Track Style</strong> when you make captions.`,
    action: () => jsx(`ochaInstallCaptionStyles(${lit(EXT_ROOT)})`).then((r) => r || ""),
  },
  clean: {
    title: "Clean unused MOGRTs",
    explain: "Removes the <strong>OCHA branding templates</strong> (lower third, location, logo, ending) that are sitting in your project but <strong>aren't used in any sequence</strong> — the leftovers from trying a few options. Templates that are actually on a timeline are always kept. This only tidies the Project panel; your sequences and media aren't touched.",
    info: "ochaCleanInfo()",
    action: "ochaCleanMogrts()",
    cta: (n) => (n > 0 ? `Remove ${n} unused` : "Nothing to remove"),
    countGated: true,
    danger: true,
    working: "Removing unused templates…",
  },
};
let curTool = null;

const trackOf = (r) => (r.match(/track=([^|]*)/) || [])[1] || "its own track";

function modalResult(msg, kind) {
  const r = $("modal-result");
  r.hidden = false;
  r.className = "modal-result is-" + kind;
  r.innerHTML = msg;
}
function modalInfo(msg, isErr) {
  const el = $("modal-info");
  el.hidden = false;
  el.className = "modal-info" + (isErr ? " is-err" : "");
  el.textContent = msg;
}
function openTool(key) {
  const cfg = TOOLS[key];
  if (!cfg) return;
  curTool = key;
  $("modal-title").textContent = cfg.title;
  $("modal-desc").innerHTML = cfg.explain;          // static explanation — always shown
  // per-tool settings: "all" = position + fade, "fade" = fade only (position fixed)
  $("modal-settings").hidden = !cfg.settings;
  $("grad-pos").hidden = cfg.settings !== "all";
  modalInfo("Checking the project…", false);        // live status line
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
  if (!hostReady) { modalInfo("Premiere host not ready — restart Premiere with a project open.", true); return; }
  // Tools with no read-only probe (gradient, caption styles): nothing to count.
  // `needsFmt` = puts a clip on a timeline, so it needs an OCHA-format sequence;
  // installing caption styles writes to Premiere itself and needs no project.
  if (!cfg.info) {
    const ok = !cfg.needsFmt || !!curFmt;
    modalInfo(ok ? cfg.ready
                 : "Open a sequence in one of the OCHA formats (9:16, 4:5, 1:1, 16:9) first.", !ok);
    $("modal-run").textContent = cfg.cta(1);
    $("modal-run").disabled = !ok;
    return;
  }
  const res = await jsx(cfg.info) || "";
  const parts = res.split("|");
  const ok = parts[0] === "OK";
  const status = parts[1] || (ok ? "" : (res.replace(/^ERR\|/, "") || "Couldn't read the project."));
  const count = parts.length > 2 ? parseInt(parts[2], 10) : null;
  modalInfo(status, !ok);
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
  // `action` is either a host call string, or a function returning one (tools whose
  // call depends on the modal's own settings, e.g. the gradient's position/fade)
  const res = (typeof cfg.action === "function" ? await cfg.action() : await jsx(cfg.action)) || "";
  const ok = res.indexOf("OK|") === 0;
  try { Analytics.ping("tool:" + curTool + (ok ? "" : ":failed")); } catch (e) {}
  // `done` turns the host's kv reply (track=V2|set=…) into a sentence; without one
  // the reply is already prose (the counting tools), so just strip the status prefix.
  const warn = (res.match(/warn=(.*)$/) || [])[1];
  let msg = ok && cfg.done ? cfg.done(res) : res.replace(/^(OK|WARN|ERR)\|/, "");
  if (ok && cfg.done && warn) msg += ` <em>${warn}</em>`;
  modalResult(msg || "No response from Premiere.", ok ? "ok" : "err");
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
$("tool-gradient").addEventListener("click", () => openTool("gradient"));
$("text-grad-btn").addEventListener("click", () => openTool("gradient"));
$("tool-package").addEventListener("click", () => openTool("package"));
$("tool-clean").addEventListener("click", () => openTool("clean"));
$("modal-run").addEventListener("click", runToolAction);
$("modal-cancel").addEventListener("click", closeModal);
$("modal-x").addEventListener("click", closeModal);
$("modal-scrim").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("tool-modal").hidden) closeModal(); });

// external links (mailto, http) — CEP won't follow a plain <a href>; open in the
// user's default browser / mail client via the CEP util (fallback to window.open)
document.querySelectorAll(".ext-link").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const url = a.dataset.url;
    if (!url) return;
    try {
      if (window.cep && window.cep.util) window.cep.util.openURLInDefaultBrowser(url);
      else window.open(url);
    } catch (err) { try { window.open(url); } catch (e2) {} }
  });
});

// theme toggle
$("theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
});

/* ---------- Update check (GitHub-hosted version.json; notify + manual download) ----------
   Mirrors the DataViz plugin's version check but channelled via GitHub (same repo
   the web app self-updates from) instead of Dropbox — no tokens, versioned, free.
   MVP = notify-only: shows a banner linking to the download/instructions. Full
   silent .zxp auto-extract (DataViz phase 2) needs a signed .zxp + --enable-nodejs. */
const UPDATE_URL = "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/premiere/cep/version.json";
const UPD_DISMISS_KEY = "qv-update-dismissed";
function cmpVer(a, b) {                         // -1 a<b, 0 equal, 1 a>b
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}
function checkForUpdate() {
  // XHR (not fetch) — CEP's CEF allows cross-origin XHR; matches DataViz.
  let xhr;
  try { xhr = new XMLHttpRequest(); } catch (e) { return; }
  xhr.open("GET", UPDATE_URL + "?t=" + Date.now(), true);
  xhr.timeout = 6000;
  xhr.onreadystatechange = () => {
    if (xhr.readyState !== 4) return;
    if (xhr.status < 200 || xhr.status >= 300) return;         // offline / blocked → silent
    let info;
    try { info = JSON.parse(xhr.responseText); } catch (e) { return; }
    if (!info || !info.version) return;
    if (cmpVer(PANEL_VERSION, info.version) >= 0) return;      // already current or newer
    try { if (localStorage.getItem(UPD_DISMISS_KEY) === info.version) return; } catch (e) {}  // dismissed this one
    showUpdateBanner(info);
  };
  try { xhr.send(); } catch (e) { /* silent */ }
}
function showUpdateBanner(info) {
  const bar = $("update-banner");
  if (!bar) return;
  $("update-version").textContent = "v" + info.version;
  const url = info.downloadUrl || "https://github.com/UN-OCHA/quickvid_BDU";
  $("update-link").onclick = () => {
    try {
      if (window.cep && window.cep.util) window.cep.util.openURLInDefaultBrowser(url);
      else window.open(url);
    } catch (e) { try { window.open(url); } catch (e2) {} }
  };
  $("update-dismiss").onclick = () => {
    try { localStorage.setItem(UPD_DISMISS_KEY, info.version); } catch (e) {}
    bar.hidden = true;
  };
  bar.hidden = false;
}

loadHost().then(refresh);
// anonymous usage pings (version / event / approximate city) — see js/analytics.js.
// Never sends typed text, project names or paths. No-op until configured.
try { Analytics.init(PANEL_VERSION); } catch (e) { /* analytics must never break the panel */ }
checkForUpdate();               // once on load; a new release surfaces on next panel open
setInterval(refresh, 2500);
setInterval(syncAdjust, 900);   // bind Adjust sliders to a selected OCHA clip
