/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "0.40.7";           // keep in sync with CSXS/manifest.xml

const $ = (id) => document.getElementById(id);
// Version strings land in the banner via innerHTML — escape them. Everything here
// comes from our own version.json, but that is fetched over the network.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// theme — default dark, persisted; parity with the DataViz plugin's toggle.
// Set before first paint to avoid a flash.
const THEME_KEY = "ocha-branding-theme";
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
try { applyTheme(localStorage.getItem(THEME_KEY) || "dark"); } catch (e) { applyTheme("dark"); }

// (the old top-left version badge is gone — the running version now lives in the
// menu's About section, set below via #menu-version.)

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

// extension root on disk — host.jsx resolves MOGRTs relative to this, and the
// caption installer + auto-updater use it too. The raw bridge returns a URI-encoded
// file:// path; CSInterface would decode it, but we call the raw bridge, so we must
// replicate its platform-specific decode by hand:
//   Mac:     file:///Users/…   -> /Users/…        (strip "file://", leading / is correct)
//   Windows: file:///C:/Users/… -> C:/Users/…      (also drop the / BEFORE the drive)
// The second replace is the Windows fix: without it EXT_ROOT stayed "/C:/Users/…",
// an invalid path, so every File(...).exists was false and "Add" reported
// "MOGRT not found" on Windows while working on Mac.
let EXT_ROOT = "";
try {
  EXT_ROOT = decodeURIComponent(String(bridge.getSystemPath("extension") || ""))
    .replace(/^file:\/\//, "")
    .replace(/^\/([A-Za-z]:)/, "$1");
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
let statusTimer = null;
function show(msg, kind) {
  const s = $("status");
  s.className = "status status--" + kind;
  s.innerHTML = msg;
  clearTimeout(statusTimer);
  // success messages clear themselves after a few seconds; warnings/errors stay put
  // so they can be read and acted on.
  if (kind === "ok") statusTimer = setTimeout(hideStatus, 7000);
}
function hideStatus() { clearTimeout(statusTimer); $("status").className = "status is-off"; }

/* ---------- add ---------- */
const RS = "\u001E", US = "\u001F";      // record / unit separators (untypeable)

function collectValues() {
  const kv = [];
  const push = (key, val) => kv.push(key + US + val);
  // EMPTY FIELDS ARE SENT AS EMPTY, never skipped. Skipping them left the template's
  // baked-in placeholder on screen ("Job title, Duty station") when you filled only
  // one line — and, once the panel could edit a selected clip, made it impossible to
  // CLEAR a line: the field was never written, so the 900ms mirror read the old value
  // straight back into the box. Delete, refill, delete, refill. Both templates hide
  // and reflow around an empty line, so "" is the correct instruction, not silence.
  if (curEl === "lt") {
    push("Name", $("lt-name").value.trim());
    push("Title", $("lt-title").value.trim());
    push("Title line 2 (optional)", $("lt-title2").value.trim());
    push("Centre align", $("lt-centre").checked);
  } else if (curEl === "loc") {
    push("Place", $("loc-place").value.trim());
    push("Date", $("loc-date").value.trim());
    const blue = document.querySelector("#pin-colour .seg__opt.is-active");
    push("Pin colour", (blue && blue.dataset.col === "blue") ? 1 : 0);   // 0-based: Red=0, Blue=1
    push("Show pin icon", $("loc-icon").checked);
  } else if (curEl === "ending") {
    push("Over black", $("end-black").checked);
  } else if (curEl === "text") {
    // one control per line — matches the template's "Line 1/2/3" EGP fields.
    // Empty lines are skipped: the template's expressions close the gap.
    ["text-l1", "text-l2", "text-l3"].forEach((id, i) => {
      push("Line " + (i + 1), $(id).value.trim());   // empty included — see above
    });
    // the readability gradient is its OWN template with its own button + modal —
    // deliberately NOT part of this CTA, which adds the text only
  }
  // shared Size + Position → Motion (all four elements; skip values at default)
  // adjust disabled (0.37.0): Size & position is hidden pending a rewrite, so no
  // Motion overrides are sent and every element lands exactly as the template
  // designed it. Restore these three pushes when the section comes back.
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
  // NO INVERSION HERE — send "Top" to mean top. This flipped twice, so the
  // arithmetic, once: the template's expression is
  //     Top > 0 ? 0 : 180        (Linear Wipe clears the side the angle points AWAY from)
  // so Top=true -> angle 0 -> scrim at the TOP, Top=false -> 180 -> BOTTOM.
  // The panel briefly inverted this to compensate for templates built BEFORE that
  // expression was fixed; once they were rebuilt the inversion became a double
  // negative and "Top" started producing a bottom gradient. If it ever looks swapped
  // again, the templates are stale — rebuild them, don't flip this.
  const kv = ["Top" + US + (pos === "top" ? "true" : "false"),
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
  if (boundClip) {                       // bound to a clip -> update it, never duplicate
    const res = await jsx(`ochaWriteText(${lit(collectValues())})`) || "";
    return show(res.indexOf("OK|") === 0
      ? `Updated <strong>${boundClip}</strong>.`
      : (res.replace(/^ERR\|/, "") || "Couldn't update the clip."),
      res.indexOf("OK|") === 0 ? "ok" : "err");
  }
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
    if (warn) warn.textContent = "Editing the selected clip \u2014 changes apply live. "
      + "Premiere's Properties panel may keep showing the template defaults; "
      + "Effect Controls \u203a Graphic Parameters and the video itself are always correct.";
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


/* ---------- editing the SELECTED clip ----------
   Select an OCHA clip and the panel binds to it: its real text is loaded into the
   fields and the CTA becomes "Update selected", so typing changes THAT clip instead
   of silently building a second one. Deselect and it goes back to adding.
   Mirrors how the Size & position sliders already behave. */
const FIELD_OF = {                       // EGP control name -> panel input id
  "Name": "lt-name",
  "Title": "lt-title",
  "Title line 2 (optional)": "lt-title2",
  "Place": "loc-place",
  "Date": "loc-date",
  "Line 1": "text-l1",
  "Line 2": "text-l2",
  "Line 3": "text-l3",
};
// Only these elements have editable fields, so only these drive "editing mode".
// The OCHA logo (bug) and the readability gradient have nothing to edit — their
// panes just say "add it" — so selecting one must NOT bind the panel and flip the
// CTA to "Update selected". (Toolbox items aren't timeline clips, so they never
// reach the selection poll at all.)
const EDITABLE_EL = { lt: 1, loc: 1, ending: 1, text: 1 };
let boundClip = null;                    // clip name we're editing, or null
let textWriteTimer = null;

function setBound(clipName, el) {
  boundClip = clipName;
  const btn = $("add");
  btn.textContent = clipName ? "Update selected" : "Add to timeline";
  btn.classList.toggle("is-editing", !!clipName);
  // make the mode unmistakable: sticky banner + accent ring on the whole app
  document.querySelector(".app").classList.toggle("is-editing", !!clipName);
  $("edit-banner").hidden = !clipName;
  if (clipName) $("edit-banner-el").textContent = EL_LABEL[el] || "Element";
  if (clipName && el && el !== curEl) selectEl(el, true);   // show the matching pane
}

// "+ New": drop the binding so the CTA adds a fresh element. Deselecting in
// Premiere is what truly unbinds (the poll re-reads the selection), so ask the
// host to clear it; setBound(null) flips the UI back immediately.
$("edit-banner-new").addEventListener("click", () => {
  jsx("ochaClearSelection()");
  setBound(null, null);
  hideStatus();
});

function fillFields(blob) {
  (blob || "").split(RS).forEach((pair) => {
    if (!pair) return;
    const [ctl, val] = pair.split(US);
    const id = FIELD_OF[ctl];
    if (id && $(id)) $(id).value = val || "";
  });
}

let mirrorTick = 0;
async function syncText() {
  if (!hostReady) return;
  if (document.activeElement && document.activeElement.closest("section.pane")) return;  // don't fight the typist
  if (textWriteBusy) return;                 // our own edit is in flight — fields lead the clip

  // Fast path: ask only WHICH clip is selected. Reading every text property on every
  // tick meant a getMGTComponent() plus a getValue() per control a few times a second
  // — the load in flight when Premiere crashed while editing. Full values are read on
  // a selection change, and otherwise only every 4th tick (~4s) to pick up edits made
  // in Premiere's own panel.
  const head = await jsx("ochaSelectedName()") || "none";
  if (head === "none") {
    if (boundClip !== null) setBound(null, null);
    return;
  }
  const i = head.indexOf("|");
  const name = head.slice(0, i), el = head.slice(i + 1);
  // Non-editable element selected (OCHA logo / gradient) — don't bind. If we were
  // editing something, drop it: the selection genuinely moved to a clip the panel
  // can't edit, so staying in "Update selected" would be a lie.
  if (!EDITABLE_EL[el]) {
    if (boundClip !== null) setBound(null, null);
    return;
  }
  const changed = name !== boundClip;
  if (!changed && (++mirrorTick % 4) !== 0) return;

  const res = await jsx("ochaReadText()") || "none";
  if (res === "none" || res.indexOf("|") < 0) return;
  const i1 = res.indexOf("|"), i2 = res.indexOf("|", i1 + 1);
  const blob = res.slice(i2 + 1);
  if (changed) setBound(name, el);
  if (!textWriteBusy) fillFields(blob);      // re-check: a write may have started
}

// Typing while bound writes straight to that clip, debounced so every keystroke
// isn't a round-trip into Premiere.
let textWriteBusy = false;              // an edit is debouncing/in flight — fields lead the clip
function textEdited() {
  if (!boundClip) return;
  clearTimeout(textWriteTimer);
  textWriteBusy = true;                 // without this, a poll landing inside the debounce
  textWriteTimer = setTimeout(async () => {   // window would revert the field and the stale
    try {                                     // value would then get WRITTEN — a lost edit.
      const res = await jsx(`ochaWriteText(${lit(collectValues())})`) || "";
      if (res.indexOf("OK|") !== 0) show(res.replace(/^ERR\|/, "") || "Couldn't update the clip.", "err");
    } finally { textWriteBusy = false; }
  }, 400);
}
// Bind to EVERY control in the element panes, not just the text inputs — the first
// pass only wired FIELD_OF, so toggling "Centre align" (and the icon / over-black
// checkboxes) changed nothing on the selected clip.
document.querySelectorAll('section.pane input, section.pane select').forEach((el) => {
  el.addEventListener("input", textEdited);
  el.addEventListener("change", textEdited);
});

/* ---------- UI wiring ---------- */
function selectEl(el, fromClip) {
  // Clicking a DIFFERENT card by hand = "I want to make a NEW one of these". Just
  // unbinding the UI isn't enough: the old clip is still selected in Premiere, so the
  // 900ms mirror poll re-binds to it and yanks the pane straight back (the "it keeps
  // going back to the OCHA logo" report). Clear Premiere's selection too, so the poll
  // returns none and this really is a clean slate for the new element.
  if (!fromClip && boundClip && el !== curEl) {
    jsx("ochaClearSelection()");
    setBound(null, null);
  }
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
      if (sel === "#pin-colour") textEdited();          // not an <input> — bind it by hand
    });
  });
});

