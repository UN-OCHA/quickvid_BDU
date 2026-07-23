/* ============================================================================
   OCHA Branding - Premiere host script (ExtendScript, ES3: var only, no
   arrows / template literals / JSON built-ins).

   Why this runs on CEP: UXP cannot write MOGRT text controls; ExtendScript
   can - clip.getMGTComponent().properties[i].setValue(str, true). Verified
   live 2026-07-17 (docs/decisions.md + premiere/uxp-archive/README.md).

   Panel <-> host protocol (primitive strings only):
   - ochaGetFormat() -> "w|h|fmtKey|label"  or  "none"
   - ochaAdd(el, fmtKey, extRoot, kvBlob)
       -> "OK|track=V2|set=Name,Title|warn=..."  or  "ERR|<message>"
     kvBlob entries are joined by \u001E, key/value split by \u001F -
     control characters a user can't type, so any text is delimiter-safe.
   ============================================================================ */

var OCHA_EL_NAME = {
  lt: "OCHA Lower Third",
  loc: "OCHA Location",
  bug: "OCHA Bug",
  ending: "OCHA Ending",
  text: "OCHA Text",
  gradient: "OCHA Gradient"
};
// ONE matcher for "is this clip/item an OCHA template?", derived from OCHA_EL_NAME
// so a newly added element can never be half-recognised. This test was hand-written
// in FIVE places and every one of them still listed only the original four: Text and
// Gradient clips were invisible to the selected-clip binder (so Size/position never
// bound to them), uncounted by the MOGRT cleaner, and - worst - treated as ordinary
// FOOTAGE by the packager, which would have copied them into a package's media.
var OCHA_EL_RE = (function () {
  var parts = [];
  for (var k in OCHA_EL_NAME) {
    if (OCHA_EL_NAME.hasOwnProperty(k)) parts.push(OCHA_EL_NAME[k].replace(/^OCHA /, ""));
  }
  return new RegExp("^OCHA (" + parts.join("|") + ")");
})();

var OCHA_FMT = {
  reels:  { folder: "reels",  label: "Reels 9x16" },
  feed45: { folder: "feed45", label: "Feed 4x5" },
  square: { folder: "square", label: "Square 1x1" },
  event:  { folder: "event",  label: "Event 16x9" }
};
// value coercion per control (everything not listed is text)
var OCHA_BOOL = { "Centre align": 1, "Show pin icon": 1, "Over black": 1, "Top": 1, "Middle": 1, "Full screen": 1 };
var OCHA_NUM  = { "Pin colour": 1, "Size": 1, "Opacity": 1 };
// Renamed EGP controls: panel sends the CURRENT name; clips placed with an older
// template still carry the old one, so writers fall back through this map instead
// of warning "could not set" on every edit of an old clip.
var OCHA_FIELD_ALIAS = { "3rd line (optional)": "Title line 2 (optional)" };

function ochaFmtFromSize(w, h) {
  if (!w || !h) return null;
  var r = w / h;
  if (r <= 0.66) return "reels";
  if (r < 0.92)  return "feed45";
  if (r <= 1.12) return "square";
  return "event";
}

function ochaGetFormat() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "none";
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var k = ochaFmtFromSize(w, h);
    if (!k) return w + "|" + h + "||unsupported";
    return w + "|" + h + "|" + k + "|" + OCHA_FMT[k].label;
  } catch (e) { return "none"; }
}

/* The panel passes its extension root (it knows getSystemPath). MOGRTs:
   bundled copy first (future ZXP layout), else the repo-level canonical set
   one directory up (dev symlink layout). */
function ochaMogrtName(el, fmtKey) {
  return OCHA_EL_NAME[el] + " - " + OCHA_FMT[fmtKey].label + ".mogrt";
}
function ochaMogrtPath(extRoot, el, fmtKey) {
  var f = OCHA_FMT[fmtKey], name = ochaMogrtName(el, fmtKey);
  var candidates = [
    extRoot + "/mogrts/" + f.folder + "/" + name,
    extRoot + "/../mogrts/" + f.folder + "/" + name
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (File(candidates[i]).exists) return candidates[i];
  }
  return null;
}

var OCHA_ASSET_DIR = "OCHA Branding Elements - do not delete";

// Copy the source .mogrt into a folder beside the .prproj so the graphic's
// template travels with the project - surviving an extension uninstall or a
// moved repo. Falls back to the bundled source when the project is unsaved.
// Returns { path: <path to insert from>, note: <warn text or ""> }.
function ochaLocalMogrt(extRoot, el, fmtKey) {
  var src = ochaMogrtPath(extRoot, el, fmtKey);
  if (!src) return { path: null, note: "" };
  var projPath = "";
  try { projPath = app.project.path; } catch (e0) { projPath = ""; }
  if (!projPath) return { path: src, note: "project unsaved - save it, then re-add so the graphic is stored with the project" };
  try {
    var projFolder = new File(projPath).parent;
    var dir = new Folder(projFolder.fsName + "/" + OCHA_ASSET_DIR);
    if (!dir.exists) dir.create();
    var dest = new File(dir.fsName + "/" + ochaMogrtName(el, fmtKey));
    var srcF = new File(src);

    // REFRESH THE COPY WHEN THE BUNDLED TEMPLATE IS NEWER. This used to be a plain
    // "if (!dest.exists)", which meant a rebuilt template could NEVER reach a project
    // that had already used it once: Premiere kept importing the stale copy, the new
    // controls were missing, and the panel reported "Line 1 (not found)" while the
    // file on disk was perfectly correct. Cost an afternoon to find - the evidence
    // that cracked it was the copy being 2 minutes OLDER than the AE build.
    var refresh = !dest.exists;
    if (dest.exists) {
      try {
        refresh = !!(srcF.modified && dest.modified &&
                     srcF.modified.getTime() > dest.modified.getTime());
      } catch (eM) {
        refresh = true;                       // can't compare - prefer the bundled one
      }
      if (refresh && !dest.remove()) {
        return { path: src, note: "used the current template (couldn't replace the older copy in the project folder)" };
      }
    }
    if (refresh) {
      var ok = srcF.copy(dest.fsName);
      if (!ok || !dest.exists) return { path: src, note: "couldn't copy template into the project folder - used the bundled copy" };
    }
    return { path: dest.fsName, note: "" };
  } catch (e) {
    return { path: src, note: "local-copy error (" + e.toString() + ") - used the bundled copy" };
  }
}

function ochaFindParam(props, wantName) {
  for (var i = 0; i < props.numItems; i++) {
    var p = props[i];
    if (p && p.displayName === wantName) return p;
  }
  return null;
}

// find a component on the clip by matchName (Motion = "AE.ADBE Motion")
function ochaFindComp(clip, matchName) {
  var comps = clip.components;
  for (var i = 0; i < comps.numItems; i++) {
    if (comps[i] && comps[i].matchName === matchName) return comps[i];
  }
  return null;
}

