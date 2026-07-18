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
  if (!nm || /^OCHA (Lower Third|Location|Bug|Ending)/.test(nm)) return false;
  return true;
}

// ---- Reel ----
function ochaReelInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open the square sequence first.";
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    if (!h || Math.abs(w / h - 1) > 0.12) return "ERR|'" + seq.name + "' is " + w + "x" + h + " - the reel needs a square sequence.";
    return "OK|'" + seq.name + "' (" + w + "x" + h + ") will become a " + w + "x" + Math.round(w * 16 / 9) + " reel: original centred, blurred fill behind. Works on a clone - your original is untouched.";
  } catch (e) { return "ERR|" + e.toString(); }
}

// ---- Clean unused MOGRTs ----
function ochaCleanInfo() {
  try {
    var used = ochaUsedItemIds(), total = 0, unused = 0, names = [];
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      if (/^OCHA (Lower Third|Location|Bug|Ending)/.test(nm)) {
        total++;
        var id = null; try { id = it.nodeId; } catch (e) {}
        if (!id || !used["n" + id]) { unused++; if (names.length < 6) names.push(nm); }
      }
    });
    return "OK|" + total + " OCHA template(s) in the project, " + unused + " not used in any sequence." + (unused ? " Remove them?" : "") + "|" + unused;
  } catch (e) { return "ERR|" + e.toString(); }
}
function ochaCleanMogrts() {
  try {
    var used = ochaUsedItemIds(), toRemove = [];
    ochaEachItem(app.project.rootItem, function (it) {
      var nm = ""; try { nm = it.name; } catch (e) {}
      if (/^OCHA (Lower Third|Location|Bug|Ending)/.test(nm)) {
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

// ---- Collect media ----
function ochaCollectInfo() {
  try {
    var media = 0;
    ochaEachItem(app.project.rootItem, function (it) { if (ochaIsMedia(it)) media++; });
    return "OK|Gathers the project's footage into one bin named 'Collected media' (sequences and OCHA templates are left where they are). " + media + " media item(s) found.|" + media;
  } catch (e) { return "ERR|" + e.toString(); }
}
function ochaCollectMedia() {
  try {
    var root = app.project.rootItem, binName = "Collected media", bin = null, i;
    for (i = 0; i < root.children.numItems; i++) { var it = root.children[i]; var nm = ""; try { nm = it.name; } catch (e) {} if (nm === binName && ochaIsBin(it)) { bin = it; break; } }
    if (!bin) { try { bin = root.createBin(binName); } catch (e) { return "ERR|createBin: " + e.toString(); } }
    // snapshot the media items first (moving mutates the tree we'd be walking)
    var items = [];
    ochaEachItem(root, function (it) { if (ochaIsMedia(it)) items.push(it); });
    var moved = 0, err = "";
    for (i = 0; i < items.length; i++) {
      try { items[i].moveBin(bin); moved++; } catch (e) { if (!err) err = e.toString(); }
    }
    if (moved === 0 && items.length) return "ERR|Couldn't move items (" + items.length + " media): " + err;
    return "OK|Moved " + moved + " media item(s) into '" + binName + "'.";
  } catch (e) { return "ERR|" + e.toString(); }
}