$("add").addEventListener("click", addElement);

// captions: copy the bundled OCHA .prtextstyle files into Premiere's global
// Text Styles folder so they appear in the native Style dropdown
// Captions: both actions are toolbox-style tiles that open an explaining modal.
$("cap-install").addEventListener("click", () => openTool("capstyles"));
$("cap-gradient").addEventListener("click", () => openTool("gradient"));

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
    explain: "<ul><li>Turns a <strong>square 1:1</strong> sequence into a <strong>9:16 reel</strong>.</li>"
      + "<li>Your clip stays centred; a blurred copy fills top and bottom — no black bars.</li>"
      + "<li>Works on a <strong>duplicate</strong> — your square original is untouched.</li></ul>",
    info: "ochaReelInfo()",
    action: "ochaSquareToReel()",
    cta: () => "Create reel",
    working: "Building the reel on a clone…",
  },
  package: {
    title: "Package project",
    explain: "<ul><li>Copies <strong>every file this project uses</strong> — footage, images, graphics, audio — into one folder, sorted by type.</li>"
      + "<li>Saves a <strong>relinked copy</strong> of the project, and bundles the OCHA branding templates.</li>"
      + "<li>Your original project and files stay put.</li></ul>"
      + "<p class=\"modal-hint\">MOGRTs can't be relinked by script — if a template shows offline, run <strong>File &gt; Project Manager</strong>.</p>",
    info: "ochaPackageInfo()",
    action: "ochaPackageProject()",
    cta: (n) => (n > 0 ? `Package ${n} file${n === 1 ? "" : "s"}` : "Nothing to package"),
    countGated: true,
    once: true,                                       // done once → show the result, not the CTA again
    working: "Choose a folder, then copying media + saving a relinked copy…",
  },
  gradient: {
    title: "Readability gradient",
    explain: "<ul><li>A soft <strong>black gradient</strong> on its own track, so white text stays legible over busy footage.</li>"
      + "<li>Goes in as a <strong>separate clip</strong> — put it on a track <strong>below</strong> your text or captions.</li>"
      + "<li>For <strong>OCHA Clean</strong> captions, keep <strong>Bottom</strong>.</li></ul>",
    settings: "all",                                  // position + fade
    needsFmt: true,
    ready: "Ready — goes in at the playhead, on its own track.",
    done: (r) => `Gradient added on <strong>${trackOf(r)}</strong>. Move it below your text and trim to length.`,
    cta: () => "Add gradient",
    working: "Adding the gradient…",
    action: () => addGradient(gradPos(), gradOpacity()),
  },
  capstyles: {
    title: "Install the OCHA caption styles",
    explain: "<ul><li>Adds <strong>OCHA Boxed</strong> and <strong>OCHA Clean</strong> to Premiere's <strong>Track Style</strong> list.</li>"
      + "<li>Once per computer — they stay for every project.</li>"
      + "<li>Run again anytime to refresh with brand updates.</li></ul>"
      + "<p class=\"modal-hint\">Captioning steps are on the Captions tab.</p>",
    info: "ochaCaptionStylesInstalled()",
    infoLine: (n) => n >= 2 ? "Already installed. Run again to refresh."
      : (n === 1 ? "Partly installed — run to complete." : "Not installed yet."),
    cta: (n) => n >= 2 ? "Reinstall" : "Install the styles",
    working: "Installing the OCHA caption styles…",
    done: (r) => `Installed <strong>${(r.match(/installed=([^|]*)/) || [])[1] || "the styles"}</strong>. `
      + `Pick one under <strong>Track Style</strong> when you make captions.`,
    action: () => jsx(`ochaInstallCaptionStyles(${lit(EXT_ROOT)})`).then((r) => r || ""),
  },
  clean: {
    title: "Clean unused MOGRTs",
    explain: "<ul><li>Removes OCHA templates sitting in the project but <strong>not on any timeline</strong> — leftovers from trying options.</li>"
      + "<li>Also deletes their leftover <strong>.mogrt files</strong>.</li>"
      + "<li>Templates in use are always kept.</li></ul>",
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
  // A tool (gradient, reel, package, clean, caption styles) is always a different
  // function from editing a selected element. If we were bound to a clip, drop it and
  // clear Premiere's selection so opening the tool is a clean start, not a lingering
  // "Update selected" behind the modal that the poll would keep reasserting.
  if (boundClip) { jsx("ochaClearSelection()"); setBound(null, null); }
  curTool = key;
  $("modal-title").textContent = cfg.title;
  $("modal-desc").innerHTML = cfg.explain;          // static explanation — always shown
  // per-tool settings: "all" = position + fade, "fade" = fade only (position fixed)
  $("modal-settings").hidden = !cfg.settings;
  $("grad-pos").hidden = cfg.settings !== "all";
  // Reset the position to Bottom on every open. It's the common case (text and
  // captions both sit low), and a choice left over from last time is a quiet way
  // to end up with the scrim on the wrong edge.
  document.querySelectorAll("#grad-pos .seg__opt").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.pos === "bottom"));
  modalInfo("Checking the project…", false);        // live status line
  $("modal-result").hidden = true;
  const run = $("modal-run");
  run.hidden = false;                               // a `once` tool hid it last time
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
  const run = $("modal-run");
  // `infoLine` tools return OK|<count>: derive the status line and CTA from the
  // count itself (e.g. caption styles — installed / partly / not).
  if (cfg.infoLine) {
    const n = parseInt(parts[1], 10) || 0;
    modalInfo(ok ? cfg.infoLine(n) : "Couldn't check Premiere's Text Styles.", !ok);
    run.textContent = cfg.cta(n);
    run.disabled = !ok;
    return;
  }
  const status = parts[1] || (ok ? "" : (res.replace(/^ERR\|/, "") || "Couldn't read the project."));
  const count = parts.length > 2 ? parseInt(parts[2], 10) : null;
  modalInfo(status, !ok);
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
  if (ok && cfg.once) {
    // one-shot tools (Package): don't re-offer the action — just the result + Done.
    run.hidden = true;
  } else if (ok) {
    refresh(); loadInfo();             // refresh format chip + re-read counts
  } else {
    run.disabled = false;
  }
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
    if (url.indexOf("crisisrelief") !== -1) { try { Analytics.ping("donate:click"); } catch (er) {} }
    try {
      if (window.cep && window.cep.util) window.cep.util.openURLInDefaultBrowser(url);
      else window.open(url);
    } catch (err) { try { window.open(url); } catch (e2) {} }
  });
});