// Apply Size (Motion Scale, %) + Position (offset in px from the graphic's
// current centre) to the clip's intrinsic Motion. Full range, no MOGRT rebuild,
// same transform an editor nudges by hand. Returns a self-report string so the
// first live test reveals the coordinate space (pixels vs normalized).
// The panel's Size slider must drive the TEMPLATE's own "Size" control, not Premiere's
// Motion > Scale. Every OCHA template (except the gradient, which is full-frame) builds
// Size with sizeGroup() so it scales about the ELEMENT's anchor - its own left edge and
// baseline. Motion > Scale scales about the CLIP's anchor, which is the comp centre, so
// a left-aligned lower third or text drifted sideways as it was resized. Falls back to
// Motion when a template has no Size control.
function ochaSetSize(clip, pct) {
  var mgt = null;
  try { mgt = clip.getMGTComponent(); } catch (e) { mgt = null; }
  if (mgt) {
    var sp = ochaFindParam(mgt.properties, "Size");
    if (sp) {
      try { sp.setValue(parseFloat(pct), true); return "size"; } catch (e1) {}
    }
  }
  return null;                                  // caller falls back to Motion > Scale
}

function ochaGetSize(clip) {
  var mgt = null;
  try { mgt = clip.getMGTComponent(); } catch (e) { return null; }
  if (!mgt) return null;
  var sp = ochaFindParam(mgt.properties, "Size");
  if (!sp) return null;
  try { var v = sp.getValue(); return (typeof v === "number") ? v : null; } catch (e2) { return null; }
}

function ochaApplyMotion(seq, clip, m) {
  if (m.scale == null && m.posX == null && m.posY == null) return "";
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return "motion=Motion component not found";
  var parts = [];
  if (m.scale != null) {
    if (ochaSetSize(clip, m.scale)) {
      parts.push("size=" + m.scale);            // template's own anchor
    } else {
      var sp = ochaFindParam(mo.properties, "Scale");
      if (!sp) parts.push("no Scale prop");
      else { try { sp.setValue(m.scale, true); parts.push("scale=" + m.scale); }
             catch (e1) { parts.push("scale ERR " + e1.toString()); } }
    }
  }
  if (m.posX != null || m.posY != null) {
    // 0.42: prefer the template's own Position X/Y controls (element-edge px,
    // clamped element-exact inside the template); Motion is the old-clip
    // fallback — its param is NORMALIZED fractions (see ochaReadMotion).
    var tp = ochaPosParams(clip);
    if (tp) {
      // px -> PERCENT of frame (the sliders' 0-100 range; see ochaReadMotion)
      var wT = seq.frameSizeHorizontal, hT = seq.frameSizeVertical;
      try {
        if (m.posX != null) tp.x.setValue(m.posX / wT * 100, true);
        if (m.posY != null) tp.y.setValue(m.posY / hT * 100, true);
        parts.push("tpos=[" + m.posX + "," + m.posY + "]");
      } catch (eT) { parts.push("tpos ERR " + eT.toString()); }
    } else {
      var pp = ochaFindParam(mo.properties, "Position");
      if (!pp) parts.push("no Position prop");
      else {
        var w2 = seq.frameSizeHorizontal, h2 = seq.frameSizeVertical;
        var cur = null;
        try { cur = pp.getValue(); } catch (e2) { cur = null; }
        var nx = (m.posX != null) ? m.posX : (cur && cur.length >= 2 ? cur[0] * w2 : w2 / 2);
        var ny = (m.posY != null) ? m.posY : (cur && cur.length >= 2 ? cur[1] * h2 : h2 / 2);
        if (isNaN(nx)) nx = w2 / 2;
        if (isNaN(ny)) ny = h2 / 2;
        nx = Math.max(0, Math.min(w2, nx));
        ny = Math.max(0, Math.min(h2, ny));
        try { pp.setValue([nx / w2, ny / h2], true);
              parts.push("pos=[" + Math.round(nx) + "," + Math.round(ny) + "]"); }
        catch (e3) { parts.push("pos ERR " + e3.toString()); }
      }
    }
  }
  return "motion=" + parts.join(" / ");
}

// ---------------- edit a SELECTED clip's text from the panel ----------------
// The panel already binds Size/position to the selected clip; these do the same for
// the text controls, so selecting a lower third or a text clip loads what is
// actually on the timeline instead of whatever was last typed.

// Which element is this clip? Derived from the clip name via OCHA_EL_NAME, so it
// stays correct as elements are added.
function ochaElOfClip(nm) {
  for (var k in OCHA_EL_NAME) {
    if (!OCHA_EL_NAME.hasOwnProperty(k)) continue;
    if (nm.indexOf(OCHA_EL_NAME[k] + " ") === 0 || nm === OCHA_EL_NAME[k]) return k;
  }
  return "";
}

// Text values come back in TWO shapes. Set by script (us), getValue() returns the
// plain string. Edited in Premiere's Properties panel, the SAME property returns a
// JSON blob of the text run - {"capPropFontEdit":false,...,"textEditValue":"..."} -
// which, passed through raw, is exactly what landed in the panel's fields. Unwrap
// textEditValue (string or single-run array form); anything unrecognised passes
// through untouched. No JSON.parse in ExtendScript (ES3), hence regex + unescape.
function ochaUnwrapText(v) {
  if (!v || v.charAt(0) !== "{" || v.indexOf("textEditValue") < 0) return v;
  var m = v.match(/"textEditValue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) m = v.match(/"textEditValue"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return v;
  return m[1].replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, function (all, u, c) {
    if (u) return String.fromCharCode(parseInt(u, 16));
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    return c;                                  // \" \\ \/ and friends
  });
}

// Cheap "what is selected?" probe - name and element only. The panel polls this
// often; reading every text property that frequently means a getMGTComponent() plus
// a getValue() per control several times a second, which is exactly the load that
// was in flight when Premiere crashed during editing. Full values are fetched only
// when the selection changes, or on a slow tick.
function ochaSelectedName() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "none";
    var nm = ""; try { nm = clip.name; } catch (e) { return "none"; }
    var el = ochaElOfClip(nm);
    return el ? (nm + "|" + el) : "none";
  } catch (e) { return "none"; }
}

// "<clipName>|<el>|Name<US>value<RS>Title<US>value..." or "none".
// Only text-ish controls are returned; the panel matches them to its own fields.
function ochaReadText() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "none";
    var nm = ""; try { nm = clip.name; } catch (e) {}
    var el = ochaElOfClip(nm);
    if (!el) return "none";
    var mgt = null; try { mgt = clip.getMGTComponent(); } catch (e1) { mgt = null; }
    if (!mgt) return "none";
    var out = [];
    for (var i = 0; i < mgt.properties.numItems; i++) {
      var pr = mgt.properties[i], dn = "";
      try { dn = pr.displayName; } catch (e2) { continue; }
      if (!dn || OCHA_BOOL[dn] || OCHA_NUM[dn] || dn === "Size") continue;
      var v = "";
      try { v = pr.getValue(); } catch (e3) { continue; }
      if (typeof v !== "string") continue;
      out.push(dn + "\u001F" + ochaUnwrapText(v));
    }
    return nm + "|" + el + "|" + out.join("\u001E");
  } catch (e) { return "none"; }
}

