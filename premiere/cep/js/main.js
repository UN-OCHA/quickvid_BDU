/* OCHA Branding — panel logic (runs in CEP's Chromium; modern JS is fine here.
   All Premiere work happens in jsx/host.jsx via evalScript). */

const PANEL_VERSION = "2026.0.47";           // keep in sync with CSXS/manifest.xml

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
  checkColor();                                  // same tick as the format chip
  refreshTracks();
  curFmt = parts[2];
  chip.textContent = `${parts[0]}×${parts[1]} · ${parts[3]}`;
  chip.className = "chip is-ok";
  $("add").disabled = false;
  // keep the Position sliders spanning THIS sequence's frame; placement-mode
  // values follow the format's centre (a bound clip keeps its own values)
  const w = +parts[0] || 0, h = +parts[1] || 0;
  if (w && h && (w !== curW || h !== curH)) {
    curW = w; curH = h;
    setAdjRanges();
    if (!adjEditClip) resetAdjust();
  }
}

/* ---------- track picker ----------
   "" = automatic: the host puts graphics on the top track and the readability
   gradient on the lowest FREE one, so the scrim sits under the text it exists to
   make readable. A chosen value is a 0-based track index. */
// A tool modal has its OWN track picker (the Brand-tab one is a tab away while a
// modal is open). Whichever is on screen owns the choice: modal first when a tool
// is open, otherwise the Brand tab's.
const trackPref = () => {
  const modal = $("tool-modal");                   // NOT "modal" - that id does not exist
  // Read the modal's picker ONLY while a clip-placing tool is on screen. Gating on
  // "a modal is open" alone would hand back a stale value from a tool whose Track
  // row is hidden (Package, Tidy...), i.e. a number the user never chose.
  const cfg = curTool ? TOOLS[curTool] : null;
  const inTool = cfg && cfg.places && modal && !modal.hidden;
  const sel = inTool ? $("modal-track") : $("track-pick");
  return (sel || {}).value || "";
};
let trackListSig = "";
async function refreshTracks() {
  const sels = [$("track-pick"), $("modal-track")].filter(Boolean);
  if (!sels.length) return;
  const res = await jsx("ochaTrackList()") || "none";
  const p = res.split("|");
  if (p[0] !== "OK") return;
  if (res === trackListSig) return;                 // unchanged - don't clobber the choice
  trackListSig = res;
  const names = (p[2] || "").split(",").filter(Boolean);
  // ONE list, filled into every picker - two selects that could drift would be
  // worse than the tab-away problem this solves.
  const html = '<option value="">Automatic</option>'
    + names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).reverse().join("");
  sels.forEach((sel) => {
    const keep = sel.value;
    sel.innerHTML = html;
    sel.value = names[+keep] !== undefined ? keep : "";  // keep the choice if it still exists
  });
}

/* ---------- sequence colour watch ----------
   Reading settings is safe (only the blind WRITE-back is dangerous), so the
   panel can poll this alongside the format chip. Shows a banner - never a
   modal - because this re-runs every 2.5s and on every sequence switch. */
async function checkColor() {
  const banner = $("color-banner");
  if (!banner) return;
  const res = await jsx("ochaColorStatus()") || "none";
  const p = res.split("|");
  if (p[0] !== "OK") { banner.hidden = true; return; }
  const ok = p[3] === "1";
  banner.hidden = ok;
  if (!ok) {
    $("color-banner-msg").innerHTML =
      `This sequence is <strong>${esc(p[4] || "not Rec. 709")}</strong>, not Rec. 709 — it will export washed out.`;
  }
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
    push("3rd line (optional)", $("lt-title2").value.trim());   // host aliases to the old EGP name on pre-0.42 clips
    push("Centre align", $("lt-centre").checked);
    // Chosen BEFORE placing, so a UN-style lower third goes down in one step.
    // "@" prefix keeps it out of the clip's auto name (see ochaAdd).
    push("@font", placementFont);
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
  // Position rides along only when moved off the frame centre (absolute px,
  // clamped — see the Position controls block). Scale stays parked: no @scale
  // is ever sent, so every element keeps the template's designed size.
  if (curFmt && curW && curH) {
    const px = clampPos($("adj-x-n").value, "w"), py = clampPos($("adj-y-n").value, "h");
    if (px !== adjCentre("w")) push("@posX", px);
    if (py !== adjCentre("h")) push("@posY", py);
  }
  return kv.join(RS);
}

