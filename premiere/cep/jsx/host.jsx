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
  ending: "OCHA Ending"
};
var OCHA_FMT = {
  reels:  { folder: "reels",  label: "Reels 9x16" },
  feed45: { folder: "feed45", label: "Feed 4x5" },
  square: { folder: "square", label: "Square 1x1" },
  event:  { folder: "event",  label: "Event 16x9" }
};
// value coercion per control (everything not listed is text)
var OCHA_BOOL = { "Centre align": 1, "Show pin icon": 1, "Over black": 1 };
var OCHA_NUM  = { "Pin colour": 1, "Size": 1 };

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
    if (!dest.exists) {
      var ok = new File(src).copy(dest.fsName);
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
function ochaApplyMotion(seq, clip, m) {
  if (m.scale == null && m.posX == null && m.posY == null) return "";
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return "motion=Motion component not found";
  var parts = [];
  if (m.scale != null) {
    var sp = ochaFindParam(mo.properties, "Scale");
    if (!sp) parts.push("no Scale prop");
    else { try { sp.setValue(m.scale, true); parts.push("scale=" + m.scale); }
           catch (e1) { parts.push("scale ERR " + e1.toString()); } }
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

function ochaKeys(o) {
  var k = []; for (var p in o) { try { k.push(p); } catch (e) {} } return k.join(",");
}
function ochaFindSequenceObj(nm) {
  // clone() may not return the Sequence; the clone usually becomes active.
  var a = app.project.activeSequence;
  if (a && a.name === nm) return a;
  return null;
}
function ochaResizeSeq(seq, newH) {
  var st; try { st = seq.getSettings(); } catch (e) { return "getSettings ERR " + e; }
  var field = null, cand = ["videoFrameHeight", "frameHeight", "height"];
  for (var i = 0; i < cand.length; i++) { if (cand[i] in st) { field = cand[i]; break; } }
  if (!field) return "no height field (has: " + ochaKeys(st) + ")";
  try { st[field] = newH; seq.setSettings(st); return "resized via " + field; }
  catch (e) { return "setSettings ERR " + e; }
}
function ochaAddBlur(clip, amount) {
  // QE: add Gaussian Blur to a clip, then set its Blurriness
  try {
    app.enableQE();
    if (typeof qe === "undefined") return "qe unavailable";
    var qs = qe.project.getActiveSequence();
    if (!qs) return "no qe sequence";
    // locate the matching qe clip on track 0 item 0 (the bg we just inserted)
    var vt = qs.getVideoTrackAt(0);
    if (!vt) return "no qe video track 0";
    var qc = vt.getItemAt(0);
    if (!qc) return "no qe clip";
    var fx = qe.project.getVideoEffectByName("Gaussian Blur");
    if (!fx) return "Gaussian Blur effect not found by name";
    qc.addVideoEffect(fx);
    return "blur added (amount set via Effect Controls / next pass)";
  } catch (e) { return "blur ERR " + e.toString(); }
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

    // find the source's project item so we can nest it
    var srcPI = null;
    ochaEachItem(app.project.rootItem, function (it) { if (!srcPI) { var n = ""; try { n = it.name; } catch (e) {} if (n === srcName) srcPI = it; } });
    L.push("srcItem=" + (srcPI ? "ok" : "MISSING"));

    // clone the square sequence -> becomes the reel base (content preserved)
    var reel = null;
    try { src.clone(); } catch (e) { return "ERR|clone: " + e.toString(); }
    reel = ochaFindSequenceObj(srcName + " Copy") || app.project.activeSequence;
    if (!reel || reel.name === srcName) return "ERR|clone made no new sequence (active still '" + (reel ? reel.name : "?") + "').";
    try { reel.name = srcName + " - Reel"; } catch (e) {}
    L.push("clone->'" + reel.name + "'");

    // resize the clone to 9:16 (original content stays centred = foreground)
    L.push(ochaResizeSeq(reel, reelH));

    // nest the source below as the blurred fill (best-effort)
    if (srcPI) {
      try {
        var tz = (typeof src.getPlayerPosition === "function") ? src.getPlayerPosition() : null;
        // insert nested source on top track then treat as bg via scale+blur
        var vIdx = reel.videoTracks ? reel.videoTracks.numTracks : 1;
        reel.insertClip(srcPI, reel.getPlayerPosition ? reel.getPlayerPosition().ticks : 0, vIdx, 0);
        L.push("nested bg inserted");
      } catch (e) { L.push("nest ERR " + e.toString()); }
    }
    L.push(ochaAddBlur(null, 0));

    return "OK|Reel '" + reel.name + "' " + w + "x" + reelH + ". " + L.join(" / ");
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
      if (/^OCHA (Lower Third|Location|Bug|Ending)/.test(nm)) ocha.push(nm);
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
    if (/^OCHA (Lower Third|Location|Bug|Ending)/.test(nm)) return it;
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
    var mo = ochaFindComp(clip, "AE.ADBE Motion");
    if (mo) {
      var sp = ochaFindParam(mo.properties, "Scale");
      if (sp) { try { var s = sp.getValue(); if (typeof s === "number") scale = s; } catch (e) {} }
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
    var sp = ochaFindParam(mo.properties, "Scale");
    if (sp) { try { sp.setValue(parseFloat(scale), true); out.push("scale"); } catch (e) { out.push("scaleERR"); } }
    var pp = ochaFindParam(mo.properties, "Position");
    if (pp) { try { pp.setValue([w / 2 + parseFloat(offX), h / 2 - parseFloat(offY)], true); out.push("pos"); } catch (e) { out.push("posERR"); } }
    return "OK|" + out.join(",");
  } catch (e) { return "ERR|" + e.toString(); }
}