// TEXT IS WRITTEN AS A PLAIN STRING. NOTHING CLEVER HERE ON PURPOSE.
//
// 0.32.0 tried writing Premiere's JSON text-run blob instead, to coax the Properties
// panel into displaying script-set values. It was never confirmed to work, and it
// turned one setValue into read + patch + write + read-back + possible second write,
// on every field, on every edit. Premiere then began crashing while editing a bound
// clip. Reverted: an unproven cosmetic fix is not worth a crash, and the panel
// already tells the user the Properties panel lags.
//
// Reading still UNWRAPS the blob (ochaUnwrapText), because Premiere itself writes
// that shape when text is edited in its own panel - that part is real and needed.

// Write text values back to the SELECTED clip. Same kv blob shape as ochaAdd, so
// the panel builds it with the one collectValues() it already has.
function ochaWriteText(kvBlob) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|Select an OCHA clip first.";
    var mgt = null; try { mgt = clip.getMGTComponent(); } catch (e1) { mgt = null; }
    if (!mgt) return "ERR|Controls not reachable on that clip.";
    var entries = kvBlob ? kvBlob.split("\u001E") : [];
    var set = [], fail = [];
    for (var n = 0; n < entries.length; n++) {
      if (!entries[n]) continue;
      var kv = entries[n].split("\u001F"), key = kv[0], raw = kv[1];
      if (key.charAt(0) === "@") continue;              // Motion is handled elsewhere
      var pr = ochaFindParam(mgt.properties, key);
      if (!pr && OCHA_FIELD_ALIAS[key]) pr = ochaFindParam(mgt.properties, OCHA_FIELD_ALIAS[key]);
      if (!pr) { fail.push(key); continue; }
      try {
        if (OCHA_BOOL[key]) pr.setValue(raw === "true", true);
        else if (OCHA_NUM[key]) pr.setValue(parseFloat(raw), true);
        else pr.setValue(raw, true);            // plain string - see the note above
        set.push(key);
      } catch (e2) { fail.push(key); }
    }
    var out = "OK|set=" + set.join(",");
    if (fail.length) out += "|warn=could not set: " + fail.join("; ");
    return out;
  } catch (e) { return "ERR|" + e.toString(); }
}

// setValue() changes what RENDERS immediately, but Premiere's Properties / Essential
// Graphics panel keeps showing the values it read when the clip was selected - so the
// program monitor is right while the panel still shows the template defaults. There is
// no "reload this clip's parameters" call; deselecting and reselecting is what makes
// the panel re-read. Called once the user stops typing, never on every keystroke, or
// the selection would flicker while they work.
// NO PANEL-REFRESH HELPER HERE, DELIBERATELY. Parameters set from script show up in
// Effect Controls > Graphic Parameters and in the render, but Premiere's newer
// Properties panel keeps showing the values it read when the clip was selected.
// Tried and rejected: setValue(v, true) alone; setSelected(false)+setSelected(true) in
// one run; the same split across two calls with a gap (the selection visibly blinks,
// the panel still shows defaults). It is a Premiere limitation, so the panel says so
// rather than blinking the user's selection for nothing.

// Which video track did the just-inserted clip actually land on? importMGT's
// "one past the top" try often clamps to the existing top track instead of creating
// a new one, so the index we PASSED can be one higher than reality (the V4-vs-V3
// report). Match by start tick + element name and return the real 0-based track.
function ochaInsertedTrack(seq, elName, timeTicks, fallback) {
  for (var t = seq.videoTracks.numTracks - 1; t >= 0; t--) {
    var clips = seq.videoTracks[t].clips;
    for (var c = 0; c < clips.numItems; c++) {
      try {
        var ci = clips[c];
        if (ci && ci.start && String(ci.start.ticks) === String(timeTicks) &&
            ci.name && ci.name.indexOf(elName) === 0) return t;
      } catch (e) {}
    }
  }
  return fallback;
}

function ochaAdd(el, fmtKey, extRoot, kvBlob) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open a sequence first.";
    var loc = ochaLocalMogrt(extRoot, el, fmtKey);
    if (!loc.path) return "ERR|MOGRT not found for " + OCHA_EL_NAME[el] + " / " + fmtKey;
    var path = loc.path;

    var timeTicks = seq.getPlayerPosition().ticks;
    var vCount = seq.videoTracks.numTracks;
    var aCount = seq.audioTracks.numTracks;
    var aIdx = (el === "ending") ? Math.max(0, aCount - 1) : 0;

    // track ladder: one-past-top (in case the API auto-creates), then top, then 0
    var tries = [vCount, vCount - 1, 0], seen = {}, clip = null, usedV = -1, errs = [];
    for (var t = 0; t < tries.length; t++) {
      var v = tries[t];
      if (v < 0 || seen["i" + v]) continue;
      seen["i" + v] = 1;
      try {
        var item = seq.importMGT(path, timeTicks, v, aIdx);
        if (item) { clip = item; usedV = v; break; }
        errs.push("V" + (v + 1) + ": nothing returned");
      } catch (e1) { errs.push("V" + (v + 1) + ": " + e1.toString()); }
    }
    if (!clip) return "ERR|Insert failed - " + errs.join(" / ");

    // Graphic Parameters can attach a beat after insert - poll briefly
    var mgt = null, waited = 0;
    for (var k = 0; k < 12 && !mgt; k++) {
      try { mgt = clip.getMGTComponent(); } catch (e2) { mgt = null; }
      if (!mgt) { $.sleep(250); waited += 250; }
    }

    var setNames = [], failNames = [];
    var motion = { scale: null, posX: null, posY: null };   // at-keys route to Motion
    var entries = kvBlob ? kvBlob.split("\u001E") : [];
    for (var n = 0; n < entries.length; n++) {
      if (!entries[n]) continue;
      var kv = entries[n].split("\u001F");
      var key = kv[0], raw = kv[1];
      if (key === "@scale") { motion.scale = parseFloat(raw); continue; }
      if (key === "@posX")  { motion.posX  = parseFloat(raw); continue; }
      if (key === "@posY")  { motion.posY  = parseFloat(raw); continue; }
      if (!mgt) { failNames.push(key + " (controls not reachable)"); continue; }
      var p = ochaFindParam(mgt.properties, key);
      if (!p && OCHA_FIELD_ALIAS[key]) p = ochaFindParam(mgt.properties, OCHA_FIELD_ALIAS[key]);
      if (!p) { failNames.push(key + " (not found)"); continue; }
      var val = raw;
      if (OCHA_BOOL[key]) val = (raw === "true");
      else if (OCHA_NUM[key]) val = parseFloat(raw);
      try { p.setValue(val, true); setNames.push(key); }
      catch (e3) { failNames.push(key + " (" + e3.toString() + ")"); }
    }

    var motionMsg = ochaApplyMotion(seq, clip, motion);

    // leave the clip selected so a manual tweak is one click away
    try { clip.setSelected(true, true); } catch (e4) {}

    var realV = ochaInsertedTrack(seq, OCHA_EL_NAME[el], timeTicks, usedV);
    var out = "OK|track=V" + (realV + 1) + "|set=" + setNames.join(",");
    var warns = [];
    if (loc.note) warns.push(loc.note);
    if (!mgt) warns.push("controls not reachable after " + waited + "ms");
    if (failNames.length) warns.push("could not set: " + failNames.join("; "));
    if (warns.length) out += "|warn=" + warns.join(" * ");
    if (motionMsg) out += "|" + motionMsg;
    return out;
  } catch (e) {
    return "ERR|" + e.toString();
  }
}