/* ---------- kebab menu (About / Appearance / What's new / donate) ----------
   Same pattern as the DataViz plugin: a header button toggles an absolutely-positioned
   dropdown; a document click (outside) or Escape closes it. The appearance (light/dark)
   toggle lives inside the menu now, not as a standalone header button. */
const menuBtn = $("menu-btn"), menuDropdown = $("menu-dropdown");
function closeMenu() {
  menuDropdown.classList.remove("visible");
  menuBtn.classList.remove("active");
  menuBtn.setAttribute("aria-expanded", "false");
}
if (menuBtn && menuDropdown) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menuDropdown.classList.toggle("visible");
    menuBtn.classList.toggle("active", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) updateMenuStatus();     // refresh the update line + diagnostics on open
  });
  // click anywhere outside the menu (and not on the button) closes it
  document.addEventListener("click", (e) => {
    if (menuDropdown.classList.contains("visible") &&
        !menuDropdown.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuDropdown.classList.contains("visible")) closeMenu(); });
}

// appearance toggle (inside the menu) — same persisted light/dark as before
$("btn-theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
});

// About shows the running version
{ const mv = $("menu-version"); if (mv) mv.textContent = "v" + PANEL_VERSION; }

// "What's new" — the notes for the version we're actually running, read from the
// LOCAL version.json (the same `notes` field we fill each release). Best-effort:
// if the file can't be read the section just stays hidden.
function loadWhatsNew() {
  const wrap = $("menu-whatsnew-wrap"), body = $("menu-whatsnew"), tag = $("menu-whatsnew-ver");
  if (!wrap || !body || !EXT_ROOT) return;
  let xhr; try { xhr = new XMLHttpRequest(); } catch (e) { return; }
  // file:/// + path-with-leading-slash-stripped works for both: Mac "/Users/…" ->
  // "file:///Users/…", Windows "C:/Users/…" -> "file:///C:/Users/…".
  try { xhr.open("GET", encodeURI("file:///" + EXT_ROOT.replace(/^\//, "") + "/version.json") + "?t=" + Date.now(), true); }
  catch (e) { return; }
  xhr.onreadystatechange = () => {
    if (xhr.readyState !== 4) return;
    let info; try { info = JSON.parse(xhr.responseText); } catch (e) { return; }
    if (!info || !info.notes) return;
    body.textContent = info.notes;
    if (tag && info.version) tag.textContent = "v" + info.version;
    wrap.hidden = false;
  };
  try { xhr.send(); } catch (e) { /* best-effort */ }
}
loadWhatsNew();

// Menu footer: update status ("You have the latest version" / "vX available") plus
// a click-to-reveal diagnostics readout — which updater gate is failing (node,
// helper, symlink, writability) without attaching a debugger. DataViz pattern; it
// is what made the Windows update debugging possible there.
function updateMenuStatus() {
  const el = $("menu-update-status");
  if (el) {
    if (!latestInfo) el.textContent = "Update check: not reached yet";
    else if (cmpVer(PANEL_VERSION, latestInfo.version) >= 0) el.innerHTML = "✓ You have the latest version";
    else el.innerHTML = "New version <strong>v" + esc(latestInfo.version) + "</strong> available — see the banner";
  }
  const d = $("menu-diag");
  if (d) {
    let diag;
    try { diag = AutoUpdater.diagnose(EXT_ROOT); } catch (e) { diag = { error: String(e && e.message || e) }; }
    d.textContent = "panel: v" + PANEL_VERSION + "\n" +
      Object.keys(diag).map((k) => k + ": " + diag[k]).join("\n");
  }
}
{ const s = $("menu-update-status");
  if (s) s.addEventListener("click", () => { const d = $("menu-diag"); if (d) d.hidden = !d.hidden; }); }

/* ---------- Update check (GitHub-hosted version.json; notify + manual download) ----------
   Mirrors the DataViz plugin's version check but channelled via GitHub (same repo
   the web app self-updates from) instead of Dropbox — no tokens, versioned, free.
   MVP = notify-only: shows a banner linking to the download/instructions. Full
   silent .zxp auto-extract (DataViz phase 2) needs a signed .zxp + --enable-nodejs. */
const UPDATE_URL = "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/premiere/cep/version.json";
const UPD_DISMISS_KEY = "qv-update-dismissed";
// The banner is shared by the new-version prompt and the post-update "Updated ✓" /
// error / staged notes. Track which version (if any) is being OFFERED, so the single
// dismiss handler records "don't nag me about this one" only for the new-version case.
let offeredVersion = null;
let latestInfo = null;      // last successfully fetched version.json (menu status line)
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
    latestInfo = info;               // menu status line reads this ("latest" / "vX available")
    if (cmpVer(PANEL_VERSION, info.version) >= 0) return;      // already current or newer
    try { if (localStorage.getItem(UPD_DISMISS_KEY) === info.version) return; } catch (e) {}  // dismissed this one
    showUpdateBanner(info);
  };
  try { xhr.send(); } catch (e) { /* silent */ }
}
function bannerMsg(html) { const m = $("update-msg"); if (m) m.innerHTML = html; }

function showUpdateBanner(info) {
  const bar = $("update-banner");
  if (!bar) return;
  const url = info.downloadUrl || "https://github.com/UN-OCHA/quickvid_BDU";
  const btn = $("update-now");
  // Full gate, not just "node exists": helper present + not a symlinked dev
  // install + the folder actually writable (Program Files installs are read-only
  // for non-admins). When any gate fails we show the manual link, never a fake
  // "Update now" that pretends to work. (DataViz isAvailable(), ported.)
  const canInstall = AutoUpdater.isAvailable(EXT_ROOT) && info.packageUrl;

  bannerMsg("New version <strong>v" + esc(info.version) + "</strong>");
  if (canInstall) {
    // One click: download, then the helper installs it once Premiere quits.
    btn.hidden = false;
    // Always re-enable on render. The handler disables the button while working and
    // the success path leaves it that way (it hides it instead), so a later re-render
    // would otherwise show a permanently dead button.
    btn.disabled = false;
    btn.textContent = "Update now";
    btn.onclick = () => {
      btn.disabled = true;
      bannerMsg("Downloading v" + esc(info.version) + "\u2026");
      Analytics.ping("update:start");
      AutoUpdater.download(info.packageUrl, info.version, EXT_ROOT, {
        onProgress: (pct) => bannerMsg("Downloading v" + esc(info.version) + " \u2014 " + pct + "%"),
        onError: (msg) => {
          btn.disabled = false;
          bannerMsg("Update failed: " + esc(msg) + ". ");
          linkOut(url, "Download it manually");
          Analytics.ping("update:failed");
        },
        onDone: () => {
          const res = AutoUpdater.apply(info.version);
          if (!res.ok) {
            btn.disabled = false;
            bannerMsg("Couldn't start the installer: " + esc(res.error) + ". ");
            linkOut(url, "Download it manually");
            Analytics.ping("update:failed");
            return;
          }
          btn.hidden = true;
          bannerMsg("v" + esc(info.version) + " is ready \u2014 <strong>quit Premiere</strong> to finish installing.");
          Analytics.ping("update:staged");
        },
      });
    };
  } else {
    // No Node (old manifest) or no package published: the original notify-only path.
    btn.hidden = true;
    bannerMsg("New version <strong>v" + esc(info.version) + "</strong> \u2014 ");
    linkOut(url, "how to update");        // no installer: the original notify-only path
  }

  offeredVersion = info.version;   // dismissing THIS one records it — see the init handler
  bar.hidden = false;
}

// Append a clickable link that opens in the real browser, not inside the panel.
function linkOut(url, label) {
  const m = $("update-msg");
  if (!m) return;
  const a = document.createElement("u");
  a.className = "update-link-out";
  a.textContent = label;
  a.onclick = () => {
    try {
      if (window.cep && window.cep.util) window.cep.util.openURLInDefaultBrowser(url);
      else window.open(url);
    } catch (e) { try { window.open(url); } catch (e2) {} }
  };
  m.appendChild(a);
}

/* What happened while the panel was closed? An update installs after Premiere
   quits, so the result can only be reported on the next launch. */
function reportUpdateResult() {
  if (!AutoUpdater.available()) return;
  const st = AutoUpdater.checkMarkers(EXT_ROOT);
  const bar = $("update-banner");
  offeredVersion = null;           // a result note, not a nag — dismissing it just hides
  if (st.kind === "applied") {
    $("update-now").hidden = true;
    // TRUST BUT VERIFY: the marker only proves the helper RAN. If it claims a
    // version NEWER than the code now executing, the extraction didn't actually
    // land (the exact failure we shipped once: helper "succeeded", files never
    // changed). Say so instead of celebrating a phantom update.
    if (st.version && cmpVer(PANEL_VERSION, st.version) < 0) {
      bannerMsg("The update to <strong>v" + esc(st.version) + "</strong> didn't take \u2014 still running v" + PANEL_VERSION + ". See \u22ee menu for diagnostics.");
      Analytics.ping("update:phantom");
    } else {
      bannerMsg("Updated to <strong>v" + esc(st.version || PANEL_VERSION) + "</strong> \u2713");
      Analytics.ping("update:applied");
    }
    bar.hidden = false;
  } else if (st.kind === "error") {
    $("update-now").hidden = true;
    bannerMsg("The last update didn't install: " + esc(st.message));
    bar.hidden = false;
  } else if (st.kind === "staged") {
    $("update-now").hidden = true;
    // Re-arm: the helper spawned last session is gone (it dies with its 30-min
    // wait, or never ran). Without a fresh spawn, "quit Premiere to finish" would
    // be a promise nobody keeps \u2014 the DataViz "pending" lesson.
    const re = AutoUpdater.apply(st.version);
    if (re.ok) bannerMsg("v" + esc(st.version) + " is downloaded \u2014 <strong>quit Premiere</strong> to finish installing.");
    else bannerMsg("Update couldn't restart: " + esc(re.error));
    bar.hidden = false;
  }
}

loadHost().then(refresh);
// anonymous usage pings (version / event / approximate city) — see js/analytics.js.
// Never sends typed text, project names or paths. No-op until configured.
try { Analytics.init(PANEL_VERSION); } catch (e) { /* analytics must never break the panel */ }
// ONE dismiss (×) handler for the update banner, whatever state it's in. It used to
// be wired only inside showUpdateBanner, so the post-update "Updated ✓" / error /
// staged notes had a dead × and couldn't be closed.
$("update-dismiss").addEventListener("click", () => {
  if (offeredVersion) { try { localStorage.setItem(UPD_DISMISS_KEY, offeredVersion); } catch (e) {} }
  $("update-banner").hidden = true;
});
reportUpdateResult();           // did an update land while we were away?
checkForUpdate();               // once on load; a new release surfaces on next panel open
setInterval(refresh, 2500);
// adjust disabled (0.37.0): no Motion polling while Size & position is hidden.
// setInterval(syncAdjust, 900);
setInterval(syncText, 900);     // bind the text fields to a selected OCHA clip
