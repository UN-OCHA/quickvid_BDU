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
var OCHA_BOOL = { "Centre align": 1, "Show pin icon": 1, "Over black": 1, "Top": 1, "Full screen": 1 };
var OCHA_NUM  = { "Pin colour": 1, "Size": 1, "Opacity": 1 };

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
    var pp = ochaFindParam(mo.properties, "Position");
    if (!pp) parts.push("no Position prop");
    else {
      var cx, cy, cur = null;
      try { cur = pp.getValue(); } catch (e2) { cur = null; }
      if (cur && cur.length >= 2) { cx = cur[0]; cy = cur[1]; }
      else { cx = seq.frameSizeHorizontal / 2; cy = seq.frameSizeVertical / 2; }
      // UI: +X right, +Y up. Premiere screen space: +Y down -> subtract.
      var nx = cx + (m.posX || 0);
      var ny = cy - (m.posY || 0);
      try { pp.setValue([nx, ny], true);
            parts.push("pos=[" + Math.round(nx) + "," + Math.round(ny) + "] from [" + Math.round(cx) + "," + Math.round(cy) + "]"); }
      catch (e3) { parts.push("pos ERR " + e3.toString()); }
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

    var out = "OK|track=V" + (usedV + 1) + "|set=" + setNames.join(",");
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

/* ---------------- selection-aware Size & Position ----------------
   When an OCHA branding clip is selected, the panel binds its sliders to that
   clip's Motion so edits apply live (offsets are from the frame centre; +Y up). */
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

function ochaReadMotion() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "none";
    var seq = app.project.activeSequence;
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var scale = 100, offX = 0, offY = 0;
    var tSize = ochaGetSize(clip);             // the template's own Size wins
    if (tSize != null) scale = tSize;
    var mo = ochaFindComp(clip, "AE.ADBE Motion");
    if (mo) {
      if (tSize == null) {
        var sp = ochaFindParam(mo.properties, "Scale");
        if (sp) { try { var s = sp.getValue(); if (typeof s === "number") scale = s; } catch (e) {} }
      }
      var pp = ochaFindParam(mo.properties, "Position");
      if (pp) { try { var p = pp.getValue(); if (p && p.length >= 2) { offX = Math.round(p[0] - w / 2); offY = Math.round(-(p[1] - h / 2)); } } catch (e) {} }
    }
    var nm = ""; try { nm = clip.name; } catch (e) {}
    return nm + "|" + Math.round(scale) + "|" + offX + "|" + offY;
  } catch (e) { return "none"; }
}

function ochaWriteMotion(scale, offX, offY) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|no OCHA clip selected";
    var seq = app.project.activeSequence;
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var mo = ochaFindComp(clip, "AE.ADBE Motion");
    if (!mo) return "ERR|no Motion";
    var out = [];
    if (ochaSetSize(clip, scale)) {
      out.push("size");                         // template's own anchor, not the comp centre
    } else {
      var sp = ochaFindParam(mo.properties, "Scale");
      if (sp) { try { sp.setValue(parseFloat(scale), true); out.push("scale"); } catch (e) { out.push("scaleERR"); } }
    }
    var pp = ochaFindParam(mo.properties, "Position");
    if (pp) { try { pp.setValue([w / 2 + parseFloat(offX), h / 2 - parseFloat(offY)], true); out.push("pos"); } catch (e) { out.push("posERR"); } }
    return "OK|" + out.join(",");
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
    var used = ochaUsedItemIds(), toRemove = [];
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      if (OCHA_EL_RE.test(nm)) {
        var id = null; try { id = it.nodeId; } catch (e) {}
        if (!id || !used["n" + id]) toRemove.push(it);
      }
    });
    var removed = 0, err = "";
    for (var i = 0; i < toRemove.length; i++) {
      try { toRemove[i].deleteBin(); removed++; }
      catch (e1) { try { app.project.deleteSequence ? 0 : 0; toRemove[i].remove(); removed++; } catch (e2) { if (!err) err = e2.toString(); } }
    }
    if (removed === 0 && toRemove.length) return "ERR|Couldn't remove (" + toRemove.length + " unused): " + err;
    return "OK|Removed " + removed + " unused OCHA template(s).";
  } catch (e) { return "ERR|" + e.toString(); }
}