/* ---------------- captions: install OCHA styles ----------------
   Premiere caption Track Styles are portable .prtextstyle files read from
   ~/Documents/Adobe/Common/Assets/Text Styles. The plugin bundles the two
   OCHA styles (Boxed = social, Clean = events) and copies them there, so
   they appear in the native Style dropdown. Overwrites on purpose: colleagues
   pick up brand updates with the plugin. */
var OCHA_CAPTION_STYLES = ["OCHA Boxed.prtextstyle", "OCHA Clean.prtextstyle"];

// Are the OCHA caption styles already in Premiere's Text Styles folder? Used by the
// modal to show "already installed" instead of an empty status area.
// "OK|<count>" - count of the two styles present (0, 1 or 2).
function ochaCaptionStylesInstalled() {
  try {
    var destDir = new Folder(Folder.myDocuments.fsName + "/Adobe/Common/Assets/Text Styles");
    var n = 0;
    for (var i = 0; i < OCHA_CAPTION_STYLES.length; i++) {
      if (new File(destDir.fsName + "/" + OCHA_CAPTION_STYLES[i]).exists) n++;
    }
    return "OK|" + n;
  } catch (e) { return "OK|0"; }
}

// Clear the timeline selection so the panel unbinds from an OCHA clip (the "+ New"
// button). Deselecting is what the poll reads, so this is what lets a user add a
// fresh element while one is selected.
function ochaClearSelection() {
  try {
    var seq = app.project.activeSequence;
    if (seq && typeof seq.setSelection === "function") { seq.setSelection([]); return "OK|"; }
    // fallback: walk the selection and deselect each
    if (seq) {
      var sel = seq.getSelection();
      for (var i = 0; sel && i < sel.length; i++) { try { sel[i].setSelected(false, true); } catch (e) {} }
    }
    return "OK|";
  } catch (e) { return "ERR|" + e.toString(); }
}

function ochaInstallCaptionStyles(extRoot) {
  try {
    var destDir = new Folder(Folder.myDocuments.fsName + "/Adobe/Common/Assets/Text Styles");
    if (!destDir.exists && !destDir.create()) return "ERR|Couldn't create " + destDir.fsName;
    var done = [], fail = [];
    for (var i = 0; i < OCHA_CAPTION_STYLES.length; i++) {
      var name = OCHA_CAPTION_STYLES[i];
      var src = new File(extRoot + "/caption-styles/" + name);
      if (!src.exists) { fail.push(name + " (missing in plugin)"); continue; }
      var dest = new File(destDir.fsName + "/" + name);
      if (dest.exists) dest.remove();
      if (src.copy(dest.fsName)) done.push(name.replace(".prtextstyle", ""));
      else fail.push(name + " (copy failed)");
    }
    var out = "OK|installed=" + done.join(", ");
    if (fail.length) out += "|warn=" + fail.join("; ");
    return out;
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------- Caption position guides ----------------
   Caption position is NOT scriptable (measured 26.3: a selected cue exposes
   zero components) and .prtextstyle carries no Align & Transform - so the
   plugin ships Program Monitor GUIDE TEMPLATES instead: two horizontal lines
   per format marking the band where the caption box belongs; the user drags
   the captions there once (Properties > Align & transform). Templates live in
   <Documents>/Adobe/Premiere Pro/<major>.0/Profile-<name>/Installed Guides.guides
   as plain JSON. Measured with a saved test guide (2026-07-23):
   orientationType 0 = HORIZONTAL, positionType 0 = PIXELS (floats accepted),
   colors are 0-1 floats, and Premiere writes the file on template save.
   Merge policy: parse, drop OCHA-named templates, append fresh, rewrite -
   the user's own templates are never touched, and an unparseable file is
   SKIPPED (with a one-time .ocha-backup made before our first rewrite). */
var OCHA_GUIDE_SETS = [
  // Positions by Javier (2026-07-23, original template + option-3 collision fix):
  // square/event = caption box band 832-974 on 1080-tall; portrait band sits
  // BETWEEN the Text block and the LT, reels 1190-1300; feed45 = same fractions
  // of height as reels (836.7 -> 837, 914.1 -> 914).
  { name: "OCHA Captions - Square 1x1", ys: [832, 974] },
  { name: "OCHA Captions - Event 16x9", ys: [832, 974] },
  { name: "OCHA Captions - Reels 9x16", ys: [1190, 1300] },
  { name: "OCHA Captions - Feed 4x5", ys: [837, 914] }
];

// tiny serializer for the known .guides shape (ES3 has no JSON built-ins;
// eval() is the matching parser). Quotes every key - Premiere's own keys
// contain colons ("color:red").
function ochaGuidesJson(o) {
  if (o === null || o === undefined) return "null";
  if (o instanceof Array) {
    var a = [];
    for (var i = 0; i < o.length; i++) a.push(ochaGuidesJson(o[i]));
    return "[" + a.join(",") + "]";
  }
  var t = typeof o;
  if (t === "number" || t === "boolean") return "" + o;
  if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  var kv = [];
  for (var k in o) if (o.hasOwnProperty(k)) kv.push('"' + k + '":' + ochaGuidesJson(o[k]));
  return "{" + kv.join(",") + "}";
}

function ochaGuideTemplate(set) {
  var guides = [];
  for (var i = 0; i < set.ys.length; i++) {
    guides.push({                          // OCHA cyan #009EDB, exact pixels
      "color:blue": 0.8588235294117647,
      "color:green": 0.6196078431372549,
      "color:red": 0,
      "orientationType": 0,                // 0 = horizontal (measured)
      "pinToOpposite": false,
      "position": set.ys[i],
      "positionType": 0                    // 0 = pixels (measured)
    });
  }
  return { guides: guides, name: set.name };
}

// every "Installed Guides.guides" of the RUNNING major version (one per
// Profile-* folder; writing to all of them covers renamed/synced profiles)
function ochaGuidesFiles() {
  var out = [];
  try {
    var major = ("" + app.version).split(".")[0];
    var base = new Folder(Folder.myDocuments.fsName + "/Adobe/Premiere Pro/" + major + ".0");
    if (!base.exists) return out;
    var kids = base.getFiles();
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] instanceof Folder && ("" + kids[i].displayName).indexOf("Profile") === 0) {
        out.push(kids[i].fsName + "/Installed Guides.guides");
      }
    }
  } catch (e) {}
  return out;
}

// "OK|<count>" - how many of the 4 OCHA templates the profile already has
// (string count, no eval on the read path).
function ochaCaptionGuidesInstalled() {
  try {
    var files = ochaGuidesFiles(), best = 0;
    for (var i = 0; i < files.length; i++) {
      var f = new File(files[i]);
      if (!f.exists) continue;
      f.encoding = "UTF-8";
      var txt = "";
      if (f.open("r")) { txt = f.read(); f.close(); }
      var m = txt.match(/OCHA Captions - /g);
      var n = m ? m.length : 0;
      if (n > best) best = n;
    }
    return "OK|" + best;
  } catch (e) { return "OK|0"; }
}