function clampNum(v, dflt) {
  const n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

const EL_LABEL = { lt: "Lower third", loc: "Location", bug: "OCHA logo", ending: "Ending", text: "Text" };

// The companion web app — referenced from the Toolbox tile and the menu, so
// Premiere users discover the tools that DON'T need Premiere (compress, cut
// by transcript, captions).
const WEBAPP_URL = "https://un-ocha.github.io/quickvid_BDU/";
function openExternal(url) {
  try {
    if (window.cep && window.cep.util) window.cep.util.openURLInDefaultBrowser(url);
    else window.open(url);
  } catch (e) { try { window.open(url); } catch (e2) {} }
}

/* The readability scrim is a template of its own (OCHA Gradient), added by its own
   button + modal rather than riding along with the Text CTA — Text, Captions and the
   Toolbox all reach the same one. `pos` is bottom | top | full. */
function addGradient(pos, opacity) {
  // "middle-left" / "middle-right" in analytics: the half is a real usage signal,
  // not a variant of plain middle.
  const half = pos === "middle" ? gradHalf() : "full";
  try { Analytics.ping("gradient:" + pos + (half === "full" ? "" : "-" + half)); } catch (e) {}
  // NO INVERSION HERE — send "Top" to mean top. This flipped twice, so the
  // arithmetic, once: the template's expression is
  //     Top > 0 ? 0 : 180        (Linear Wipe clears the side the angle points AWAY from)
  // so Top=true -> angle 0 -> scrim at the TOP, Top=false -> 180 -> BOTTOM.
  // The panel briefly inverted this to compensate for templates built BEFORE that
  // expression was fixed; once they were rebuilt the inversion became a double
  // negative and "Top" started producing a bottom gradient. If it ever looks swapped
  // again, the templates are stale — rebuild them, don't flip this.
  // The halves are only meaningful under Middle, and the template reads them that
  // way too (its expression gates on `mid`) - but send them false anywhere else
  // so an old clip edited into a new position can never keep a stale cloud.
  const kv = ["Top" + US + (pos === "top" ? "true" : "false"),
              "Middle" + US + (pos === "middle" ? "true" : "false"),
              "Middle left" + US + (half === "left" ? "true" : "false"),
              "Middle right" + US + (half === "right" ? "true" : "false"),
              "Full screen" + US + (pos === "full" ? "true" : "false"),
              "Opacity" + US + (opacity == null ? 80 : opacity)].join(RS);
  // gradient defaults to "bottom" in the host, so an empty pref still lands low
  return jsx(`ochaAdd("gradient",${lit(curFmt)},${lit(EXT_ROOT)},${lit(kv)},${lit(trackPref())})`).then((r) => r || "");
}
// The vignette is an ordinary OCHA element, so it rides the same add path as the
// rest - which is also how it inherits the track picker and the size/position
// binder for free. It goes on TOP by default: it darkens the picture, so it has
// to sit above the footage (the readability gradient is the opposite case).
function addVignette(amount) {
  const kv = ["Amount" + US + (amount == null ? 55 : amount),
              "Size" + US + 50].join(RS);
  return jsx(`ochaAdd("vignette",${lit(curFmt)},${lit(EXT_ROOT)},${lit(kv)},${lit(trackPref())})`)
    .then((r) => r || "");
}
function gradPos() {
  const g = document.querySelector("#grad-pos .seg__opt.is-active");
  return (g && g.dataset.pos) || "bottom";
}
function gradHalf() {
  const g = document.querySelector("#grad-mid-w .seg__opt.is-active");
  return (g && g.dataset.half) || "full";
}
// The Middle sub-section only exists while Middle is the chosen position.
function setMidUI() {
  const box = $("grad-mid");
  if (box) box.hidden = gradPos() !== "middle";
}
function gradOpacity() { return clampNum($("grad-op-n").value, 80); }

async function addElement() {
  hideStatus();
  if (boundClip) {                       // bound to a clip -> update it, never duplicate
    const res = await jsx(`ochaWriteText(${lit(collectValues())},true,${lit(boundClip)})`) || "";
    const ok = res.indexOf("OK|") === 0;
    // Update renames the item to match the edit — follow it, or the next poll
    // would treat our own rename as a brand-new selection.
    const named = (res.match(/named=([^|]*)/) || [])[1];
    if (ok && named) setBound(named, curEl);
    return show(ok
      ? `Updated <strong>${esc(named || boundClip)}</strong>.`
      : (res.replace(/^ERR\|/, "") || "Couldn't update the clip."),
      ok ? "ok" : "err");
  }
  if (!curFmt) return show("This sequence isn’t one of the OCHA formats (9:16, 4:5, 1:1, 16:9).", "warn");
  const btn = $("add");
  btn.disabled = true;
  show("Adding…", "ok");
  try {
    const call = `ochaAdd(${lit(curEl)},${lit(curFmt)},${lit(EXT_ROOT)},${lit(collectValues())},${lit(trackPref())})`;
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

/* ---------- Position controls (0.42: position only, scale parked) ----------
   ABSOLUTE comp pixels — the same numbers Premiere shows in Effect Controls >
   Motion > Position. Default = the frame centre (what every template designs
   around). Three input routes, all clamped to [0..W]/[0..H] so a clip can
   never leave the comp (the host clamps again as the hard cap): the slider
   (its min/max ARE the frame), the ±1px arrows, and the number field, which
   snaps back into range when a typed value is too high/low. */
// [slider id, number id, axis ("w"|"h"), reset id, dec arrow, inc arrow]
const ADJ_PAIRS = [
  ["adj-x", "adj-x-n", "w", "adj-x-r", "adj-x-dec", "adj-x-inc"],
  ["adj-y", "adj-y-n", "h", "adj-y-r", "adj-y-dec", "adj-y-inc"],
];
let curW = 0, curH = 0;               // active sequence frame size (set by refresh)
const adjMax = (axis) => (axis === "w" ? curW : curH) || 1080;
const adjCentre = (axis) => Math.round(adjMax(axis) / 2);
const clampPos = (v, axis) => {
  const n = Math.round(parseFloat(v));
  return isNaN(n) ? adjCentre(axis) : Math.max(0, Math.min(adjMax(axis), n));
};
// sliders span the frame exactly; called when the format (or bound clip) changes
function setAdjRanges() {
  ADJ_PAIRS.forEach(([sId, nId, axis]) => {
    $(sId).min = 0; $(sId).max = adjMax(axis);
    $(nId).min = 0; $(nId).max = adjMax(axis);
  });
}
function linkPair(sliderId, numId) {
  const s = $(sliderId), n = $(numId);
  s.addEventListener("input", () => { n.value = s.value; });
  n.addEventListener("input", () => {
    const v = parseFloat(n.value);
    if (!isNaN(v)) s.value = Math.max(+s.min, Math.min(+s.max, v));
  });
}
function resetAdjust() {
  ADJ_PAIRS.forEach(([sId, nId, axis]) => {
    $(sId).value = adjCentre(axis); $(nId).value = adjCentre(axis);
  });
}
// reset a single value to the frame centre; in edit mode this writes live too
// Reset = back to the TEMPLATE's designed spot (host reads the parameter's own
// default), NOT the frame centre - which is what made this behave like a
// one-step undo. With nothing bound there is no clip to ask, so the sliders just
// return to the format centre as a neutral starting point for the next Add.
async function resetOne(sId, nId, axis) {
  if (!adjEditClip) {
    $(sId).value = adjCentre(axis); $(nId).value = adjCentre(axis);
    return;
  }
  const res = await jsx("ochaResetPos()") || "";
  if (res.indexOf("OK|") !== 0) {
    show(res.replace(/^ERR\|/, "") || "Couldn't reset the position.", "warn");
    return;
  }
  const [, x, y] = res.split("|");
  // BOTH axes go home together: the designed position is a point, not two
  // independent numbers, so resetting one alone would leave the element skewed.
  $("adj-x").value = $("adj-x-n").value = clampPos(x, "w");
  $("adj-y").value = $("adj-y-n").value = clampPos(y, "h");
  show("Back to the template's default position.", "ok");
}
linkPair("grad-op", "grad-op-n");     // gradient fade slider <-> number
ADJ_PAIRS.forEach(([sId, nId, axis, rId, decId, incId]) => {
  linkPair(sId, nId);
  const nudge = (delta) => {
    const v = clampPos(+$(nId).value + delta, axis);
    $(sId).value = v; $(nId).value = v;
    adjLiveWrite();
  };
  $(decId).addEventListener("click", () => nudge(-1));
  $(incId).addEventListener("click", () => nudge(+1));
  // typed values commit on change (Enter/blur) and STICK to the frame limits
  $(nId).addEventListener("change", () => {
    const v = clampPos($(nId).value, axis);
    $(sId).value = v; $(nId).value = v;
    adjLiveWrite();
  });
  const r = $(rId);
  if (r) r.addEventListener("click", () => resetOne(sId, nId, axis));
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
["adj-x", "adj-y", "adj-x-n", "adj-y-n"].forEach((id) => {
  const el = $(id);
  el.addEventListener("pointerdown", () => { adjDragging = true; });
  el.addEventListener("pointerup", () => { adjDragging = false; });
  el.addEventListener("input", adjLiveWrite);
});
function adjLiveWrite() {
  if (!adjEditClip) return;                     // placement mode → nothing to write
  clearTimeout(adjTimer);
  adjTimer = setTimeout(() => {
    jsx(`ochaWriteMotion(${clampPos($("adj-x-n").value, "w")},${clampPos($("adj-y-n").value, "h")})`);
  }, 100);
}
function setAdjustEditing(name) {
  // The inside warning is gone: it repeated the pill's message. The pill alone
  // carries it now, and swaps to "editing" while bound to a clip.
  const tag = document.querySelector(".adj-tag");
  if (!tag) return;
  if (name) {
    tag.textContent = "editing";
    tag.style.color = "var(--accent)"; tag.style.borderColor = "var(--accent)"; tag.style.background = "var(--accent-bg)";
  } else {
    tag.textContent = "use with care";
    tag.style.color = ""; tag.style.borderColor = ""; tag.style.background = "";
  }
}
async function syncAdjust() {
  if (!hostReady || adjDragging) return;
  if (!document.querySelector('.sec[data-sec="brand"]').classList.contains("is-open")) return;
  // don't fight the user mid-typing in a number field
  const act = document.activeElement;
  if (act && (act.id === "adj-x-n" || act.id === "adj-y-n")) return;
  const res = await jsx("ochaReadMotion()") || "none";
  if (res === "none" || res.indexOf("|") < 0) {
    // unbound → back to placement mode at the frame centre, so the LAST clip's
    // position can't silently ride into the NEXT Add
    if (adjEditClip !== null) { adjEditClip = null; setAdjustEditing(null); resetAdjust(); collapseAdjust(); }
    syncFont(null);
    return;
  }
  // <name>|<x>|<y>|<W>|<H> — absolute px + the clip's own sequence frame size
  const p = res.split("|");
  if (p[0] !== adjEditClip) {                    // newly selected clip → bind + populate
    adjEditClip = p[0];
    setAdjustEditing(p[0]);
    // stays COLLAPSED on purpose (Javi): position is a use-with-caution control,
    // so it never opens itself — a new binding even closes it again
    collapseAdjust();
    if (+p[3] && +p[4]) { curW = +p[3]; curH = +p[4]; }
    setAdjRanges();
    $("adj-x").value = $("adj-x-n").value = clampPos(+p[1], "w");
    $("adj-y").value = $("adj-y-n").value = clampPos(+p[2], "h");
    syncFont(p[0], p[6]);                          // p[6] = font index, same call
  }
}

/* ---------- Advanced settings > Font ----------
   Two modes, same control:
     PLACEMENT (nothing selected) - the dropdown is the choice for the NEXT Add,
       sent as @font in collectValues(). Javi: "font selection doesn't appear
       before placing. It should, in case I want to place straight away the UN
       style with Bebas."
     EDIT (an OCHA clip selected) - it mirrors that clip and writes to it live.

   Only the lower third has a Font control, so the group shows for `lt` and stays
   hidden elsewhere. A template built before the feature reports "none" and the
   group hides in edit mode too, rather than offering a control that does nothing. */
let fontClip = null;
// The choice for the NEXT Add, kept SEPARATE from whatever a selected clip happens
// to use. Without this the dropdown carried the last-edited clip's font into the
// next placement, so a new lower third came out Bebas — the OCHA default must
// survive editing a UN-style clip.
// 0-BASED (Raleway=0, Bebas=1) — same convention as "Pin colour". See index.html.
let placementFont = 0;
// NOT `|| 0`-style coercion: 0 is a VALID choice here (it is the OCHA default), so
// a falsy fallback would silently turn Raleway into Bebas.
const fontChoice = () => {
  const v = parseInt(($("adj-font") || {}).value, 10);
  return isNaN(v) ? 0 : v;
};

// Visibility ONLY — must never touch fontClip. selectEl() calls this, and selectEl
// runs when a clip BINDS (setBound -> selectEl). It used to call syncFont(null),
// which cleared the binding a moment after syncAdjust had set it: the dropdown then
// silently did nothing from the panel while Premiere's own Properties still worked.
function fontVisibility() {
  const wrap = $("adj-font-wrap");
  if (wrap && !fontClip) wrap.hidden = curEl !== "lt";   // edit mode: syncFont owns it
}

// `idx` comes from ochaReadMotion's last field — no extra round trip. "" means the
// template has no Font control (an older installed template).
function syncFont(clipName, idx) {
  const wrap = $("adj-font-wrap"), sel = $("adj-font");
  if (!wrap || !sel) return;
  if (!clipName) {                                // back to placement mode
    fontClip = null;
    sel.value = String(placementFont);            // restore the next-Add choice
    wrap.hidden = curEl !== "lt";
    return;
  }
  // "" (not a number) = the template has no Font control -> hide. 0 is VALID
  // (Raleway), so this must test for NaN, never for falsiness.
  const n = parseInt(idx, 10);
  if (isNaN(n)) { wrap.hidden = true; fontClip = null; return; }
  sel.value = String(n);
  wrap.hidden = false;
  fontClip = clipName;
}
if ($("adj-font")) {
  $("adj-font").addEventListener("change", async () => {
    // Placement mode: remember it for the next Add; there is nothing to write yet.
    if (!fontClip) { placementFont = fontChoice(); return; }
    const r = await jsx(`ochaSetFont(${fontChoice()})`) || "";
    if (r.indexOf("ERR|") === 0) show(esc(r.slice(4)), "warn");
  });
}


/* ---------- editing the SELECTED clip ----------
   Select an OCHA clip and the panel binds to it: its real text is loaded into the
   fields and the CTA becomes "Update selected", so typing changes THAT clip instead
   of silently building a second one. Deselect and it goes back to adding.
   Mirrors how the Size & position sliders already behave. */
const FIELD_OF = {                       // EGP control name -> panel input id
  "Name": "lt-name",
  "Title": "lt-title",
  "3rd line (optional)": "lt-title2",         // current template name…
  "Title line 2 (optional)": "lt-title2",     // …and the pre-0.42 one, so old clips still load
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
// Unbind + drop any pending debounced write: it belonged to the clip we are
// letting go of, and must never land on whatever gets selected next.
function dropBinding() {
  clearTimeout(textWriteTimer);
  textWriteBusy = false;
  setBound(null, null);
  hideStatus();          // any message about that clip is now stale
}
async function syncText() {
  if (!hostReady) return;

  // Fast path: ask only WHICH clip is selected. Reading every text property on every
  // tick meant a getMGTComponent() plus a getValue() per control a few times a second
  // — the load in flight when Premiere crashed while editing. Full values are read on
  // a selection change, and otherwise only every 4th tick (~4s) to pick up edits made
  // in Premiere's own panel.
  const head = await jsx("ochaSelectedName()") || "none";
  if (head === "none") {
    if (boundClip !== null) dropBinding();
    return;
  }
  const i = head.indexOf("|");
  const name = head.slice(0, i), el = head.slice(i + 1);
  // Non-editable element selected (OCHA logo / gradient) — don't bind. If we were
  // editing something, drop it: the selection genuinely moved to a clip the panel
  // can't edit, so staying in "Update selected" would be a lie.
  if (!EDITABLE_EL[el]) {
    if (boundClip !== null) dropBinding();
    return;
  }
  const changed = name !== boundClip;
  if (changed) {
    // rebind FIRST — a pending write belonged to the previous clip, drop it
    clearTimeout(textWriteTimer); textWriteBusy = false;
    setBound(name, el);
  }
  // Only the FIELD REFILL yields to the typist / an in-flight write. These guards
  // used to sit at the TOP of the poll, so with focus parked in any field a
  // deselect in Premiere was never noticed — the panel claimed something was
  // selected with nothing selected. Selection truth is reconciled above, always.
  if (document.activeElement && document.activeElement.closest("section.pane")) return;
  if (textWriteBusy) return;
  if (!changed && (++mirrorTick % 4) !== 0) return;

  const res = await jsx("ochaReadText()") || "none";
  if (res === "none" || res.indexOf("|") < 0) return;
  const i1 = res.indexOf("|"), i2 = res.indexOf("|", i1 + 1);
  const blob = res.slice(i2 + 1);
  if (!textWriteBusy) fillFields(blob);      // re-check: a write may have started
}

// Typing while bound writes straight to that clip, debounced so every keystroke
// isn't a round-trip into Premiere.
let textWriteBusy = false;              // an edit is debouncing/in flight — fields lead the clip
function textEdited() {
  if (!boundClip) return;
  clearTimeout(textWriteTimer);
  textWriteBusy = true;                 // without this, a poll landing inside the debounce
  const expect = boundClip;             // the clip this edit belongs to
  textWriteTimer = setTimeout(async () => {   // window would revert the field and the stale
    try {                                     // value would then get WRITTEN — a lost edit.
      if (!boundClip || boundClip !== expect) return;   // unbound or moved mid-debounce — void
      // Renames live, so the item tracks what you typed. Safe now: the host
      // no-ops when the name is unchanged, and we ADOPT the new name below so the
      // poll never mistakes our own rename for a new selection (that mistake is
      // what made the fields refill under the typist).
      // `expect` is the name as of the KEYSTROKE. Our own live rename can move it
      // under an in-flight write, so a name mismatch here is usually us, not the
      // user — resend once against the current name rather than cry wolf.
      let res = await jsx(`ochaWriteText(${lit(collectValues())},true,${lit(expect)})`) || "";
      if (res.indexOf("Selection changed") !== -1 && boundClip && boundClip !== expect) {
        res = await jsx(`ochaWriteText(${lit(collectValues())},true,${lit(boundClip)})`) || "";
      }
      if (res.indexOf("OK|") !== 0) {
        // The selection going away mid-debounce is a no-op, not a failure. Errors
        // are sticky by design, so a background write must never raise one for it:
        // deselecting after typing left a red banner sitting there forever.
        const benign = res.indexOf("Selection changed") !== -1 ||
                       res.indexOf("Select an OCHA clip first") !== -1;
        if (!benign) show(res.replace(/^ERR\|/, "") || "Couldn't update the clip.", "err");
        return;
      }
      const named = (res.match(/named=([^|]*)/) || [])[1];
      if (named && boundClip === expect) setBound(named, curEl);
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
  fontVisibility();    // … and Font shows only for the lower third
  hideStatus();
}
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => selectEl(c.dataset.el)));

// segmented controls (pin colour, text-gradient) — one active option each
["#pin-colour", "#grad-pos", "#grad-mid-w"].forEach((sel) => {
  document.querySelectorAll(sel + " .seg__opt").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(sel + " .seg__opt").forEach((q) => q.classList.toggle("is-active", q === b));
      if (sel === "#pin-colour") textEdited();          // not an <input> — bind it by hand
      if (sel === "#grad-pos") setMidUI();              // Middle reveals its own width row
    });
  });
});

$("add").addEventListener("click", addElement);

// captions: copy the bundled OCHA .prtextstyle files into Premiere's global
// Text Styles folder so they appear in the native Style dropdown
// Captions: both actions are toolbox-style tiles that open an explaining modal.
$("cap-install").addEventListener("click", () => openTool("capstyles"));
$("cap-guides").addEventListener("click", () => openTool("capguides"));
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
/* ---------- packaged-project template relink ----------
   The packager copies the .prproj as a plain file, so nothing is relinked yet.
   A .prproj is gzipped XML with the media paths in it as text, and CEP gives us
   Node + zlib — so every path is rewritten here. Doing it as text is also what
   lets MOGRTs relink at all: Premiere's changeMediaPath refuses templates outright
   (measured — canChangeMediaPath returns false for every one), and this never asks it.

   Only ever touches the COPY inside the package; the project you are working in is
   never opened or modified. A .bak is written first and restored if the result
   doesn't verify, so a failed rewrite leaves a working project, not a broken one. */
async function relinkPackagedProject(fixFile) {
  try {
    const fs = require("fs"), zlib = require("zlib"), path = require("path");
    if (!fs.existsSync(fixFile)) return "";
    // tolerate CR, LF or CRLF - ExtendScript's File writes Mac line endings by default
    const lines = fs.readFileSync(fixFile, "utf8").split(/\r\n|\r|\n/).filter(Boolean);
    try { fs.unlinkSync(fixFile); } catch (e) {}
    const proj = lines.shift();
    const pairs = lines.map((l) => l.split("\t")).filter((p) => p.length === 2);
    if (!proj || !pairs.length || !fs.existsSync(proj)) return "";

    const raw = fs.readFileSync(proj);
    let xml, gz = false;
    try { xml = zlib.gunzipSync(raw).toString("utf8"); gz = true; }
    catch (e) { xml = raw.toString("utf8"); }        // Premiere can save uncompressed

    const bak = proj + ".bak";
    fs.writeFileSync(bak, raw);

    // A path can appear plain, percent-encoded, or XML-escaped depending on the
    // element it sits in, and the API may hand it to us in any of those forms.
    // Generate every spelling of BOTH sides and swap like for like.
    const forms = (p) => {
      const out = [];
      const dec = (() => { try { return decodeURI(p); } catch (e) { return p; } })();
      const enc = (() => { try { return encodeURI(dec); } catch (e) { return dec; } })();
      const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      for (const v of [p, dec, enc, esc(dec)]) if (v && out.indexOf(v) === -1) out.push(v);
      return out;
    };
    let hits = 0;
    for (const [oldP, newP] of pairs) {
      const from = forms(oldP), to = forms(newP);
      for (let i = 0; i < from.length; i++) {
        const b = to[i] !== undefined ? to[i] : to[0];
        const parts = xml.split(from[i]);
        if (parts.length > 1) { hits += parts.length - 1; xml = parts.join(b); }
      }
    }
    if (!hits) {
      try { fs.unlinkSync(bak); } catch (e) {}
      // Nothing matched, which should be impossible - leave the evidence next to
      // the package rather than a silent no-op.
      try {
        const diag = [
          "Relink found 0 matches. What the project asked for vs what is in the .prproj:",
          "", "PAIRS (first 5):",
          ...pairs.slice(0, 5).map(([a, b]) => "  FROM " + a + "\n    TO " + b),
          "", "SAMPLE PATHS FOUND INSIDE THE PROJECT FILE (first 5):",
          ...(xml.match(/<(?:FilePath|ActualMediaFilePath)>[^<]*<\/(?:FilePath|ActualMediaFilePath)>/g) || [])
              .slice(0, 5).map((m) => "  " + m),
        ].join("\n");
        fs.writeFileSync(path.join(path.dirname(proj), "_relink_diagnostic.txt"), diag, "utf8");
      } catch (e) {}
      return " Could not relink the copy — nothing matched. See _relink_diagnostic.txt in the package.";
    }

    fs.writeFileSync(proj, gz ? zlib.gzipSync(Buffer.from(xml, "utf8")) : Buffer.from(xml, "utf8"));

    // VERIFY by reading it back the way Premiere would: it must still decompress,
    // and none of the old paths may survive. Anything less and we put the .bak back.
    let check;
    try {
      const re = fs.readFileSync(proj);
      check = gz ? zlib.gunzipSync(re).toString("utf8") : re.toString("utf8");
    } catch (e) { check = null; }
    // Reuse forms() — an earlier cut called a helper (enc) that the rewrite had
    // already replaced, so verification threw AFTER the file was written: the
    // relink had actually worked and the tool reported an error.
    const stale = check
      ? pairs.filter(([oldP]) => forms(oldP).some((v) => check.indexOf(v) !== -1)).length
      : 1;
    if (!check || stale) {
      fs.copyFileSync(bak, proj);
      try { fs.unlinkSync(bak); } catch (e) {}
      return " Relinking was reverted (the rewritten project didn't verify) — the package still points at the originals.";
    }
    try { fs.unlinkSync(bak); } catch (e) {}
    return ` Relinked ${pairs.length} file(s) inside the package (${hits} reference(s) rewritten) — it opens self-contained.`;
  } catch (e) {
    return " Couldn't relink the packaged project: " + e.message + ".";
  }
}

const TOOLS = {
  reel: {
    title: "Square → Reel",
    explain: "<ul><li>Turns a <strong>square 1:1</strong> sequence into a <strong>9:16 reel</strong>.</li>"
      + "<li>Your clip stays centred; a blurred copy fills top and bottom — no black bars.</li>"
      + "<li>Works on a <strong>duplicate</strong> — your square original is untouched.</li></ul>",
    info: "ochaReelInfo()",
    action: "ochaSquareToReel()",
    cta: () => "Create reel",
    working: "Building the reel…",
    // The host returns a clean headline plus a diagnostic trail. Show the
    // headline; only surface the trail when something in it actually went wrong,
    // so a normal run reads like a sentence and a bad one is still debuggable.
    done: (r) => {
      const s = String(r).replace(/^OK\|/, "");
      const hit = s.match(/Reel '([^']+)' (\d+x\d+)/);
      let msg = hit
        ? `Reel <strong>${esc(hit[1])}</strong> created at ${esc(hit[2])} — your square sequence is untouched.`
        : esc(s);
      if (/captions=not-scriptable/.test(s)) {
        msg += " <em>Premiere wouldn't let the script remove the copied caption track — if you see the subtitles twice, delete the caption track on the reel (the nested square already carries them).</em>";
      }
      if (/ERR|FAILED|missing/.test(s)) msg += ` <em>${esc(s)}</em>`;
      return msg;
    },
  },
  package: {
    title: "Package project",
    explain: "<ul><li>Copies <strong>every file this project uses</strong> — footage, images, graphics, audio — into one folder, sorted by type.</li>"
      + "<li>Saves a <strong>relinked copy</strong> of the project, and bundles the OCHA branding templates.</li>"
      + "<li>Your original project and files stay put.</li></ul>"
      + "<p class=\"modal-hint\">Your open project is never touched — Premiere stays exactly where it is.</p>",
    info: "ochaPackageInfo()",
    action: async () => {
      const res = await jsx("ochaPackageProject()") || "";
      const m = res.match(/\|fix=(.+)$/);
      if (!m) return res;
      return res.replace(/\|fix=.+$/, "") + await relinkPackagedProject(m[1].trim());
    },
    cta: (n) => (n > 0 ? `Package ${n} file${n === 1 ? "" : "s"}` : "Nothing to package"),
    countGated: true,
    once: true,                                       // done once → show the result, not the CTA again
    working: "Choose a folder, then copying media + saving a relinked copy…",
  },
  gradient: {
    title: "Readability gradient",
    explain: "<ul><li>A soft <strong>black gradient</strong> on its own track, so white text stays legible over busy footage.</li>"
      + "<li>Goes in as a <strong>separate clip</strong> — put it on a track <strong>below</strong> your text or captions.</li>"
      + "<li>For <strong>OCHA Clean</strong> captions, keep <strong>Bottom</strong>.</li>"
      + "<li><strong>Middle</strong> = a soft band across the centre (feather – dark – feather) for captions or text that sit mid-frame.</li>"
      + "<li>Middle can also cover just the <strong>left or right half</strong> — a soft cloud on that side, for text that doesn't run across the frame.</li></ul>",
    settings: "all",                                  // position + fade
    places: true,                                     // puts a CLIP on a track -> offer Track
    needsFmt: true,
    ready: "Ready — goes in at the playhead, on its own track.",
    done: (r) => `Gradient added on <strong>${trackOf(r)}</strong>. Move it below your text and trim to length.`,
    cta: () => "Add gradient",
    working: "Adding the gradient…",
    action: () => addGradient(gradPos(), gradOpacity()),
  },
  capstyles: {
    title: "Install the OCHA caption styles",
    explain: "<ul><li>Adds <strong>OCHA Boxed</strong> and <strong>OCHA Clean</strong> to Premiere's <strong>Style browser</strong> (under Local).</li>"
      + "<li>Once per computer — they stay for every project.</li>"
      + "<li>Run again anytime to refresh with brand updates.</li></ul>"
      + "<p class=\"modal-hint\">Captioning steps are on the Captions tab.</p>",
    info: "ochaCaptionStylesInstalled()",
    infoLine: (n) => n >= 2 ? "Already installed. Run again to refresh."
      : (n === 1 ? "Partly installed — run to complete." : "Not installed yet."),
    cta: (n) => n >= 2 ? "Reinstall" : "Install the styles",
    working: "Installing the OCHA caption styles…",
    done: (r) => `Installed <strong>${(r.match(/installed=([^|]*)/) || [])[1] || "the styles"}</strong>. `
      + `Pick one via the <strong>Style browser</strong> (Properties &gt; Track style) when you make captions.`,
    action: () => jsx(`ochaInstallCaptionStyles(${lit(EXT_ROOT)})`).then((r) => r || ""),
  },
  capguides: {
    title: "Caption position guides",
    explain: "<ul><li>Four <strong>OCHA Captions</strong> guide templates — one per format — two lines marking the band where the caption box belongs. <strong>The panel installs them automatically</strong>; this tile is for reinstalling and the how-to.</li>"
      + "<li>Use: <strong>View &gt; Guide Templates</strong> &gt; pick your format, then move the captions (<strong>Properties &gt; Align &amp; transform</strong>) until the box sits between the lines.</li>"
      + "<li>Guides are visual only — they <strong>never export</strong>. Hide them with View &gt; Show Guides.</li></ul>"
      + "<p class=\"modal-hint\">Templates load when Premiere starts — installed just now? Restart Premiere once to see them.</p>",
    info: "ochaCaptionGuidesInstalled()",
    infoLine: (n) => n >= 4 ? "Installed. Run again to refresh."
      : (n > 0 ? "Partly installed — run to complete." : "Not installed yet — run to install."),
    cta: (n) => n >= 4 ? "Reinstall" : "Install the guides",
    working: "Installing the guide templates…",
    done: () => "Installed <strong>4 guide templates</strong>. They show under <strong>View &gt; Guide Templates</strong> after the next Premiere restart.",
    action: () => jsx("ochaInstallCaptionGuides()"),
  },
  webapp: {
    title: "Compress a video",
    explain: "<ul><li>This one lives <strong>outside Premiere</strong> — it opens the free <strong>OCHA QuickVid web app</strong> in your browser.</li>"
      + "<li>Drop a heavy file, pick a quality, get a light <strong>MP4 (H.264)</strong> that plays everywhere.</li>"
      + "<li>The web app also <strong>cuts statement clips by transcript</strong>, burns captions and brands video — no Premiere needed. Files never leave your computer.</li></ul>"
      + "<p class=\"modal-hint\">un-ocha.github.io/quickvid_BDU</p>",
    ready: "Opens in your browser — the Toolbox tab has the compressor.",
    cta: () => "Open OCHA QuickVid",
    working: "Opening your browser…",
    done: () => "Opened. Look for the <strong>Toolbox</strong> tab.",
    action: () => { openExternal(WEBAPP_URL); return Promise.resolve("OK|"); },
  },
  fixcolor: {
    title: "Fix washed-out colour",
    // Deliberately visual: the two swatches ARE the explanation. Someone hitting
    // this has just seen flat, milky footage and needs to recognise it, not read
    // a definition of a transfer function.
    explain: "<ul><li>Your sequence is using an <strong>HDR / wide-gamut</strong> colour space. Premiere shows those colours <strong>flat and milky</strong> on a normal screen — and exports them that way too.</li>"
      + "<li>This sets the sequence back to <strong>standard SDR Rec. 709</strong>, what social platforms and UN Web TV expect.</li></ul>"
      + "<div class=\"cs-swatches\">"
      + "<span class=\"cs-swatch\"><i style=\"background:linear-gradient(90deg,#6f7d86,#9fb0ba,#cbd6dc)\"></i>Now — washed out</span>"
      + "<span class=\"cs-swatch\"><i style=\"background:linear-gradient(90deg,#123a55,#0077b8,#c5dfef)\"></i>After — Rec. 709</span>"
      + "</div>"
      + "<p class=\"modal-hint\">Only this sequence's settings change. Your footage, clips and edit are untouched, and it's undoable with Cmd/Ctrl+Z.</p>",
    info: "ochaColorStatus()",
    action: "ochaFixColor()",
    cta: (n) => (n > 0 ? "Set to Rec. 709" : "Nothing to fix"),
    countGated: true,
    once: true, doneCta: "Set to Rec. 709",
    working: "Setting the sequence to Rec. 709…",
    done: (r) => {
      const p = String(r).split("|");
      const drift = (String(r).match(/drift=(.*)$/) || [])[1];
      let msg = p[1] === "already"
        ? "Already standard Rec. 709 — nothing was changed."
        : `Done — ${esc(p[2] || "set to Rec. 709")}. Scrub the timeline: the washed-out look should be gone.`;
      // A blind whole-object setSettings write is what we suspect wrecked a
      // project's colour once, so the host audits it. Never swallow that.
      if (drift) msg += ` <em>Note — other settings also moved: ${esc(drift)}</em>`;
      return msg;
    },
  },
  vignette: {
    title: "Vignette",
    explain: "<ul><li>Darkens the <strong>edges and corners</strong> of the frame so the eye goes to the centre — useful over bright or busy footage.</li>"
      + "<li>Built at your sequence's size, so it looks the same on 9:16, 1:1 and 16:9.</li>"
      + "<li>Goes in as a <strong>separate clip on the top track</strong> — trim it to the length you want.</li></ul>"
      + "<p class=\"modal-hint\">Select the clip afterwards to fine-tune Amount and Size in the panel.</p>",
    settings: "fade",                                 // strength only - no position
    places: true,                                     // puts a CLIP on a track -> offer Track
    fadeLabel: "Strength",
    fadeDefault: 55,
    needsFmt: true,
    ready: "Ready — goes in at the playhead, on its own track.",
    cta: () => "Add vignette",
    working: "Adding the vignette…",
    done: (r) => `Vignette added on <strong>${trackOf(r)}</strong>. Trim it to cover the shots you want.`,
    action: () => addVignette(gradOpacity()),
  },
  unused: {
    title: "Remove unused",
    explain: "<ul><li>Lists everything in the project that is <strong>on no timeline</strong> — leftovers from versions and trials.</li>"
      + "<li>Everything is ticked; <strong>untick anything you want to keep</strong>, then remove.</li>"
      + "<li>Sequences and bins are never listed.</li>"
      + "<li>Leftover <strong>OCHA template files</strong> are deleted from the project's templates folder too — nothing else on disk is ever touched.</li></ul>"
      + "<p class=\"modal-hint\">This replaces the old <em>Clean MOGRTs</em> tool: same job, but for everything, and you choose what goes.</p>",
    info: "ochaUnusedList()",
    list: true,
    danger: true,
    cta: (n) => (n > 0 ? `Remove ${n} item${n === 1 ? "" : "s"}` : "Nothing selected"),
    working: "Removing…",
    once: true, doneCta: "Removed",
    action: () => jsx(`ochaUnusedDelete(${lit(listTicked().join(","))})`),
    done: (r) => String(r).split("|")[2] || "Done.",
  },
  tidy: {
    title: "Tidy the project panel",
    explain: "<ul><li>Sorts <strong>everything</strong> into <strong>01 Footage / 02 Images / 03 Graphics / 04 Audio / 05 Other</strong>, plus <strong>06 Missing</strong> for offline items.</li>"
      + "<li><strong>Existing folders are emptied into those</strong> and removed — one layout, however the project was organised before.</li>"
      + "<li><strong>Sequences never move</strong>, and a folder still holding one is kept.</li>"
      + "<li>No file on disk is touched — this only moves items inside the Project panel.</li></ul>"
      + "<p class=\"modal-hint\">Same grouping as Package project, so a tidied project and a packaged one match. Undo with Cmd/Ctrl+Z.</p>",
    ready: "Ready — sorts whatever is loose at the top level.",
    cta: () => "Tidy the project",
    once: true, doneCta: "Tidied",
    working: "Sorting into bins…",
    done: (r) => String(r).split("|")[2] || "Done.",
    action: "ochaTidyProject()",
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
  $("modal-list").hidden = !cfg.list;              // tick-list tools fill this in loadInfo
  $("modal-settings").hidden = !cfg.settings;
  $("grad-pos").hidden = cfg.settings !== "all";
  // Track: only for tools that place a clip, and reset to Automatic on every
  // open so a choice made for one gradient cannot silently ride into the next.
  if ($("modal-track-row")) $("modal-track-row").hidden = !cfg.places;
  if ($("modal-track-hint")) $("modal-track-hint").hidden = !cfg.places;
  if (cfg.places && $("modal-track")) $("modal-track").value = "";
  // The fade slider is shared, so each tool names it and sets its own default -
  // "Fade" for the gradient, "Strength" for the vignette.
  if (cfg.settings) {
    $("grad-op-lab").textContent = cfg.fadeLabel || "Fade";
    const d = cfg.fadeDefault == null ? 80 : cfg.fadeDefault;
    $("grad-op").value = d; $("grad-op-n").value = d;
  }
  // Reset the position to Bottom on every open. It's the common case (text and
  // captions both sit low), and a choice left over from last time is a quiet way
  // to end up with the scrim on the wrong edge.
  document.querySelectorAll("#grad-pos .seg__opt").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.pos === "bottom"));
  document.querySelectorAll("#grad-mid-w .seg__opt").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.half === "full"));
  setMidUI();
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
  if (cfg.list) {
    const names = (parts[2] || "").split(String.fromCharCode(31)).filter(Boolean);
    modalInfo(ok ? (names.length ? `${names.length} item(s) are in the project but on no timeline.`
                                 : "Nothing unused — every item is used in a sequence.")
                 : (res.replace(/^ERR\|/, "") || "Couldn't scan the project."), !ok);
    $("modal-list").hidden = !names.length;
    fillList(names);
    if (!names.length) { run.disabled = true; run.textContent = cfg.cta(0); }
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
    // One-shot tools: grey the CTA rather than hide it, so it's obvious the action
    // ran rather than the button having vanished. Reopening the tool resets it.
    // Only show a greyed CTA when the tool gives it its own past-tense label.
    // Without one it read "Done" right next to the Cancel button, which also
    // becomes "Done" on success - two identical buttons.
    if (cfg.doneCta) { run.disabled = true; run.textContent = cfg.doneCta; }
    else { run.hidden = true; }
  } else if (ok) {
    refresh(); loadInfo();             // refresh format chip + re-read counts
  } else {
    run.disabled = false;
  }
}
/* Tick-list: every row starts TICKED — the tool's whole point is "remove these",
   and the user unticks what they want to keep. */
