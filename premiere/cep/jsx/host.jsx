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

/* ---------------- captions: inspect what is stylable (probe v1) ----------------
   Goal is OCHA-brand caption styling, but first we must learn whether Premiere
   exposes caption / track-style to ExtendScript. This inspects the SELECTED
   caption clip and dumps its API + component/property tree to
   /tmp/ocha_caption_probe.txt so the real styling is built on facts. */
function ochaReflect(o) {
  var out = { props: [], methods: [] }, i;
  try {
    var r = o.reflect;
    for (i = 0; i < r.properties.length; i++) out.props.push(r.properties[i].name);
    for (i = 0; i < r.methods.length; i++) out.methods.push(r.methods[i].name);
  } catch (e) {}
  return out;
}
function ochaWrite(path, text) {
  try { var f = new File(path); f.encoding = "UTF-8"; f.open("w"); f.write(text); f.close(); return true; }
  catch (e) { return false; }
}
function ochaProbeCaption() {
  var L = [], P = function (s) { L.push(String(s)); };
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open a sequence first.";
    var sel = [];
    try { var s = seq.getSelection(); if (s) { for (var i = 0; i < s.length; i++) sel.push(s[i]); } }
    catch (e) { P("getSelection ERR " + e); }
    P("selected items: " + sel.length);
    if (!sel.length) { ochaWrite("/tmp/ocha_caption_probe.txt", L.join("\n")); return "ERR|Select a caption clip on the timeline, then click again."; }

    var it = sel[0];
    P("item.name = " + it.name);
    try { P("item.mediaType = " + it.mediaType); } catch (e) {}
    try { P("item.type = " + it.type); } catch (e) {}
    var refl = ochaReflect(it);
    P("ITEM props: " + refl.props.join(", "));
    P("ITEM methods: " + refl.methods.join(", "));
    var all = refl.props.concat(refl.methods), hit = [];
    for (var q = 0; q < all.length; q++) if (/caption|style|font|track|text|colou?r|fill|background/i.test(all[q])) hit.push(all[q]);
    P("STYLE-ISH members: " + (hit.length ? hit.join(", ") : "none"));

    // component/property tree (where MOGRT params lived - same technique)
    try {
      var comps = it.components;
      P("components: " + (comps ? comps.numItems : "none"));
      for (var c = 0; c < (comps ? comps.numItems : 0); c++) {
        var comp = comps[c], pn = [];
        try { for (var p = 0; p < comp.properties.numItems; p++) pn.push(comp.properties[p].displayName); } catch (ee) {}
        P("  [" + c + "] " + comp.displayName + " (" + comp.matchName + "): " + pn.join(", "));
      }
    } catch (e) { P("components ERR " + e); }

    ochaWrite("/tmp/ocha_caption_probe.txt", L.join("\n"));
    return "OK|Inspected '" + it.name + "' - " + L.length + " lines written. Send me /tmp/ocha_caption_probe.txt";
  } catch (e) { return "ERR|" + e.toString(); }
}

/* TEMP: full-surface dump to answer "can the plugin trigger Create captions
   from transcript?". Lists EVERY app + qe method (not a filtered guess) so we
   can see if any transcription / caption-creation / menu-command hook exists.
   Writes /tmp/ocha_menu_probe.txt. Remove after the decision. */
function ochaProbeMenus() {
  var L = [], P = function (s) { L.push(String(s)); };
  try {
    var ar = ochaReflect(app);
    P("=== app METHODS (" + ar.methods.length + ") ===");
    P(ar.methods.join(", "));
    P("=== app PROPS (" + ar.props.length + ") ===");
    P(ar.props.join(", "));
    try {
      var proj = app.project, pr = ochaReflect(proj);
      P("=== project METHODS (" + pr.methods.length + ") ===");
      P(pr.methods.join(", "));
    } catch (e) { P("project reflect ERR " + e); }
    try {
      var seq = app.project.activeSequence;
      if (seq) { var sr = ochaReflect(seq);
        P("=== sequence METHODS (" + sr.methods.length + ") ===");
        P(sr.methods.join(", ")); }
      else P("no active sequence");
    } catch (e) { P("sequence reflect ERR " + e); }
    try { app.enableQE(); } catch (e) { P("enableQE ERR " + e); }
    if (typeof qe !== "undefined" && qe) {
      var qr = ochaReflect(qe);
      P("=== qe METHODS (" + qr.methods.length + ") ===");
      P(qr.methods.join(", "));
      P("=== qe PROPS (" + qr.props.length + ") ===");
      P(qr.props.join(", "));
    } else { P("qe undefined after enableQE"); }
    var blob = L.join(" "), kws = ["transcri", "caption", "menu", "command", "execute", "speech", "subtitle", "sensei", "text"], found = [];
    for (var i = 0; i < kws.length; i++) { if (new RegExp(kws[i], "i").test(blob)) found.push(kws[i]); }
    P("=== KEYWORD HITS: " + (found.length ? found.join(", ") : "NONE") + " ===");
    ochaWrite("/tmp/ocha_menu_probe.txt", L.join("\n"));
    return "OK|full API dumped -> /tmp/ocha_menu_probe.txt (hits: " + (found.join(",") || "none") + ")";
  } catch (e) { return "ERR|" + e.toString(); }
}