function ochaInstallCaptionGuides() {
  try {
    var files = ochaGuidesFiles();
    if (!files.length) return "ERR|Couldn't find Premiere's profile folder (Documents/Adobe/Premiere Pro/<version>/Profile-...).";
    var done = 0, warns = [];
    for (var i = 0; i < files.length; i++) {
      var f = new File(files[i]);
      var data = { guideTemplates: [], version: 1 };
      if (f.exists) {
        f.encoding = "UTF-8";
        var txt = "";
        if (f.open("r")) { txt = f.read(); f.close(); }
        var parsed = null;
        try { parsed = eval("(" + txt + ")"); } catch (ePar) { parsed = null; }
        if (!parsed || !(parsed.guideTemplates instanceof Array)) {
          warns.push("skipped " + f.displayName + " (couldn't read it safely)");
          continue;                        // never rewrite a file we can't parse
        }
        data = parsed;
        var bak = new File(f.fsName + ".ocha-backup");
        if (!bak.exists) { try { f.copy(bak.fsName); } catch (eBak) {} }
      }
      var keep = [];
      for (var t = 0; t < data.guideTemplates.length; t++) {
        var nm = "" + (data.guideTemplates[t] && data.guideTemplates[t].name);
        if (nm.indexOf("OCHA Captions") !== 0) keep.push(data.guideTemplates[t]);
      }
      for (var g = 0; g < OCHA_GUIDE_SETS.length; g++) keep.push(ochaGuideTemplate(OCHA_GUIDE_SETS[g]));
      data.guideTemplates = keep;
      f.encoding = "UTF-8";
      f.lineFeed = "Unix";
      if (f.open("w")) { f.write(ochaGuidesJson(data)); f.close(); done++; }
      else warns.push("couldn't write " + f.displayName);
    }
    var out = "OK|installed=" + OCHA_GUIDE_SETS.length + " guide templates|profiles=" + done;
    if (warns.length) out += "|warn=" + warns.join("; ");
    return done ? out : "ERR|" + (warns.join("; ") || "Nothing written.");
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------- Toolbox (v1: safe detection / readiness) ----------------
   Non-destructive. Each reports what it sees + writes detail to
   /tmp/ocha_toolbox.txt, so the real (constructive/destructive) actions are
   built on the actual project structure + API, not guesses. */
function ochaEachItem(item, cb) {
  try { cb(item); } catch (e) {}
  var kids = null;
  try { kids = item.children; } catch (e) {}
  if (kids && kids.numItems !== undefined) {
    for (var i = 0; i < kids.numItems; i++) { try { ochaEachItem(kids[i], cb); } catch (e) {} }
  }
}
function ochaWrite(path, text) {
  try { var f = new File(path); f.encoding = "UTF-8"; f.open("w"); f.write(text); f.close(); } catch (e) {}
}

function ochaKeys(o) { var k = []; for (var p in o) { try { k.push(p); } catch (e) {} } return k.join(","); }

function ochaResizeSeq(seq, newH) {
  var st; try { st = seq.getSettings(); } catch (e) { return "getSettings ERR " + e; }
  var field = null, cand = ["videoFrameHeight", "frameHeight", "height"], i;
  for (i = 0; i < cand.length; i++) { if (cand[i] in st) { field = cand[i]; break; } }
  if (!field) return "no height field (" + ochaKeys(st) + ")";
  try { st[field] = newH; seq.setSettings(st); return "resized"; } catch (e) { return "setSettings ERR " + e; }
}

function ochaClearSequence(seq) {
  var n = 0, t, c;
  try { for (t = 0; t < seq.videoTracks.numTracks; t++) { var vc = seq.videoTracks[t].clips; for (c = vc.numItems - 1; c >= 0; c--) { try { vc[c].remove(false, false); n++; } catch (e) {} } } } catch (e) {}
  try { for (t = 0; t < seq.audioTracks.numTracks; t++) { var ac = seq.audioTracks[t].clips; for (c = ac.numItems - 1; c >= 0; c--) { try { ac[c].remove(false, false); } catch (e) {} } } } catch (e) {}
  return n;
}

function ochaSetMotionScale(clip, pct) {
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return "noMotion";
  var sp = ochaFindParam(mo.properties, "Scale");
  if (!sp) return "noScale";
  try { sp.setValue(pct, true); return "scale=" + pct; } catch (e) { return "scaleERR " + e; }
}

function ochaBlurClip(clip, amount) {
  // 1) add the Gaussian Blur effect via QE (DOM has no add-effect)
  var added = "no-qe";
  try {
    app.enableQE();
    if (typeof qe !== "undefined" && qe) {
      var qs = qe.project.getActiveSequence();
      var vt = qs ? qs.getVideoTrackAt(0) : null;
      var qc = vt ? vt.getItemAt(0) : null;
      var fx = qe.project.getVideoEffectByName("Gaussian Blur");
      if (qc && fx) { qc.addVideoEffect(fx); added = "added"; } else added = "qc/fx missing";
    }
  } catch (e) { added = "qeERR " + e.toString(); }
  // 2) set Blurriness via the DOM component
  var setb = "no-comp";
  try {
    var comps = clip.components, bc = null, i;
    for (i = 0; i < comps.numItems; i++) { var mn = ""; try { mn = comps[i].matchName; } catch (e) {} var dn = ""; try { dn = comps[i].displayName; } catch (e) {} if (/gaussian/i.test(mn) || /gaussian/i.test(dn)) { bc = comps[i]; break; } }
    if (bc) { var bp = ochaFindParam(bc.properties, "Blurriness"); if (bp) { try { bp.setValue(amount, true); setb = "blur=" + amount; } catch (e) { setb = "blurSetERR " + e; } } else setb = "noBlurriness"; }
  } catch (e) { setb = "compERR " + e.toString(); }
  return added + "," + setb;
}

function ochaSquareToReel() {
  var L = [];
  try {
    var src = app.project.activeSequence;
    if (!src) return "ERR|Open the square sequence first.";
    var w = src.frameSizeHorizontal, h = src.frameSizeVertical;
    if (!h || Math.abs(w / h - 1) > 0.12) return "ERR|Active sequence isn't square (" + w + "x" + h + ").";
    var reelH = Math.round(w * 16 / 9);
    var srcName = src.name;

    // source project item, to nest twice
    var srcPI = null;
    ochaEachItem(app.project.rootItem, function (it) { if (!srcPI) { var n = ""; try { n = it.name; } catch (e) {} if (n === srcName) srcPI = it; } });
    if (!srcPI) return "ERR|Couldn't find '" + srcName + "' in the project to nest.";

    // clone -> reel, then empty it so we control the track layout
    src.clone();
    var reel = app.project.activeSequence;
    if (!reel || reel.name === srcName) return "ERR|clone didn't activate (active='" + (reel ? reel.name : "?") + "').";
    try { reel.name = srcName + " - Reel"; } catch (e) {}
    L.push("cleared=" + ochaClearSequence(reel));
    L.push(ochaResizeSeq(reel, reelH));

    // BG on V1: nested source, scaled to fill, blurred
    var fillPct = Math.round((reelH / h) * 100);
    try { reel.insertClip(srcPI, 0, 0, 0); L.push("bg-inserted"); } catch (e) { return "ERR|" + L.join(" / ") + " || bg insertClip: " + e.toString(); }
    // drop the blurred fill's audio - the front copy carries the real audio.
    // unlink first so removing the audio doesn't take the linked video with it.
    try {
      var atrk = reel.audioTracks[0], removed = 0;
      for (var ac = atrk.clips.numItems - 1; ac >= 0; ac--) {
        var aclip = atrk.clips[ac];
        try { aclip.setSelected(true, true); } catch (e) {}
        try { reel.unlinkSelection(); } catch (e) {}
        try { aclip.remove(false, false); removed++; } catch (e) {}
      }
      L.push("bg-audio-removed=" + removed + "(V1=" + reel.videoTracks[0].clips.numItems + ")");
    } catch (e) { L.push("bg-audio ERR " + e.toString()); }
    var bg = null; try { bg = reel.videoTracks[0].clips[0]; } catch (e) {}
    if (bg) { L.push("bg-" + ochaSetMotionScale(bg, fillPct)); L.push("bg-blur[" + ochaBlurClip(bg, 40) + "]"); }
    else L.push("bg-clip missing");

    // FG on V2: nested source, centred, untouched (default scale)
    try { reel.insertClip(srcPI, 0, 1, 0); L.push("fg-on-V2"); } catch (e) { L.push("fg insertClip ERR " + e.toString()); }

    return "OK|Reel '" + reel.name + "' " + w + "x" + reelH + " / " + L.join(" / ");
  } catch (e) { return "ERR|" + L.join(" / ") + " || " + e.toString(); }
}

function ochaCollectReport() {
  var names = [], clips = 0, bins = 0;
  try {
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      var kids = null; try { kids = it.children; } catch (e) {}
      if (kids && kids.numItems !== undefined) bins++;
      else { clips++; names.push(nm); }
    });
    ochaWrite("/tmp/ocha_toolbox.txt", "COLLECT\nbins=" + bins + " clips=" + clips + "\n" + names.join("\n"));
    return "OK|Project has " + clips + " media item(s) across " + bins + " bin(s). (Collect-into-bin action wires next.)";
  } catch (e) { return "ERR|" + e.toString(); }
}