function fillList(names) {
  const box = $("modal-list-items");
  box.innerHTML = names.map((n, i) =>
    `<label class="modal-list__row"><input type="checkbox" data-i="${i}" checked /><span>${esc(n)}</span></label>`).join("");
  box.querySelectorAll("input").forEach((c) => c.addEventListener("change", listCount));
  listCount();
}
function listTicked() {
  return [...$("modal-list-items").querySelectorAll("input:checked")].map((c) => c.dataset.i);
}
function listCount() {
  const n = listTicked().length, all = $("modal-list-items").querySelectorAll("input").length;
  $("modal-list-count").textContent = `${n} of ${all} selected`;
  const run = $("modal-run");
  if (curTool && TOOLS[curTool] && TOOLS[curTool].list) {
    run.disabled = n === 0;
    run.textContent = TOOLS[curTool].cta(n);
  }
}
$("modal-list-all").addEventListener("click", () => {
  $("modal-list-items").querySelectorAll("input").forEach((c) => { c.checked = true; }); listCount();
});
$("modal-list-none").addEventListener("click", () => {
  $("modal-list-items").querySelectorAll("input").forEach((c) => { c.checked = false; }); listCount();
});

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
$("tool-webapp").addEventListener("click", () => openTool("webapp"));
$("tool-fixcolor").addEventListener("click", () => openTool("fixcolor"));
$("tool-tidy").addEventListener("click", () => openTool("tidy"));
$("tool-vignette").addEventListener("click", () => openTool("vignette"));
$("tool-unused").addEventListener("click", () => openTool("unused"));
$("color-banner-fix").addEventListener("click", () => openTool("fixcolor"));
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
    if (url.indexOf("quickvid_BDU") !== -1) { try { Analytics.ping("webapp:open"); } catch (er) {} }
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
// Caption position guides: SILENT auto-install, once per panel version.
// Premiere only reads Installed Guides.guides at LAUNCH (measured — and live
// guide creation isn't scriptable at all, see docs/decisions.md 2026-07-23),
// so installing during THIS session makes the templates appear by the user's
// NEXT session with no manual step. Runs on every version bump so updated
// band values ship too (the host install is idempotent + backed up). The
// Captions tile stays for status, reinstall and the how-to. Failures stay
// silent here — the tile's own status line reports the real state.
const GUIDES_AUTO_KEY = "ocha-guides-installed";
loadHost().then(() => {
  try {
    if (!hostReady || localStorage.getItem(GUIDES_AUTO_KEY) === PANEL_VERSION) return;
    jsx("ochaInstallCaptionGuides()").then((res) => {
      if ((res || "").indexOf("OK|") === 0) {
        try { localStorage.setItem(GUIDES_AUTO_KEY, PANEL_VERSION); } catch (e1) {}
        try { Analytics.ping("capguides:auto"); } catch (e2) {}
      }
    });
  } catch (e) { /* never let auto-install break panel boot */ }
});
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
setInterval(syncAdjust, 900);   // bind the Position sliders to a selected OCHA clip (0.42)
setInterval(syncText, 900);     // bind the text fields to a selected OCHA clip