// ---- Package project ----
// Copy every file the project depends on into one clean folder (sorted by type)
// beside the .prproj, then save a portable, relinked copy of the project inside
// it. The ORIGINAL project + media are never modified (saveAs writes a new file).
function ochaPkgExt(p) { var m = /\.([A-Za-z0-9]+)\s*$/.exec(p); return m ? m[1].toLowerCase() : ""; }
function ochaPkgCategory(p) {
  var e = ochaPkgExt(p);
  if (/^(mp4|mov|mxf|avi|mkv|m4v|mts|m2ts|mpg|mpeg|wmv|r3d|braw|dv|3gp|ts|vob|webm|f4v)$/.test(e)) return "footage";
  if (/^(jpg|jpeg|png|tif|tiff|gif|bmp|webp|heic|heif|dpx|tga|jp2)$/.test(e)) return "images";
  if (/^(psd|ai|eps|svg|indd|pdf|mogrt|aegraphic|exr|c4d)$/.test(e)) return "graphics";
  if (/^(wav|mp3|aac|aif|aiff|m4a|flac|ogg|wma|caf)$/.test(e)) return "audio";
  return "other";
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
  var projFile = new File(projPath), projFolder = projFile.parent;
  var base = decodeURI(projFile.name).replace(/\.[^.]+$/, "");
  var root = new Folder(projFolder.fsName + "/" + base + " - Package");
  if (root.exists) { for (var i = 2; i < 999; i++) { var r = new Folder(projFolder.fsName + "/" + base + " - Package " + i); if (!r.exists) { root = r; break; } } }
  return { root: root, projName: base };
}

function ochaPackageInfo() {
  try {
    var projPath = ""; try { projPath = app.project.path; } catch (e) {}
    if (!projPath) return "ERR|Save your project first - packaging copies its files into a folder next to the .prproj.";
    var items = ochaPkgMediaItems();
    var d = ochaPkgDest();
    return "OK|" + items.length + " media file(s) found. Destination folder: '" + decodeURI(d.root.name) + "'.|" + items.length;
  } catch (e) { return "ERR|" + e.toString(); }
}

function ochaPackageProject() {
  try {
    var projPath = ""; try { projPath = app.project.path; } catch (e) {}
    if (!projPath) return "ERR|Save your project first, then package it.";
    var d = ochaPkgDest();
    if (!d) return "ERR|Couldn't resolve the project folder.";
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
      var dest = ochaPkgUniqueDest(destFolder, srcFile.name);
      var ok = false; try { ok = srcFile.copy(dest.fsName); } catch (e1) { ok = false; if (!firstErr) firstErr = e1.toString(); }
      if (ok && dest.exists) { map[src] = dest.fsName; counts[cat]++; copied++; }
      else { failed++; if (!firstErr) firstErr = "copy failed: " + srcFile.name; }
    }
    if (copied === 0) return "ERR|Couldn't copy any files: " + firstErr;

    // 2) save a COPY of the project into the package root (original file untouched)
    var newProj = new File(root.fsName + "/" + d.projName + ".prproj");
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

    var parts = [];
    if (counts.footage) parts.push("footage " + counts.footage);
    if (counts.images) parts.push("images " + counts.images);
    if (counts.graphics) parts.push("graphics " + counts.graphics);
    if (counts.audio) parts.push("audio " + counts.audio);
    if (counts.other) parts.push("other " + counts.other);
    var msg = "Packaged " + copied + " file(s) into '" + decodeURI(root.name) + "' (" + parts.join(", ") + ").";
    if (savedAs) msg += " Saved a relinked copy (" + relinked + " relinked) - you're now working in the package; your original project is unchanged.";
    else msg += " NOTE: couldn't save the project copy (" + firstErr + ") - files were still copied.";
    if (failed) msg += " " + failed + " file(s) failed to copy.";
    return "OK|" + msg;
  } catch (e) { return "ERR|" + e.toString(); }
}