function ochaCleanReport() {
  var ocha = [];
  try {
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      if (OCHA_EL_RE.test(nm)) ocha.push(nm);
    });
    ochaWrite("/tmp/ocha_toolbox.txt", "CLEAN\nOCHA template items=" + ocha.length + "\n" + ocha.join("\n"));
    return "OK|Found " + ocha.length + " OCHA template item(s) in the project bin. (Used/unused check + removal wire next.)";
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------- selection-aware Position ----------------
   When an OCHA branding clip is selected, the panel binds its sliders to that
   clip's Motion so edits apply live. */
function ochaSelectedOchaClip() {
  var seq = app.project.activeSequence;
  if (!seq) return null;
  var sel = null;
  try { sel = seq.getSelection(); } catch (e) { return null; }
  if (!sel) return null;
  var n = 0; try { n = sel.length; } catch (e) { n = 0; }
  for (var i = 0; i < n; i++) {
    var it = sel[i], nm = ""; try { nm = it.name; } catch (e) {}
    if (OCHA_EL_RE.test(nm)) return it;
  }
  return null;
}

/* 0.42 rework, round 2: the sliders drive the TEMPLATE's own "Position X/Y"
   controls (element's LEFT/TOP edge in px; the template clamps against the
   element's REAL text-aware bbox, so 0 = flush with the edge and it can never
   leave the comp). Clips placed with OLDER templates have no such controls —
   they fall back to Motion > Position, whose anchor knows nothing about the
   element (that's why it was replaced), clamped to the frame as before.
   Motion gotcha kept for the fallback: the param is NORMALIZED (fractions of
   the frame, [0.5,0.5] = centre) while Effect Controls displays px — writing
   raw px multiplied by the frame (measured: panel 6 -> 6480 = 6 x 1080).
   Scale stays PARKED: read/write touch position only. */
function ochaPosParams(clip) {
  var mgt = null;
  try { mgt = clip.getMGTComponent(); } catch (e) { return null; }
  if (!mgt) return null;
  var px = ochaFindParam(mgt.properties, "Position X");
  var py = ochaFindParam(mgt.properties, "Position Y");
  return (px && py) ? { x: px, y: py } : null;
}

function ochaReadMotion() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "none";
    var seq = app.project.activeSequence;
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var x = Math.round(w / 2), y = Math.round(h / 2), mode = "m";
    var tp = ochaPosParams(clip);
    if (tp) {
      // template sliders hold PERCENT of frame (Premiere clamps MOGRT sliders
      // to 0-100 — see sizeGroup in the AE builder); panel speaks px
      try { x = Math.round(tp.x.getValue() / 100 * w); y = Math.round(tp.y.getValue() / 100 * h); mode = "t"; } catch (eT) {}
    }
    if (mode === "m") {
      var mo = ochaFindComp(clip, "AE.ADBE Motion");
      if (mo) {
        var pp = ochaFindParam(mo.properties, "Position");
        if (pp) { try { var p = pp.getValue(); if (p && p.length >= 2) { x = Math.round(p[0] * w); y = Math.round(p[1] * h); } } catch (e) {} }
      }
    }
    var nm = ""; try { nm = clip.name; } catch (e) {}
    return nm + "|" + x + "|" + y + "|" + w + "|" + h + "|" + mode;
  } catch (e) { return "none"; }
}

function ochaWriteMotion(x, y) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|no OCHA clip selected";
    var seq = app.project.activeSequence;
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var fx = parseFloat(x), fy = parseFloat(y);
    if (isNaN(fx)) fx = w / 2;
    if (isNaN(fy)) fy = h / 2;
    fx = Math.max(0, Math.min(w, fx));          // panel-range cap (px space); the
    fy = Math.max(0, Math.min(h, fy));          // template clamps element-exact
    var tp = ochaPosParams(clip);
    if (tp) {
      // px -> PERCENT of frame (the sliders' 0-100 range; see ochaReadMotion)
      try { tp.x.setValue(fx / w * 100, true); tp.y.setValue(fy / h * 100, true);
            return "OK|tpos=" + Math.round(fx) + "," + Math.round(fy); }
      catch (eT) { return "ERR|" + eT.toString(); }
    }
    var mo = ochaFindComp(clip, "AE.ADBE Motion");
    if (!mo) return "ERR|no Motion";
    var pp = ochaFindParam(mo.properties, "Position");
    if (!pp) return "ERR|no Position prop";
    // old-template fallback: normalized Motion (see the block comment)
    try { pp.setValue([fx / w, fy / h], true); return "OK|pos=" + Math.round(fx) + "," + Math.round(fy); }
    catch (e1) { return "ERR|" + e1.toString(); }
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------- Toolbox: info readouts + real actions ----------------
   info* = what the modal shows on open (safe, read-only).
   the action fns actually change the project (self-reporting). */
function ochaAllSequences() {
  var seqs = [];
  try { var ss = app.project.sequences; if (ss && ss.numSequences !== undefined) { for (var i = 0; i < ss.numSequences; i++) seqs.push(ss[i]); } } catch (e) {}
  if (!seqs.length) { try { var a = app.project.activeSequence; if (a) seqs.push(a); } catch (e) {} }
  return seqs;
}
function ochaUsedItemIds() {
  var used = {}, seqs = ochaAllSequences(), s, t, c;
  for (s = 0; s < seqs.length; s++) {
    var seq = seqs[s];
    try {
      for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var clips = seq.videoTracks[t].clips;
        for (c = 0; c < clips.numItems; c++) {
          try { var pi = clips[c].projectItem; if (pi) { var id = pi.nodeId; if (id) used["n" + id] = 1; } } catch (e) {}
        }
      }
    } catch (e) {}
  }
  return used;
}
function ochaIsBin(it) { try { return !!(it.children && it.children.numItems !== undefined); } catch (e) { return false; } }
function ochaIsSequence(it) { try { return !!(it.isSequence && it.isSequence()); } catch (e) { return false; } }
// a real footage/media item to collect: not a bin, not a sequence, not an OCHA template
function ochaIsMedia(it) {
  if (ochaIsBin(it) || ochaIsSequence(it)) return false;
  var nm = ""; try { nm = it.name; } catch (e) {}
  if (!nm || OCHA_EL_RE.test(nm)) return false;
  return true;
}

// ---- Reel ----
function ochaReelInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open the square sequence first.";
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    if (!h || Math.abs(w / h - 1) > 0.12) return "ERR|'" + seq.name + "' is " + w + "x" + h + " - the reel needs a square (1:1) sequence.";
    return "OK|Ready: '" + seq.name + "' is square (" + w + "x" + h + ") - becomes a " + w + "x" + Math.round(w * 16 / 9) + " reel.";
  } catch (e) { return "ERR|" + e.toString(); }
}

// ---- Clean unused MOGRTs ----
function ochaCleanInfo() {
  try {
    var used = ochaUsedItemIds(), total = 0, unused = 0, names = [];
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      if (OCHA_EL_RE.test(nm)) {
        total++;
        var id = null; try { id = it.nodeId; } catch (e) {}
        if (!id || !used["n" + id]) { unused++; if (names.length < 6) names.push(nm); }
      }
    });
    return "OK|" + total + " OCHA template(s) in the project, " + unused + " not used in any sequence.|" + unused;
  } catch (e) { return "ERR|" + e.toString(); }
}
function ochaCleanMogrts() {
  try {
    var used = ochaUsedItemIds();

    // 1) collect the UNUSED OCHA template project items, and remember every media
    //    path that a USED item still needs (never delete those files).
    var toRemove = [], usedPaths = {}, rmPaths = [];
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) { return; }
      if (!OCHA_EL_RE.test(nm)) return;
      var id = null; try { id = it.nodeId; } catch (e) {}
      var mp = ""; try { mp = it.getMediaPath(); } catch (e) {}
      if (id && used["n" + id]) { if (mp) usedPaths[mp] = 1; }
      else { toRemove.push(it); if (mp) rmPaths.push(mp); }
    });

    // 2) remove the items. deleteBin() only works on BINS, which is why the old
    //    code silently failed on clip items - the reliable pattern is to move each
    //    into a throwaway bin and delete THAT bin (contents and all).
    var removed = 0, err = "";
    if (toRemove.length) {
      var trash = null;
      try { trash = app.project.rootItem.createBin("__ocha_clean__"); } catch (e0) { trash = null; }
      for (var i = 0; i < toRemove.length; i++) {
        var it = toRemove[i];
        try {
          if (trash) { it.moveBin(trash); removed++; }
          else { it.deleteBin(); removed++; }               // fallback (bin items)
        } catch (e1) { if (!err) err = e1.toString(); }
      }
      if (trash) { try { trash.deleteBin(); } catch (e2) { if (!err) err = e2.toString(); } }
    }

    // 3) delete the actual .mogrt FILES for the removed items from the project's
    //    "OCHA Branding Elements" folder - but ONLY files no used item still needs,
    //    and ONLY inside that folder (never touch anything else on disk).
    var filesDeleted = 0;
    var projPath = ""; try { projPath = app.project.path; } catch (e) {}
    if (projPath) {
      var assetDir = new Folder(new File(projPath).parent.fsName + "/" + OCHA_ASSET_DIR);
      for (var k = 0; k < rmPaths.length; k++) {
        var p = rmPaths[k];
        if (usedPaths[p]) continue;                          // a used item shares this file
        var f = new File(p);
        // guard: only delete inside the OCHA asset folder
        if (assetDir.exists && f.exists && f.fsName.indexOf(assetDir.fsName) === 0) {
          try { if (f.remove()) filesDeleted++; } catch (e3) {}
        }
      }
    }

    if (removed === 0 && toRemove.length) return "ERR|Couldn't remove (" + toRemove.length + " unused): " + err;
    var msg = "Removed " + removed + " unused template(s) from the project";
    if (filesDeleted) msg += " and deleted " + filesDeleted + " leftover .mogrt file(s)";
    return "OK|" + msg + ".";
  } catch (e) { return "ERR|" + e.toString(); }
}

// ---- Package project ----
// Copy every file the project depends on into one clean folder (sorted by type)
// beside the .prproj, then save a portable, relinked copy of the project inside
// it. The ORIGINAL project + media are never modified (saveAs writes a new file).
function ochaPkgExt(p) { var m = /\.([A-Za-z0-9]+)\s*$/.exec(p); return m ? m[1].toLowerCase() : ""; }
// No spaces in anything the packager creates: spaces -> underscore, collapse runs,
// trim leading/trailing underscores. Keeps a file's extension intact (only the base
// name is touched by the caller).
function ochaSafeName(s) {
  return String(s).replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
function ochaPkgCategory(p) {
  var e = ochaPkgExt(p);
  if (/^(mp4|mov|mxf|avi|mkv|m4v|mts|m2ts|mpg|mpeg|wmv|r3d|braw|dv|3gp|ts|vob|webm|f4v)$/.test(e)) return "footage";
  if (/^(jpg|jpeg|png|tif|tiff|gif|bmp|webp|heic|heif|dpx|tga|jp2)$/.test(e)) return "images";
  if (/^(psd|ai|eps|svg|indd|pdf|mogrt|aegraphic|exr|c4d)$/.test(e)) return "graphics";
  if (/^(wav|mp3|aac|aif|aiff|m4a|flac|ogg|wma|caf)$/.test(e)) return "audio";
  return "other";
}
// Recursive folder copy (ExtendScript has no Folder.copy). Used to bundle the
// project's "OCHA Branding Elements" folder - the .mogrt sources - into the package.
function ochaCopyTree(srcFolder, destFolder) {
  if (!srcFolder.exists) return 0;
  if (!destFolder.exists) destFolder.create();
  var n = 0, list = srcFolder.getFiles();
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (it instanceof Folder) {
      n += ochaCopyTree(it, new Folder(destFolder.fsName + "/" + it.name));
    } else {
      try { if (it.copy(destFolder.fsName + "/" + it.name)) n++; } catch (e) {}
    }
  }
  return n;
}

function ochaPkgFolder(rootFsName, cat) {
  var f = new Folder(rootFsName + "/" + cat);
  if (!f.exists) f.create();
  return f;
}
function ochaPkgUniqueDest(folder, name) {
  var f = new File(folder.fsName + "/" + name);
  if (!f.exists) return f;
  var dot = name.lastIndexOf("."), base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
  for (var i = 2; i < 9999; i++) { var g = new File(folder.fsName + "/" + base + " (" + i + ")" + ext); if (!g.exists) return g; }
  return f;
}
// every project item pointing at a real file on disk - excludes bins, sequences
// and synthetics (colour mattes, bars, adjustment layers) which have no path.
function ochaPkgMediaItems() {
  var out = [];
  ochaEachItem(app.project.rootItem, function (it) {
    var p = ""; try { p = it.getMediaPath(); } catch (e) { p = ""; }
    if (p && new File(p).exists) out.push({ item: it, path: p });
  });
  return out;
}
function ochaPkgDest() {
  var projPath = ""; try { projPath = app.project.path; } catch (e) {}
  if (!projPath) return null;
  var projFile = new File(projPath);
  var base = decodeURI(projFile.name).replace(/\.[^.]+$/, "");
  // ASK where to put the package (native folder picker), instead of dropping it
  // beside the project. Returns null with a "cancelled" flag if the user backs out.
  var chosen = null;
  try { chosen = Folder.selectDialog("Choose where to save the '" + base + "' package"); } catch (e) { chosen = null; }
  if (!chosen) return { cancelled: true };
  var parent = chosen.fsName;
  var safe = ochaSafeName(base);
  var root = new Folder(parent + "/" + safe + "_Package");
  if (root.exists) { for (var i = 2; i < 999; i++) { var r = new Folder(parent + "/" + safe + "_Package_" + i); if (!r.exists) { root = r; break; } } }
  return { root: root, projName: base };
}

function ochaPackageInfo() {
  try {
    var projPath = ""; try { projPath = app.project.path; } catch (e) {}
    if (!projPath) return "ERR|Save your project first, then package it.";
    // READ-ONLY: just count files. Do NOT resolve a destination here - that now
    // shows a folder picker (ochaPkgDest), and calling it from the info step is
    // what prompted the user twice.
    var items = ochaPkgMediaItems();
    return "OK|" + items.length + " media file(s) to package.|" + items.length;
  } catch (e) { return "ERR|" + e.toString(); }
}

function ochaPackageProject() {
  try {
    var projPath = ""; try { projPath = app.project.path; } catch (e) {}
    if (!projPath) return "ERR|Save your project first, then package it.";
    var d = ochaPkgDest();
    if (!d) return "ERR|Couldn't resolve the project folder.";
    if (d.cancelled) return "WARN|Cancelled - no folder chosen.";
    var root = d.root;
    if (!root.exists && !root.create()) return "ERR|Couldn't create the package folder at " + root.fsName;

    var items = ochaPkgMediaItems();
    if (!items.length) return "ERR|No media files found on disk to package.";

    // 1) copy each unique source file into its category folder (dedupe by path)
    var map = {}, counts = { footage: 0, images: 0, graphics: 0, audio: 0, other: 0 }, copied = 0, failed = 0, firstErr = "";
    for (var i = 0; i < items.length; i++) {
      var src = items[i].path;
      if (map[src]) continue;                       // same file used by several clips - copy once
      var cat = ochaPkgCategory(src);
      var srcFile = new File(src);
      var destFolder = ochaPkgFolder(root.fsName, cat);
      var _nm = decodeURI(srcFile.name), _dot = _nm.lastIndexOf(".");
      var _safe = (_dot > 0 ? ochaSafeName(_nm.substring(0, _dot)) + _nm.substring(_dot)
                            : ochaSafeName(_nm));
      var dest = ochaPkgUniqueDest(destFolder, _safe);
      var ok = false; try { ok = srcFile.copy(dest.fsName); } catch (e1) { ok = false; if (!firstErr) firstErr = e1.toString(); }
      if (ok && dest.exists) { map[src] = dest.fsName; counts[cat]++; copied++; }
      else { failed++; if (!firstErr) firstErr = "copy failed: " + srcFile.name; }
    }
    if (copied === 0) return "ERR|Couldn't copy any files: " + firstErr;

    // 2) save a COPY of the project into the package root (original file untouched)
    var newProj = new File(root.fsName + "/" + ochaSafeName(d.projName) + ".prproj");
    var savedAs = false;
    try { app.project.saveAs(newProj.fsName); savedAs = true; } catch (e2) { firstErr = firstErr || e2.toString(); }

    // 3) relink the (now packaged) project's items to the copied media
    var relinked = 0;
    if (savedAs) {
      var live = ochaPkgMediaItems();               // re-read: same items, paths still original
      for (var j = 0; j < live.length; j++) {
        var np = map[live[j].path];
        if (!np) continue;
        try { if (live[j].item.canChangeMediaPath(np)) { live[j].item.changeMediaPath(np); relinked++; } } catch (e3) {}
      }
      try { app.project.save(); } catch (e4) {}
    }

    // 3b) The OCHA MOGRT sources travel too. Premiere can't relink an .aegraphic via
    //     script (changeMediaPath is a no-op on MOGRT media), so copying the project's
    //     "OCHA Branding Elements" folder into the package keeps the .mogrt sources with
    //     it. Same NAME (spaces kept) so the reference still resolves. projPath was
    //     captured before saveAs, so it's the ORIGINAL project's folder.
    var brandingCopied = 0;
    try {
      var origBrand = new Folder(new File(projPath).parent.fsName + "/" + OCHA_ASSET_DIR);
      if (origBrand.exists) {
        brandingCopied = ochaCopyTree(origBrand, new Folder(root.fsName + "/" + OCHA_ASSET_DIR));
      }
    } catch (eBr) {}

    var parts = [];
    if (counts.footage) parts.push("footage " + counts.footage);
    if (counts.images) parts.push("images " + counts.images);
    if (counts.graphics) parts.push("graphics " + counts.graphics);
    if (counts.audio) parts.push("audio " + counts.audio);
    if (counts.other) parts.push("other " + counts.other);
    var msg = "Packaged " + copied + " file(s) into '" + decodeURI(root.name) + "' (" + parts.join(", ") + ").";
    if (savedAs) msg += " Saved a relinked copy - you're now in the package; your original is unchanged.";
    else msg += " NOTE: couldn't save the project copy (" + firstErr + ") - files were still copied.";
    if (brandingCopied) msg += " Bundled the OCHA branding folder (" + brandingCopied + " template file(s)).";
    if (counts.graphics) msg += " If a MOGRT shows OFFLINE, run File > Project Manager - Premiere can't relink templates by script.";
    if (failed) msg += " " + failed + " file(s) failed to copy.";
    return "OK|" + msg;
  } catch (e) { return "ERR|" + e.toString(); }
}
