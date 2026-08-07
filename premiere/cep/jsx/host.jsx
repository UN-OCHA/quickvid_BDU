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
  gradient: "OCHA Gradient",
  vignette: "OCHA Vignette"
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
var OCHA_BOOL = { "Centre align": 1, "Show pin icon": 1, "Over black": 1, "Top": 1, "Middle": 1,
                    "Middle left": 1, "Middle right": 1, "Full screen": 1 };
var OCHA_NUM  = { "Pin colour": 1, "Size": 1, "Opacity": 1, "Amount": 1 };
// Renamed EGP controls: panel sends the CURRENT name; clips placed with an older
// template still carry the old one, so writers fall back through this map instead
// of warning "could not set" on every edit of an old clip.
var OCHA_FIELD_ALIAS = { "3rd line (optional)": "Title line 2 (optional)" };

/* ---------------- Naming placed items by what they contain ----------------
   Six lower thirds all called "OCHA Lower Third - Square 1x1" are six identical
   rows in the Project panel, and Premiere prints that name on the timeline clip
   too. Naming by CONTENT makes both readable.

   The format is dropped on purpose: it is implied by the sequence the clip sits
   in, the .mogrt file on disk keeps it, and in the panel it is dead weight.

   SAFE because every "is this an OCHA item?" test in this file matches the
   PREFIX only (OCHA_EL_RE = ^OCHA <Element>), never the tail. Keep that prefix
   and the selected-clip binder, Remove unused, Tidy and the packager all
   continue to work. */
function ochaShort(s, n) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ");
  var t = "";
  for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (c !== "\n" && c !== "\r") t += c; }
  t = t.replace(/^\s+|\s+$/g, "");
  if (t.length <= n) return t;
  return t.substring(0, n - 1) + "\u2026";
}

// kv = the same {label: value} the panel sent, so the name reflects what was set
function ochaItemLabel(el, kv) {
  var g = function (k) { return kv && kv[k] !== undefined ? String(kv[k]) : ""; };
  if (el === "lt")   return ochaShort(g("Name"), 40);
  if (el === "loc")  return ochaShort(g("Place"), 40);
  if (el === "text") return ochaShort(g("Line 1"), 40);
  if (el === "gradient") {
    var pos = g("Full screen") === "true" ? "Full screen"
            : g("Middle") === "true" ? "Middle"
            : g("Top") === "true" ? "Top" : "Bottom";
    if (pos === "Middle") {
      if (g("Middle left") === "true") pos += " left half";
      else if (g("Middle right") === "true") pos += " right half";
    }
    var op = g("Opacity");
    return pos + (op ? " " + Math.round(parseFloat(op)) : "");
  }
  if (el === "vignette") {
    var am = g("Amount");
    return am ? Math.round(parseFloat(am)) + "%" : "";
  }
  return "";                       // logo + ending carry nothing to name them by
}

// "OCHA Lower Third - John Doe", numbered when there is nothing to tell them apart
function ochaNameFor(el, kv, currentName) {
  var base = OCHA_EL_NAME[el] || "OCHA";
  var label = ochaItemLabel(el, kv);
  var name = label ? base + " - " + label : base;

  // Already right? Do nothing - and crucially, skip the project-wide walk below.
  // This runs on every debounced keystroke, so the common case must be a string
  // compare rather than a scan of every item in the project.
  if (currentName && currentName === name) return name;
  // A numbered variant of the same base is also already correct ("OCHA Ending 2"
  // must not renumber itself to 3 on every edit).
  if (currentName && !label && currentName.indexOf(base + " ") === 0 &&
      /^[0-9]+$/.test(currentName.substring(base.length + 1))) return currentName;

  // Count what is already in the project so a second one does not collide. For
  // elements with no label (logo, ending) ALWAYS number - "OCHA Ending 1",
  // "OCHA Ending 2" - since otherwise they are indistinguishable.
  var taken = {};
  ochaEachItem(app.project.rootItem, function (it) {
    var n = ""; try { n = it.name; } catch (e) {}
    if (n) taken[n] = 1;
  });
  if (!label) {
    for (var i = 1; i < 999; i++) { if (!taken[name + " " + i]) return name + " " + i; }
    return name;
  }
  if (!taken[name]) return name;
  for (var j = 2; j < 999; j++) { if (!taken[name + " " + j]) return name + " " + j; }
  return name;
}

function ochaRenameClipItem(clip, el, kv) {
  try {
    var pit = clip ? clip.projectItem : null;
    if (!pit) return "";
    var cur = ""; try { cur = clip.name; } catch (eC) {}
    var nm = ochaNameFor(el, kv, cur);
    if (nm === cur) return nm;                 // nothing to do
    pit.name = nm;
    try { clip.name = nm; } catch (e1) {}      // the timeline label follows too
    return nm;
  } catch (e) { return ""; }
}

function ochaFmtFromSize(w, h) {
  if (!w || !h) return null;
  var r = w / h;
  if (r <= 0.66) return "reels";
  if (r < 0.92)  return "feed45";
  if (r <= 1.12) return "square";
  return "event";
}

// "OK|<n>|V1,V2,..."  - how many video tracks the active sequence has, for the
// panel's track picker. Read-only.
function ochaTrackList() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "none";
    var n = seq.videoTracks.numTracks, names = [];
    for (var i = 0; i < n; i++) {
      var nm = "V" + (i + 1);
      try { if (seq.videoTracks[i].name) nm = "" + seq.videoTracks[i].name; } catch (e) {}
      names.push(nm);
    }
    return "OK|" + n + "|" + names.join(",");
  } catch (e) { return "none"; }
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
    // fallback - its param is NORMALIZED fractions (see ochaReadMotion).
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
    var kv = ochaTextOfClip(clip, false);     /* text only: these fill text inputs */
    if (kv === null) return "none";
    return nm + "|" + el + "|" + kv;
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
/* `doRename` is deliberately OFF for live typing. This runs on a DEBOUNCED
   keystroke, and renaming there was corrosive: each rename changed clip.name, the
   poller saw a name it did not recognise as the bound clip, treated it as a new
   selection and re-filled the fields from the clip - on top of what was being
   typed. It also walked the whole project tree per keystroke to find a free name.
   The item is renamed on Add and on an explicit Update, which is when a name is
   actually finished. */
function ochaWriteText(kvBlob, doRename, expectName) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|Select an OCHA clip first.";
    // The panel says which clip it BELIEVES it is editing. If the selection moved
    // between the debounce and this call, refuse - never write one clip's text
    // onto another.
    if (expectName) {
      var curNm = ""; try { curNm = clip.name; } catch (eE) {}
      if (curNm !== expectName) return "ERR|Selection changed - nothing was written.";
    }
    var mgt = null; try { mgt = clip.getMGTComponent(); } catch (e1) { mgt = null; }
    if (!mgt) return "ERR|Controls not reachable on that clip.";
    var entries = kvBlob ? kvBlob.split("\u001E") : [];
    var set = [], fail = [], kvMap = {};
    for (var n = 0; n < entries.length; n++) {
      if (!entries[n]) continue;
      var kv = entries[n].split("\u001F"), key = kv[0], raw = kv[1];
      if (key.charAt(0) === "@") continue;              // Motion is handled elsewhere
      kvMap[key] = raw;
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
    // Rename to match the edit. Which element is it? Read it back off the clip's
    // existing name rather than trusting the caller - the panel only sends fields.
    var cur = ""; try { cur = clip.name; } catch (e3) {}
    var el2 = "";
    for (var k in OCHA_EL_NAME) {
      if (OCHA_EL_NAME.hasOwnProperty(k) && cur.indexOf(OCHA_EL_NAME[k]) === 0) { el2 = k; break; }
    }
    var renamed = (doRename && el2) ? ochaRenameClipItem(clip, el2, kvMap) : "";

    var out = "OK|set=" + set.join(",");
    if (renamed) out += "|named=" + renamed;
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

// Is a video track free at this moment? Used to place the gradient as LOW as
// possible without landing on the footage.
function ochaTrackFreeAt(seq, vIdx, ticks) {
  try {
    var clips = seq.videoTracks[vIdx].clips, t = parseFloat(ticks);
    for (var i = 0; i < clips.numItems; i++) {
      var c = clips[i];
      var s0 = parseFloat(c.start.ticks), e0 = parseFloat(c.end.ticks);
      if (t >= s0 && t < e0) return false;
    }
    return true;
  } catch (e) { return false; }
}

// The track ladder to try, in order, for one element.
//   pref = "" | "top"   -> one-past-top, top, 0   (graphics sit above everything)
//   pref = "bottom"     -> the LOWEST free track upward from V1, so a readability
//                          gradient lands UNDER the text/captions it is there to
//                          make legible, instead of on top of them
//   pref = "<n>"        -> that exact 0-based track first, then the usual ladder
function ochaTrackTries(seq, pref, ticks) {
  var vCount = seq.videoTracks.numTracks;
  var normal = [vCount, vCount - 1, 0];
  if (pref === "bottom") {
    var low = [];
    for (var i = 0; i < vCount; i++) if (ochaTrackFreeAt(seq, i, ticks)) low.push(i);
    return low.concat([vCount]).concat(normal);      // free-from-bottom, then a new track
  }
  var n = parseInt(pref, 10);
  if (!isNaN(n) && n >= 0) return [n].concat(normal);
  return normal;
}

function ochaAdd(el, fmtKey, extRoot, kvBlob, trackPref) {
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

    // track ladder: explicit choice / gradient-low / one-past-top, then top, then 0
    var tries = ochaTrackTries(seq, trackPref || (el === "gradient" ? "bottom" : "top"), timeTicks);
    var seen = {}, clip = null, usedV = -1, errs = [];
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

    var setNames = [], failNames = [], kvMap = {};
    var motion = { scale: null, posX: null, posY: null };   // at-keys route to Motion
    var entries = kvBlob ? kvBlob.split("\u001E") : [];
    for (var n = 0; n < entries.length; n++) {
      if (!entries[n]) continue;
      var kv = entries[n].split("\u001F");
      var key = kv[0], raw = kv[1];
      if (key.charAt(0) !== "@") kvMap[key] = raw;         // kept for the item name
      if (key === "@scale") { motion.scale = parseFloat(raw); continue; }
      if (key === "@posX")  { motion.posX  = parseFloat(raw); continue; }
      if (key === "@posY")  { motion.posY  = parseFloat(raw); continue; }
      // The at-font key: the typeface chosen BEFORE placing, so a UN-style lower
      // third can go down in one step instead of place-then-switch. The "at"
      // prefix keeps it out of kvMap, which drives the clip's auto name - a bare
      // "Font" key would make the clip "OCHA Lower Third - 2". Silently ignored
      // on a template with no Font control, so an older installed template still
      // places normally.
      //
      // NEVER start a comment with the at-sign in this file. ExtendScript's
      // preprocessor reads it as a DIRECTIVE - the same mechanism that gives us
      // the slash-slash-at-include and slash-slash-at-target forms - so an
      // unknown one is a SyntaxError and the WHOLE file fails to load. Every
      // ocha*() call then returns "EvalScript error." and the panel greys out
      // with no clue why. Cost most of an afternoon on 2026-07-31; a normal JS
      // parser accepts it happily, because this is Adobe's preprocessor and not
      // JavaScript. tools/check-jsx.py now fails the build on it.
      if (key === "@font") {
        if (mgt) {
          var fpAdd = ochaFindParam(mgt.properties, "Font");
          if (fpAdd) {
            var fi = parseInt(raw, 10);          // 0-based: Raleway=0, Bebas=1
            if (isNaN(fi) || fi < 0) fi = 0;
            try { fpAdd.setValue(fi, true); setNames.push("Font"); } catch (eF) {}
          }
        }
        continue;
      }
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
    // Name it by what it holds. Do this LAST: ochaInsertedTrack still looks the
    // clip up by the template's name, so renaming earlier would hide it.
    var newName = ochaRenameClipItem(clip, el, kvMap);
    var out = "OK|track=V" + (realV + 1) + "|set=" + setNames.join(",");
    if (newName) out += "|named=" + newName;
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

/* ---------------- Tidy the project panel into bins ----------------
   Sorts loose media into "01 Footage / 02 Images / 03 Graphics / 04 Audio /
   05 Other", reusing the SAME categoriser the packager uses so a tidied project
   and a packaged one group things identically.

   Deliberately conservative: sequences are never moved (they are the things you
   open, and burying them helps nobody), OCHA template items are left where they
   are, anything already inside a bin is left alone (that is the user's own
   filing), and nothing is ever deleted or renamed. Numbered names keep the bins
   in a sensible order in Premiere's alphabetical list. */
var OCHA_BIN_NAMES = { footage: "01 Footage", images: "02 Images",
                       graphics: "03 Graphics", audio: "04 Audio", other: "05 Other",
                       missing: "06 Missing (offline)" };

function ochaFindOrMakeBin(name) {
  var root = app.project.rootItem, i;
  for (i = 0; i < root.children.numItems; i++) {
    var it = root.children[i], nm = "";
    try { nm = it.name; } catch (e) {}
    if (nm === name) {
      var kids = null; try { kids = it.children; } catch (e2) {}
      if (kids && kids.numItems !== undefined) return it;      // existing bin
    }
  }
  try { return root.createBin(name); } catch (e3) { return null; }
}

// "OK|<moved>|<summary>" - counts only, no destructive step beyond emptied bins.
function ochaTidyProject() {
  try {
    var root = app.project.rootItem, i;

    // Our own bins, by name - never treated as a user bin to flatten.
    var ours = {};
    for (var k in OCHA_BIN_NAMES) if (OCHA_BIN_NAMES.hasOwnProperty(k)) ours[OCHA_BIN_NAMES[k]] = 1;

    // Walk the WHOLE tree, not just the top level: existing bins are flattened
    // into the standard ones, so a project that was already sorted some other way
    // ends up sorted this way. Collected first, because moving items while walking
    // mutates the collections underneath the walk.
    var loose = [], bins = [];
    ochaEachItem(root, function (it) {
      if (it === root) return;
      var kids = null; try { kids = it.children; } catch (e) {}
      if (kids && kids.numItems !== undefined) {
        var bn = ""; try { bn = it.name; } catch (e1) {}
        if (!ours[bn]) bins.push(it);                    // a user bin - flatten later
        return;
      }
      var isSeq = false;
      try { if (typeof it.isSequence === "function") isSeq = it.isSequence(); } catch (e2) {}
      if (isSeq) return;                                  // sequences are what you open
      var nm = ""; try { nm = it.name; } catch (e3) {}
      var mp = ""; try { mp = it.getMediaPath(); } catch (e4) { mp = ""; }
      var cat;
      if (mp && !new File(mp).exists) cat = "missing";
      else cat = ochaPkgCategory(mp || nm);
      loose.push({ item: it, cat: cat });
    });
    if (!loose.length && !bins.length) return "OK|0|Nothing to tidy - the project panel is already organised.";

    var made = {}, moved = 0, counts = {}, failed = 0;
    for (var j = 0; j < loose.length; j++) {
      var c0 = loose[j].cat, binName = OCHA_BIN_NAMES[c0] || OCHA_BIN_NAMES.other;
      if (!made[c0]) made[c0] = ochaFindOrMakeBin(binName);
      if (!made[c0]) { failed++; continue; }
      try { loose[j].item.moveBin(made[c0]); moved++; counts[c0] = (counts[c0] || 0) + 1; }
      catch (e5) { failed++; }
    }

    // Remove the emptied bins - DEEPEST FIRST, and only when genuinely empty.
    // "Only when empty" is the whole safety story: a bin still holding a sequence
    // (or anything we chose not to move) survives, so nothing can be deleted by
    // being swept up inside its parent.
    var removed = 0;
    for (var b = bins.length - 1; b >= 0; b--) {
      var n = -1;
      try { n = bins[b].children.numItems; } catch (e6) { n = -1; }
      if (n !== 0) continue;
      try { bins[b].deleteBin(); removed++; } catch (e7) {}
    }

    var parts = [];
    for (var c in counts) if (counts.hasOwnProperty(c)) parts.push(counts[c] + " " + c);
    var msg = "Moved " + moved + " item(s) into bins (" + parts.join(", ") + ").";
    if (removed) msg += " Removed " + removed + " now-empty folder(s).";
    if (bins.length - removed > 0) {
      msg += " " + (bins.length - removed) + " folder(s) kept - they still hold a sequence or something that wasn't moved.";
    }
    if (counts.missing) msg += " " + counts.missing + " offline item(s) are in \"06 Missing (offline)\" - relink or replace them.";
    if (failed) msg += " " + failed + " couldn't be moved.";
    return "OK|" + moved + "|" + msg;
  } catch (e) { return "ERR|" + e.toString(); }
}



/* ---------------- Remove unused: list first, delete only what is ticked --------
   "Unused" = a project item that appears in NO sequence. Premiere has no usage
   API, so the only honest way is to walk every sequence's video and audio tracks
   and collect the nodeIds actually placed, then treat everything else as unused.
   Bins and sequences are never candidates.

   Deliberately two calls: ochaUnusedList() reports, the panel shows tick boxes,
   and ochaUnusedDelete() removes ONLY the indexes sent back. Nothing is deleted
   on the strength of the scan alone. */
function ochaUsedNodeIds() {
  var used = {}, i, t, c;
  for (i = 0; i < app.project.sequences.numSequences; i++) {
    var sq = app.project.sequences[i];
    var pools = [];
    try { pools.push(sq.videoTracks); } catch (e) {}
    try { pools.push(sq.audioTracks); } catch (e1) {}
    for (var pi = 0; pi < pools.length; pi++) {
      var pool = pools[pi];
      for (t = 0; t < pool.numTracks; t++) {
        var clips = null; try { clips = pool[t].clips; } catch (e2) { clips = null; }
        if (!clips) continue;
        for (c = 0; c < clips.numItems; c++) {
          try {
            var pit = clips[c].projectItem;
            if (pit && pit.nodeId) used[pit.nodeId] = 1;
          } catch (e3) {}
        }
      }
    }
  }
  return used;
}

// "OK|<n>|name<US>name<US>..."   (US = the same 0x1F the panel already uses)
function ochaUnusedList() {
  try {
    var used = ochaUsedNodeIds(), names = [];
    OCHA_UNUSED = [];
    ochaEachItem(app.project.rootItem, function (it) {
      if (it === app.project.rootItem) return;
      var kids = null; try { kids = it.children; } catch (e) {}
      if (kids && kids.numItems !== undefined) return;        // a bin
      var isSeq = false;
      try { if (typeof it.isSequence === "function") isSeq = it.isSequence(); } catch (e1) {}
      if (isSeq) return;                                       // sequences are never "unused"
      var id = null; try { id = it.nodeId; } catch (e2) {}
      if (id && used[id]) return;                              // on a timeline somewhere
      var nm = ""; try { nm = it.name; } catch (e3) { nm = "(unnamed)"; }
      OCHA_UNUSED.push(it);
      names.push(nm);
    });
    return "OK|" + names.length + "|" + names.join(String.fromCharCode(31));
  } catch (e) { return "ERR|" + e.toString(); }
}
var OCHA_UNUSED = [];

// idxCsv = the indexes the user left TICKED, against the last ochaUnusedList()
function ochaUnusedDelete(idxCsv) {
  try {
    if (!OCHA_UNUSED || !OCHA_UNUSED.length) return "ERR|Run the scan again - the list has gone stale.";
    var want = {}, parts = String(idxCsv || "").split(","), i;
    for (i = 0; i < parts.length; i++) {
      var n = parseInt(parts[i], 10);
      if (!isNaN(n)) want[n] = 1;
    }

    // Which media files do the SURVIVORS still need? Anything on that list is
    // never deleted from disk, even if another (removed) item pointed at it too.
    var keepPaths = {};
    ochaEachItem(app.project.rootItem, function (it) {
      var mp = ""; try { mp = it.getMediaPath(); } catch (e2) {}
      if (!mp) return;
      var isGoing = false;
      for (var j = 0; j < OCHA_UNUSED.length; j++) {
        if (want[j] && OCHA_UNUSED[j] === it) { isGoing = true; break; }
      }
      if (!isGoing) keepPaths[mp] = 1;      // something staying still needs this file
    });

    // deleteBin() only works on BINS - calling it on a clip item silently does
    // nothing, which is why Clean MOGRTs moved each item into a throwaway bin and
    // deleted THAT. Same pattern here.
    var gone = 0, kept = 0, failed = 0, rmPaths = [];
    var trash = null;
    try { trash = app.project.rootItem.createBin("__ocha_unused__"); } catch (e3) { trash = null; }
    for (var k = OCHA_UNUSED.length - 1; k >= 0; k--) {
      if (!want[k]) { kept++; continue; }
      var mp2 = ""; try { mp2 = OCHA_UNUSED[k].getMediaPath(); } catch (e4) { mp2 = ""; }
      try {
        if (trash) { OCHA_UNUSED[k].moveBin(trash); gone++; }
        else { OCHA_UNUSED[k].deleteBin(); gone++; }
        if (mp2) rmPaths.push(mp2);
      } catch (e5) { failed++; }
    }
    if (trash) { try { trash.deleteBin(); } catch (e6) { failed += 0; } }

    // Delete the leftover .mogrt FILES too - but ONLY inside the project's OCHA
    // templates folder, and only ones nothing still uses. Never anything else on
    // disk: the user's own footage is only ever unlinked from the project.
    var filesDeleted = 0, projPath = "";
    try { projPath = app.project.path; } catch (e7) {}
    if (projPath) {
      var assetDir = new Folder(new File(projPath).parent.fsName + "/" + OCHA_ASSET_DIR);
      for (var m = 0; m < rmPaths.length; m++) {
        var pth = rmPaths[m];
        if (keepPaths[pth]) continue;
        var f = new File(pth);
        if (assetDir.exists && f.exists && f.fsName.indexOf(assetDir.fsName) === 0) {
          try { if (f.remove()) filesDeleted++; } catch (e8) {}
        }
      }
    }

    OCHA_UNUSED = [];
    var msg = "Removed " + gone + " unused item(s) from the project";
    if (filesDeleted) msg += " and deleted " + filesDeleted + " leftover OCHA template file(s)";
    msg += ".";
    if (kept) msg += " " + kept + " left in place.";
    if (failed) msg += " " + failed + " couldn't be removed.";
    return "OK|" + gone + "|" + msg;
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------- Sequence colour: detect + fix ----------------
   Measured on Premiere 26.3 (the colour probe): getSettings() carries
   `workingColorSpace` and `workingColorSpaceList` (4 entries), and a ColorSpace
   exposes name / primaries / transferCharacteristic. Rec. 709 is matched by the
   NUMERIC codes (primaries 1, transfer 1 - ITU-T H.273), never by the display
   name, which could be localised.

   Why this matters: iPhones shoot HDR (HLG) by default, so a sequence created
   from that footage is born Rec. 2100 HLG. Everything then looks flat and OCHA
   blue reads wrong, and it is invisible until export. */
var OCHA_CS_709 = { primaries: 1, transfer: 1 };

function ochaIs709(cs) {
  if (!cs) return false;
  try {
    return cs.primaries === OCHA_CS_709.primaries &&
           cs.transferCharacteristic === OCHA_CS_709.transfer &&
           !cs.isSceneReferred;
  } catch (e) { return false; }
}

function ochaCsName(cs) {
  try { return "" + (cs.name || "unknown"); } catch (e) { return "unknown"; }
}

// "OK|<prose>|<needsFix 0|1>|<is709 0|1>|<name>"  - read-only, so it is safe to
// poll (only the blind write-back is dangerous). Field order is dictated by the
// panel's GENERIC modal path, which reads field 1 as the status line and field 2
// as a count that gates the CTA - so an already-correct sequence disables the
// button for free. The banner reads fields 3 and 4.
function ochaColorStatus() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open the sequence you want to check first.|0";
    var st = seq.getSettings();
    var cs = st ? st.workingColorSpace : null;
    if (!cs) return "ERR|Couldn't read this sequence's colour settings.|0";
    var ok = ochaIs709(cs), nm = ochaCsName(cs);
    var prose = ok ? "This sequence is standard Rec. 709 - nothing to fix."
                   : "This sequence is set to " + nm + ", not Rec. 709.";
    return "OK|" + prose + "|" + (ok ? "0" : "1") + "|" + (ok ? "1" : "0") + "|" + nm;
  } catch (e) { return "ERR|" + e.toString() + "|0"; }
}

// Snapshot every setting as a comparable string, so a write can be AUDITED.
function ochaSettingsSnap(st) {
  var snap = {};
  for (var k in st) {
    try {
      var v = st[k];
      snap[k] = (k === "workingColorSpace") ? ochaCsName(v)
              : (k === "workingColorSpaceList") ? "list" : ("" + v);
    } catch (e) { snap[k] = "(unreadable)"; }
  }
  return snap;
}

// Restore a clip's position to the TEMPLATE'S DESIGNED SPOT.
//
// "Reset" used to write the frame CENTRE. That is right for Motion (its default
// really is the centre) but wrong for our templates, whose default is the
// designed edge - a left-anchored lower third belongs at the safe margin, not
// the middle of the frame. Worse, because the panel wrote a value either way it
// looked like a one-step undo rather than a reset.
//
// The template default is recoverable without hard-coding anything: our
// sizeGroup expressions treat "slider exactly on its baked default" as
// AS-DESIGNED, and Premiere hands back a MOGRT parameter's own default. Where
// that isn't available we fall back to Motion's real default, the centre.
// Returns "OK|<x>|<y>" in the panel's pixel space so the sliders can follow.
function ochaResetPos() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|Select an OCHA clip first.";
    var seq = app.project.activeSequence;
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var tp = ochaPosParams(clip);
    if (tp) {
      var dx = null, dy = null;
      // the parameter knows what it was born as; name varies by API version
      try { if (typeof tp.x.getDefaultValue === "function") dx = tp.x.getDefaultValue(); } catch (e1) {}
      try { if (typeof tp.y.getDefaultValue === "function") dy = tp.y.getDefaultValue(); } catch (e2) {}
      if (dx === null || dy === null) {
        try { if (tp.x.defaultValue !== undefined) dx = tp.x.defaultValue; } catch (e3) {}
        try { if (tp.y.defaultValue !== undefined) dy = tp.y.defaultValue; } catch (e4) {}
      }
      if (dx !== null && dy !== null) {
        tp.x.setValue(parseFloat(dx), true);
        tp.y.setValue(parseFloat(dy), true);
        return "OK|" + Math.round(parseFloat(dx) / 100 * w) + "|" + Math.round(parseFloat(dy) / 100 * h);
      }
      return "ERR|This template does not report its default position - move it back by hand, or delete the clip and add it again.";
    }
    // Motion-only clip (placed before the template gained Position controls):
    // its genuine default IS the centre.
    var mo = ochaFindComp(clip, "AE.ADBE Motion");
    var pp = mo ? ochaFindParam(mo.properties, "Position") : null;
    if (!pp) return "ERR|No position to reset on that clip.";
    pp.setValue([0.5, 0.5], true);
    return "OK|" + Math.round(w / 2) + "|" + Math.round(h / 2);
  } catch (e) { return "ERR|" + e.toString(); }
}

function ochaFixColor() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open the sequence you want to fix first.";
    var st = seq.getSettings();
    if (!st) return "ERR|Couldn't read this sequence's settings.";
    var was = ochaCsName(st.workingColorSpace);
    if (ochaIs709(st.workingColorSpace)) return "OK|already|" + was + "|" + seq.name;

    // pick Rec. 709 out of the sequence's OWN list - never build a ColorSpace
    var list = st.workingColorSpaceList, target = null, n = 0;
    try { n = list.length; } catch (eL) { n = 0; }
    for (var i = 0; i < n; i++) { if (ochaIs709(list[i])) { target = list[i]; break; } }
    if (!target) return "ERR|Rec. 709 isn't offered for this sequence (found " + n + " option(s)).";

    // AUDIT the write. setSettings takes the whole object, and a lossy round trip
    // is exactly what we suspect wrecked a project's colour once - so snapshot
    // before, write, snapshot after, and REPORT anything that moved besides the
    // fields we meant to touch. Silent collateral damage is the thing to avoid.
    var before = ochaSettingsSnap(st);
    st.workingColorSpace = target;
    st.autoToneMapEnabled = true;      // converts the HDR footage instead of passing it raw
    seq.setSettings(st);

    // VERDICT from a fresh read, tested with the SAME predicate the banner uses.
    // Comparing serialised names was fragile: the round-tripped object reported
    // workingColorSpace as "list" and the tool cried "didn't take" on a fix that
    // had actually worked. What we care about is "is it Rec. 709 now?", so ask
    // exactly that.
    var fresh = app.project.activeSequence.getSettings();
    var nowCs = fresh ? fresh.workingColorSpace : null;
    var ok = ochaIs709(nowCs);
    var nowName = ochaCsName(nowCs);

    var after = ochaSettingsSnap(fresh);
    var intended = { workingColorSpace: 1, autoToneMapEnabled: 1 };
    var drift = [];
    for (var k in before) {
      if (intended[k]) continue;
      if (after[k] !== undefined && after[k] !== before[k]) {
        drift.push(k + ": " + before[k] + " -> " + after[k]);
      }
    }
    // setSettings is a whole-object write, so Premiere sometimes re-defaults a
    // field we never touched - previewCodec drops ProRes HQ to LT. That only
    // affects PREVIEW renders, never the export, but it is still not ours to
    // change: put it back and re-audit rather than leaving a silent downgrade.
    var restored = "";
    if (drift.length && before.previewCodec !== undefined &&
        after.previewCodec !== before.previewCodec) {
      try {
        fresh.previewCodec = before.previewCodec;
        app.project.activeSequence.setSettings(fresh);
        var after2 = ochaSettingsSnap(app.project.activeSequence.getSettings());
        if (after2.previewCodec === before.previewCodec) {
          restored = "previewCodec";
          var d2 = [];
          for (var k2 in before) {
            if (intended[k2]) continue;
            if (after2[k2] !== undefined && after2[k2] !== before[k2]) {
              d2.push(k2 + ": " + before[k2] + " -> " + after2[k2]);
            }
          }
          drift = d2;
        }
      } catch (eR) {}
    }

    var msg = (ok ? "OK|fixed|" : "ERR|didn't take|") + was + " -> " + nowName + "|" + seq.name;
    if (restored) msg += "|restored=" + restored;
    if (drift.length) msg += "|drift=" + drift.join("; ");
    return msg;
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

function ochaResizeSeq(seq, newW, newH) {
  // NEVER round-trip getSettings() -> setSettings() to change one number.
  //
  // That is what this function used to do, and it WASHED OUT THE COLOUR of the
  // whole project (Javi, 2026-07-27: "the blue is no longer OCHA blue... in all
  // sequences"). The settings object does not survive the round trip: fields the
  // API doesn't fully expose - colour management / working colour space above all
  // - come back defaulted, and writing the object back APPLIES those defaults.
  // Colour management is project-level in current Premiere, so the damage is not
  // scoped to the sequence we meant to resize.
  //
  // QE's setVideoFrameSize touches ONLY the frame size. Measured present on
  // Premiere 26.3 (it shows up in the QE sequence's reflection list).
  try {
    app.enableQE();
    var qs = (typeof qe !== "undefined" && qe) ? qe.project.getActiveSequence() : null;
    if (qs && typeof qs.setVideoFrameSize === "function") {
      qs.setVideoFrameSize(newW, newH);
      // The PREVIEW frame size does not follow the video frame size. A reel cloned
      // from a square kept previewFrameWidth/Height at 1080x1080 on a 1080x1920
      // sequence (measured 2026-07-28 in the colour probe) - previews then render
      // at the wrong shape. Best-effort: never let this fail the resize.
      try {
        if (typeof qs.setPreviewFrameSize === "function") {
          qs.setPreviewFrameSize(newW, newH);
        }
      } catch (eP) {}
      return "resized";
    }
  } catch (e) { return "resize ERR " + e.toString(); }
  // Deliberately NO settings-object fallback: an unresized sequence is obvious
  // and harmless, silently wrecked colour is neither.
  return "resize FAILED (QE setVideoFrameSize unavailable) - sequence left at its original size";
}

function ochaClearSequence(seq) {
  var n = 0, t, c;
  try { for (t = 0; t < seq.videoTracks.numTracks; t++) { var vc = seq.videoTracks[t].clips; for (c = vc.numItems - 1; c >= 0; c--) { try { vc[c].remove(false, false); n++; } catch (e) {} } } } catch (e) {}
  try { for (t = 0; t < seq.audioTracks.numTracks; t++) { var ac = seq.audioTracks[t].clips; for (c = ac.numItems - 1; c >= 0; c--) { try { ac[c].remove(false, false); } catch (e) {} } } } catch (e) {}
  return n;
}

/* Captions are their own track layer and the DOM has never exposed it (measured
   26.3: seq.captionTracks is undefined, a selected cue reports zero components).
   It matters here because clone() copies the caption track wholesale - so a reel
   cloned from a captioned square showed the subtitles TWICE: once from the copied
   track, once from the nested square rendering its own captions through the nest.
   The real fix is to not clone at all (see ochaReelBase); this stays as the
   belt-and-braces for the clone fallback. Best effort, and it reports which path
   worked so a real run tells us the truth instead of us guessing again. */
function ochaClearCaptions(seq) {
  var n = 0, found = "none", t, c, cc;
  try {
    var ct = seq.captionTracks;
    if (ct && ct.numTracks) {
      found = "dom" + ct.numTracks;
      for (t = 0; t < ct.numTracks; t++) {
        cc = null; try { cc = ct[t].clips; } catch (e1) {}
        if (!cc) continue;
        for (c = cc.numItems - 1; c >= 0; c--) { try { cc[c].remove(false, false); n++; } catch (e2) {} }
      }
    }
  } catch (e) {}
  if (found === "none") {
    try {
      app.enableQE();
      var qs = (typeof qe !== "undefined" && qe) ? qe.project.getActiveSequence() : null;
      if (qs && qs.numCaptionTracks) {
        found = "qe" + qs.numCaptionTracks;
        for (t = 0; t < qs.numCaptionTracks; t++) {
          var qt = null; try { qt = qs.getCaptionTrackAt(t); } catch (e3) {}
          if (!qt) continue;
          for (c = (qt.numItems || 0) - 1; c >= 0; c--) {
            try { qt.getItemAt(c).remove(false); n++; } catch (e4) {}
          }
        }
      }
    } catch (e) {}
  }
  return found === "none" ? "captions=not-scriptable" : "captions=" + found + "/removed" + n;
}

/* An empty sequence carrying the square's settings - the reel is built into it.
   PREFERRED: createNewSequenceFromClips makes a BRAND NEW sequence matched to the
   source, so there is no caption track to inherit. FALLBACK: the original
   clone-and-empty path, which does inherit one (hence the caption wipe). */
function ochaReelBase(src, srcPI, srcName, L) {
  var reelName = srcName + " - Reel", made = null;
  try {
    if (typeof app.project.createNewSequenceFromClips === "function") {
      made = app.project.createNewSequenceFromClips(reelName, [srcPI], app.project.rootItem);
      // some builds return nothing but still create and activate it
      if (!made) { var a = app.project.activeSequence; if (a && a.name !== srcName) made = a; }
      if (made) {
        try { app.project.openSequence(made.sequenceID); } catch (eO) {}
        made = app.project.activeSequence;
      }
    }
  } catch (eC) { L.push("fromClips ERR " + eC.toString()); made = null; }
  if (made && made.name !== srcName) {
    L.push("base=new(no captions) cleared=" + ochaClearSequence(made));
    return made;
  }
  src.clone();
  var reel = app.project.activeSequence;
  if (!reel || reel.name === srcName) return null;
  try { reel.name = reelName; } catch (eN) {}
  L.push("base=clone cleared=" + ochaClearSequence(reel) + " " + ochaClearCaptions(reel));
  return reel;
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
    /* Guards on the RECIPE, not on squareness: 4:5 is filled the same way (see
       ochaReelFills). The old squareness test rejected 4:5 outright. */
    if (!h || !ochaReelFills(ochaReelShape(src))) return "ERR|Active sequence isn't square or 4:5 (" + w + "x" + h + ").";
    var reelH = Math.round(w * 16 / 9);
    var srcName = src.name;

    // source project item, to nest twice
    var srcPI = null;
    ochaEachItem(app.project.rootItem, function (it) { if (!srcPI) { var n = ""; try { n = it.name; } catch (e) {} if (n === srcName) srcPI = it; } });
    if (!srcPI) return "ERR|Couldn't find '" + srcName + "' in the project to nest.";

    // an empty sequence with the square's settings, then we own the track layout
    var reel = ochaReelBase(src, srcPI, srcName, L);
    if (!reel) return "ERR|Couldn't create the reel sequence (" + L.join(" / ") + ").";
    L.push(ochaResizeSeq(reel, w, reelH));

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

/* ===========================================================================
   TURN INTO A REEL  (square path + landscape path + reframing)

   TWO SHAPES, TWO RECIPES, ONE TOOL. The panel does not ask which: the active
   sequence already says what it is.

     square 1:1   -> nest twice, back copy scaled up and blurred to fill.
                     Nothing is cropped, so nothing has to move. Unchanged from
                     the original Square to Reel tool.
     landscape    -> the picture is CROPPED to a 9:16 slice. No blur, no bars.

   The landscape path deliberately does NOT nest. Nesting is right for the square
   (the whole square stays visible inside the reel), but a cropped landscape keeps
   only about a third of the width, so any OCHA graphic sitting near a 16x9 edge
   would be sliced off inside the nest, where nothing can reach it. So the
   landscape path CLONES the sequence and works on the clone: the real clips stay
   real, the user can razor them, and the graphics can be re-placed properly.

   RE-PLACED, never nudged. A 16x9 lower third moved into a 9:16 frame is still a
   16x9 lower third: wrong width, wrong type size. The elements are read (element
   type, every text field, in/out, track), removed, and placed again from the
   REELS template through ochaAdd, which is the panel's one placement path. That
   is what "adapted to the new composition according to the standards" has to mean;
   adjusting transforms instead would be a second implementation of the standards
   and it would drift.

   Captions are the documented exception: Premiere exposes no way to script a
   caption's position. They survive the clone with their text intact and the panel
   says so, pointing at the reel guide template.
   =========================================================================== */

/* Which recipe applies. Uses the same ratio bands as ochaFmtFromSize so the tool
   and the format picker can never disagree about what a sequence is. */
function ochaReelShape(seq) {
  if (!seq) return "none";
  var w = 0, h = 0;
  try { w = seq.frameSizeHorizontal; h = seq.frameSizeVertical; } catch (e) { return "none"; }
  if (!w || !h) return "none";
  var k = ochaFmtFromSize(w, h);
  if (k === "reels") return "reel";
  if (k === "square") return "square";
  if (k === "event") return "landscape";
  return "feed45";                       /* 4x5 crops like a landscape, just less */
}

/* Reel size for a source. The reel is as WIDE as the source is TALL, then 16/9 of
   that: 1920x1080 gives 1080x1920, 3840x2160 gives 2160x3840. Full source height
   is kept and the width is cropped, which is the whole point of the landscape
   recipe (no upscale beyond what the crop itself needs). */
/* Which recipe a shape gets. Anything NOT wider than tall has to be FILLED (the
   reel is taller than it, so there is nothing to crop): square and 4:5 both. 4:5
   used to route to the crop path, which made a 1080x1350 source into a 1350x2400
   sequence - a sideways upscale of a shape that only needed height. */
function ochaReelFills(shape) { return shape === "square" || shape === "feed45"; }

function ochaReelSizeFor(w, h, shape) {
  if (ochaReelFills(shape)) return { w: w, h: Math.round(w * 16 / 9) };
  return { w: h, h: Math.round(h * 16 / 9) };
}

function ochaReelInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open the sequence you want to turn into a reel.";
    var w = seq.frameSizeHorizontal, h = seq.frameSizeVertical;
    var shape = ochaReelShape(seq);
    /* Already a reel is a STATE, not a failure: after a successful conversion the
       panel re-reads this on the sequence it just built, and an ERR here painted
       a red "nothing to convert" line over every success. OK with a count of 0
       greys the CTA (countGated) and leaves the reframing controls usable, which
       is exactly what someone coming back to fix a shot needs. */
    if (shape === "reel") return "OK|This is a reel (" + w + "x" + h + "). Select a shot in the timeline to reframe it.|0|reel";
    if (shape === "none") return "ERR|Couldn't read the sequence size.";
    /* "OK|<status line>" and nothing else: loadInfo() reads parts[1] as the line
       to show and parts[2] as a count. An extra segment here would print the
       shape name at the user instead of the sentence. */
    var r = ochaReelSizeFor(w, h, shape);
    if (ochaReelFills(shape)) {
      return "OK|Ready: '" + seq.name + "' is " + w + "x" + h + " - becomes a "
        + r.w + "x" + r.h + " reel, with a blurred copy filling top and bottom.|1|fill";
    }
    return "OK|Ready: '" + seq.name + "' is " + w + "x" + h + " - becomes a "
      + r.w + "x" + r.h + " reel, cropped to the middle. You can reframe any clip afterwards.|1|crop";
  } catch (e) { return "ERR|" + e.toString(); }
}

/* Read the controls off ANY clip, as an ochaAdd kv blob.

   `includeAll` is the difference between the two callers, and it matters:
     false - TEXT ONLY, for the panel's selection-bound fields (ochaReadText).
     true  - EVERY control, for the reel migration. A graphic is re-placed from a
             FRESH template, so anything not captured here comes back at the
             template default: a gradient tuned to 40% would return as the stock
             bottom scrim, a location strip would lose its pin colour and icon,
             and the user would redo work the tool says it carried over.
   ochaAdd coerces on the way back in (OCHA_BOOL to boolean, OCHA_NUM to float),
   so everything is captured as a plain string here and it stays symmetric. */
function ochaTextOfClip(clip, includeAll) {
  var mgt = null;
  try { mgt = clip.getMGTComponent(); } catch (e) { return null; }
  if (!mgt) return null;
  var out = [];
  for (var i = 0; i < mgt.properties.numItems; i++) {
    var pr = mgt.properties[i], dn = "";
    try { dn = pr.displayName; } catch (e2) { continue; }
    if (!dn) continue;
    var special = OCHA_BOOL[dn] || OCHA_NUM[dn] || dn === "Size";
    if (special && !includeAll) continue;
    var v = "";
    try { v = pr.getValue(); } catch (e3) { continue; }
    if (typeof v === "string") { out.push(dn + "\u001F" + ochaUnwrapText(v)); continue; }
    if (!includeAll) continue;
    if (typeof v === "boolean") { out.push(dn + "\u001F" + (v ? "true" : "false")); continue; }
    if (typeof v === "number") { out.push(dn + "\u001F" + v); continue; }
  }
  return out.join("\u001E");
}

/* Is this clip's Scale animated? A time-varying property ignores setValue(). */
function ochaScaleIsKeyed(clip) {
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return false;
  var sp = ochaFindParam(mo.properties, "Scale");
  if (!sp) return false;
  try { return !!sp.isTimeVarying(); } catch (e) { return false; }
}

function ochaGetMotionScale(clip) {
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return null;
  var sp = ochaFindParam(mo.properties, "Scale");
  if (!sp) return null;
  try { return sp.getValue(); } catch (e) { return null; }
}

/* Collect the OCHA elements in a sequence and take them out, so the footage can be
   rescaled on its own and the elements can be placed again at reel spec. Returns
   the list; the caller places them back. */
function ochaTakeElements(seq, L) {
  var found = [];
  try {
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
      var cl = seq.videoTracks[t].clips;
      for (var c = 0; c < cl.numItems; c++) {
        var clip = cl[c], nm = "";
        try { nm = clip.name; } catch (e) { continue; }
        if (!OCHA_EL_RE.test(nm)) continue;
        var el = ochaElOfClip(nm);
        if (!el) continue;
        var st = 0, en = 0;
        try { st = clip.start.ticks; en = clip.end.ticks; } catch (e2) {}
        found.push({ el: el, name: nm, track: t, start: st, end: en, kv: ochaTextOfClip(clip, true) || "" });
      }
    }
  } catch (e) { L.push("scan ERR " + e.toString()); }
  /* Remove AFTER the whole scan: removing while iterating renumbers the very
     collection being walked, which silently skips every other clip. */
  var removed = 0;
  for (var f = found.length - 1; f >= 0; f--) {
    try {
      var tr = seq.videoTracks[found[f].track].clips;
      for (var k = tr.numItems - 1; k >= 0; k--) {
        var nm2 = ""; try { nm2 = tr[k].name; } catch (e3) {}
        if (nm2 === found[f].name) { try { tr[k].remove(false, false); removed++; } catch (e4) {} break; }
      }
    } catch (e5) {}
  }
  L.push("elements=" + found.length + " removed=" + removed);
  return found;
}

/* The OCHA clip starting at these ticks. Matched by START TICKS, never by index:
   a track's clip collection is renumbered by every insert. */
function ochaClipAtTicks(seq, ticks) {
  for (var t = seq.videoTracks.numTracks - 1; t >= 0; t--) {
    var cl = seq.videoTracks[t].clips;
    for (var c = 0; c < cl.numItems; c++) {
      var nm = ""; try { nm = cl[c].name; } catch (e) { continue; }
      if (!OCHA_EL_RE.test(nm)) continue;
      var st = ""; try { st = cl[c].start.ticks; } catch (e2) { continue; }
      if (String(st) === String(ticks)) return cl[c];
    }
  }
  return null;
}

/* Place the collected elements back, from the REELS templates, at their original
   times. ochaAdd inserts at the playhead, so the playhead is moved per element. */
function ochaPlaceElements(seq, list, extRoot, L) {
  var ok = 0, failed = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    try { seq.setPlayerPosition(e.start); } catch (e1) {}
    var res = "";
    try { res = ochaAdd(e.el, "reels", extRoot, e.kv, "top"); } catch (e2) { res = "ERR|" + e2.toString(); }
    if (String(res).indexOf("OK") !== 0) { failed.push(e.name); continue; }
    /* Match the original duration. The template's own default length is right for
       a fresh graphic but wrong for one that was timed to a shot. */
    try {
      var placed = ochaClipAtTicks(seq, e.start);
      /* parseFloat, NOT a bare ">": Time.ticks is a STRING, so ">" compares
         lexicographically. At 254016000000 ticks/sec the digit count rolls over
         around 3.9s, so a graphic running 1s to 5s compared FALSE and silently
         kept the template's default length, while 0s to 2s worked - which reads
         as random. Same lesson as ochaSelectedFade's parseFloat on ticks. */
      if (placed && parseFloat(e.end) > parseFloat(e.start)) {
        var tEnd = placed.end;
        tEnd.ticks = String(e.end);
        placed.end = tEnd;
      }
    } catch (e3) {}
    ok++;
  }
  L.push("replaced=" + ok + (failed.length ? " failed=" + failed.join(",") : ""));
  return { ok: ok, failed: failed };
}

/* Clips that are graphics but NOT ours: a title made with Premiere's own Text
   tool, mostly. They are positioned in absolute pixels against the old frame, so
   a 9:16 resize leaves them off-screen - and unlike an OCHA element there is no
   template to re-place them from, so a script cannot lay them out again. Name
   them in the result instead of leaving the user to find them.
   Detected by having no media file behind them (a title has no footage on disk). */
function ochaOtherGraphics(seq) {
  var out = [];
  try {
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
      var cl = seq.videoTracks[t].clips;
      for (var c = 0; c < cl.numItems; c++) {
        var nm = ""; try { nm = cl[c].name; } catch (e) { continue; }
        if (OCHA_EL_RE.test(nm)) continue;                 /* ours: already handled */
        var path = null;
        try { path = cl[c].projectItem.getMediaPath(); } catch (e2) { path = null; }
        if (path) continue;                                /* real footage */
        var isMgt = false;
        try { isMgt = !!cl[c].getMGTComponent(); } catch (e3) { isMgt = false; }
        if (isMgt) continue;                               /* someone else's mogrt */
        out.push(nm);
      }
    }
  } catch (e4) {}
  return out;
}

function ochaSeqHasCaptions(seq) {
  try {
    if (!seq.captionTracks) return false;
    for (var i = 0; i < seq.captionTracks.numTracks; i++) {
      if (seq.captionTracks[i].clips.numItems > 0) return true;
    }
  } catch (e) {}
  return false;
}

/* `dropGradients` - readability gradients are sized for the OLD frame and are
   usually re-made for the new one, so the panel offers to leave them out (ticked
   by default). `tidyTracks` - a conversion routinely leaves empty tracks behind. */
function ochaLandscapeToReel(extRoot, dropGradients, tidyTracks) {
  var L = [];
  try {
    var src = app.project.activeSequence;
    if (!src) return "ERR|Open the sequence first.";
    var w = src.frameSizeHorizontal, h = src.frameSizeVertical;
    var shape = ochaReelShape(src);
    if (shape !== "landscape") return "ERR|'" + src.name + "' isn't landscape (" + w + "x" + h + ").";
    var size = ochaReelSizeFor(w, h, shape);
    var srcName = src.name;
    var hadCaptions = ochaSeqHasCaptions(src);

    /* Work on a CLONE. The clone carries the real clips, cuts, audio and effects,
       so the user can razor and reframe shot by shot; the original is untouched. */
    src.clone();
    var reel = app.project.activeSequence;
    if (!reel || reel.name === srcName) return "ERR|Couldn't duplicate '" + srcName + "'.";
    try { reel.name = srcName + " - Reel"; } catch (eN) {}
    L.push("base=clone");

    /* Elements out BEFORE the resize, so the re-placed ones land in a sequence
       that is already reel-shaped (importMGT sizes to the sequence it enters). */
    var els = ochaTakeElements(reel, L);

    L.push(ochaResizeSeq(reel, size.w, size.h));

    /* Fill the new height. Everything filled the old frame height, so one factor
       covers the lot, and MULTIPLYING preserves any punch-in already dialled in. */
    var factor = size.h / h, scaled = 0, noMotion = 0, keyed = 0;
    for (var t = 0; t < reel.videoTracks.numTracks; t++) {
      var cl = reel.videoTracks[t].clips;
      for (var c = 0; c < cl.numItems; c++) {
        /* A KEYFRAMED Scale (an animated push-in) cannot be moved with setValue:
           Premiere silently ignores the write on a time-varying property, so the
           shot would keep its old scale and show black bars while the tool
           reported success. Count those and name them instead. */
        if (ochaScaleIsKeyed(cl[c])) { keyed++; continue; }
        var cur = ochaGetMotionScale(cl[c]);
        if (cur === null) { noMotion++; continue; }
        ochaSetMotionScale(cl[c], cur * factor);
        scaled++;
      }
    }
    L.push("scaled=" + scaled + "x" + Math.round(factor * 1000) / 1000
      + (noMotion ? " noMotion=" + noMotion : "") + (keyed ? " KEYEDSCALE=" + keyed : ""));

    var keep = [], dropped = 0;
    for (var g = 0; g < els.length; g++) {
      if (dropGradients && els[g].el === "gradient") { dropped++; continue; }
      keep.push(els[g]);
    }
    if (dropped) L.push("gradients-dropped=" + dropped);
    var back = ochaPlaceElements(reel, keep, extRoot, L);
    if (hadCaptions) L.push("captions=carried");

    var others = ochaOtherGraphics(reel);
    if (others.length) L.push("OTHERGFX=" + others.join(", "));

    /* Empty tracks are a normal by-product of taking the graphics out and putting
       them back on a different track. Reuses Tidy tracks' own remover so there is
       one implementation of "remove a track" and its safety checks. */
    if (tidyTracks) {
      var el2 = ochaEmptyTrackList();
      if (el2.indexOf("OK|") === 0) {
        var US2 = String.fromCharCode(31);
        var names2 = el2.split("|")[2] || "";
        var list2 = names2 ? names2.split(US2) : [];
        if (list2.length) L.push("tidy[" + ochaRemoveTracks(list2.join(",")) + "]");
        else L.push("tidy=none");
      }
    }

    return "OK|Reel '" + reel.name + "' " + size.w + "x" + size.h + " / " + L.join(" / ")
      + (back.failed.length ? " / ELFAIL=" + back.failed.join(",") : "");
  } catch (e) { return "ERR|" + L.join(" / ") + " || " + e.toString(); }
}

/* The one entry point the panel calls. */
function ochaToReel(extRoot, dropGradients, tidyTracks) {
  var seq = app.project.activeSequence;
  var shape = ochaReelShape(seq);
  if (shape === "reel") return "ERR|That sequence is already a reel.";
  /* The fill recipe nests the source whole, so its gradients live inside the nest
     where nothing can reach them - the options only apply to the crop recipe. */
  if (ochaReelFills(shape)) return ochaSquareToReel();
  if (shape === "landscape") return ochaLandscapeToReel(extRoot, dropGradients === "1", tidyTracks !== "0");
  return "ERR|Open a square or landscape sequence first.";
}

/* ---------------- reframing a cropped shot ----------------
   The crop is centred by default because where to look is a judgement call no
   script can make. The user razors the shot they want to move and slides it.

   HOLD is one static position. PAN keyframes the same property from one position
   to another across the clip: a deliberate move, chosen by the user, not an
   automatic tween between two framings.

   Motion Position is NORMALIZED (fractions of the frame, 0.5 = centre) while
   Effect Controls shows pixels. Same gotcha the element position sliders hit. */

/* How far the picture can travel before its edge shows, as a fraction of the reel
   width. Derived from the SOURCE sequence, found by name: the reel is always
   "<source> - Reel", so the geometry is recoverable without storing anything. */
function ochaReframeTravel(reel) {
  var fallback = 1.08;                 /* a 16x9 source: (16/9 * 16/9 - 1) / 2 */
  try {
    var nm = reel.name.replace(/ - Reel$/, "");
    if (nm === reel.name) return fallback;
    var sw = 0, sh = 0;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var s = app.project.sequences[i];
      if (s.name === nm) { sw = s.frameSizeHorizontal; sh = s.frameSizeVertical; break; }
    }
    if (!sw || !sh) return fallback;
    var reelW = reel.frameSizeHorizontal, reelH = reel.frameSizeVertical;
    var shownW = sw * (reelH / sh);           /* width after filling the new height */
    var over = shownW - reelW;
    if (over <= 0) return 0;
    return (over / 2) / reelW;
  } catch (e) { return fallback; }
}

/* Travel at the clip's CURRENT zoom: zooming in shows less width, so there is
   more of it to slide. Without this the slider's ends stop matching the picture
   as soon as Zoom leaves 100%. */
function ochaTravelAt(reel, clip) {
  var base = ochaReframeTravel(reel);
  var fill = ochaFillScale(reel);
  var cur = ochaGetMotionScale(clip);
  if (cur === null || !fill) return base;
  var zoom = cur / fill;
  if (!(zoom > 0)) return base;
  var reelW = reel.frameSizeHorizontal;
  /* base is half the overflow over reelW at fill scale; the shown width scales
     with zoom, so re-derive rather than scaling `base` (which is an offset, not
     a width). */
  var shownOverReelW = (base * 2 + 1) * zoom;
  var over = shownOverReelW - 1;
  /* Scaled BELOW the frame (a transparent overlay, an animation) there is no
     overflow to slide - but the thing still needs to be positionable, so allow
     half a frame either way instead of freezing the slider at zero. */
  return over <= 0 ? 0.5 : over / 2;
}

/* The scale at which a clip exactly fills the reel's height, as a percentage.
   Derived from the source sequence the same way travel is. Assumes the clip filled
   the source frame (the normal case); a clip that was already punched in reads a
   little high, which only shifts where 100% sits on the Zoom slider. */
function ochaFillScale(reel) {
  try {
    var nm = reel.name.replace(/ - Reel$/, "");
    if (nm === reel.name) return 100 * 16 / 9;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var s = app.project.sequences[i];
      if (s.name === nm) return 100 * (reel.frameSizeVertical / s.frameSizeVertical);
    }
  } catch (e) {}
  return 100 * 16 / 9;
}

/* The selected PICTURE clip. Skips OCHA graphics on purpose: reframing moves the
   footage under them, never the branding, which has its own position controls. */
function ochaSelectedVideoClip() {
  var seq = app.project.activeSequence;
  if (!seq) return null;
  var sel = null;
  try { sel = seq.getSelection(); } catch (e) { return null; }
  if (!sel) return null;
  var n = 0; try { n = sel.length; } catch (e) { n = 0; }
  for (var i = 0; i < n; i++) {
    var it = sel[i], nm = ""; try { nm = it.name; } catch (e2) {}
    if (OCHA_EL_RE.test(nm)) continue;
    if (ochaFindComp(it, "AE.ADBE Motion")) return it;
  }
  return null;
}

function ochaPosXParam(clip) {
  var mo = ochaFindComp(clip, "AE.ADBE Motion");
  if (!mo) return null;
  return ochaFindParam(mo.properties, "Position");
}

function ochaPctOf(val, travel) {
  var x = 0.5;
  try { x = (val && val.length !== undefined) ? val[0] : val; } catch (e) {}
  if (!travel) return 0;
  /* Negated to match ochaSetReframe's sign, so reading a clip back puts the
     slider where the user left it rather than mirrored. */
  return Math.round(((0.5 - x) / travel) * 100);
}

/* "OK|<clipName>|<mode>|<startPct>|<endPct>|<travelPct>", or a one-word state the
   panel turns into a banner: notreel / noclip / none. Percentages are -100..100 of
   the available travel, which is what the slider shows. */
function ochaReframeInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "none";
    if (ochaReelShape(seq) !== "reel") return "notreel|" + (seq.name || "");
    var clip = ochaSelectedVideoClip();
    if (!clip) return "noclip";
    var nm = ""; try { nm = clip.name; } catch (e) {}
    /* START TICKS are the clip's identity, never the name. Razoring one shot
       gives every piece the SAME clip.name, and razoring is this feature's
       documented workflow - so keying on the name showed piece 1's numbers while
       piece 2 was selected, and one click then wrote them onto piece 2. */
    var idt = ""; try { idt = String(clip.start.ticks); } catch (eI) {}
    var travel = ochaTravelAt(seq, clip);
    var fill = ochaFillScale(seq);
    var curS = ochaGetMotionScale(clip);
    var zoomPct = (curS === null || !fill) ? 100 : Math.round((curS / fill) * 100);
    var p = ochaPosXParam(clip);
    if (!p) return "OK|" + nm + "|hold|0|0|" + Math.round(travel * 100) + "|" + idt + "|" + zoomPct;
    var varying = false;
    try { varying = !!p.isTimeVarying(); } catch (e2) { varying = false; }
    var a = 0, b = 0;
    try {
      if (varying) {
        a = ochaPctOf(p.getValueAtTime(clip.inPoint), travel);   /* clip-relative, as written */
        b = ochaPctOf(p.getValueAtTime(clip.outPoint), travel);
      } else {
        a = ochaPctOf(p.getValue(), travel);
        b = a;
      }
    } catch (e3) {}
    return "OK|" + nm + "|" + (varying ? "pan" : "hold") + "|" + a + "|" + b + "|"
      + Math.round(travel * 100) + "|" + idt + "|" + zoomPct;
  } catch (e) { return "none"; }
}

/* mode "hold": startPct only. mode "pan": startPct at the clip's first frame,
   endPct at its last. Percentages are -100..100 of the available travel. */
/* `zoomPct` is a percentage of the frame-filling scale: 100 = exactly fills, and
   below 100 would show edges, so the panel clamps it there.

   SIGN: a POSITIVE pct moves the picture RIGHT, matching the slider. See the
   note at the offset itself - the direction was settled by testing, not by
   reasoning about the axis. */
function ochaSetReframe(mode, startPct, endPct, zoomPct) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|No sequence.";
    var clip = ochaSelectedVideoClip();
    if (!clip) return "ERR|Select the clip to reframe (razor it first if only part of it is out of frame).";
    var p = ochaPosXParam(clip);
    if (!p) return "ERR|That clip has no Motion to move.";
    /* Zoom FIRST: travel depends on it, so reading travel before the new scale is
       applied would clamp the position against the old width. */
    var z = parseFloat(zoomPct);
    if (!isNaN(z) && z > 0) {
      var fillS = ochaFillScale(seq);
      if (fillS) ochaSetMotionScale(clip, fillS * (z / 100));
    }
    var travel = ochaTravelAt(seq, clip);
    var y = 0.5;
    try { var cur = p.getValue(); if (cur && cur.length !== undefined) y = cur[1]; } catch (e) {}
    /* SIGN SET BY TEST, not by reading the axis: dragging the slider right has to
       move the PICTURE right. Measured the other way round on 2026-08-06, so the
       offset is subtracted. If this is ever "fixed" back to +, the control fights
       the picture again. The read-back in ochaPctOf carries the same sign. */
    var xa = 0.5 - (parseFloat(startPct) / 100) * travel;
    var xb = 0.5 - (parseFloat(endPct) / 100) * travel;

    if (mode === "pan") {
      try { p.setTimeVarying(true); } catch (e1) { return "ERR|Premiere wouldn't allow keyframes on this clip."; }
      /* Clear any earlier pan so a second edit REPLACES it rather than layering a
         new pair of keys on top of the old ones. */
      try {
        var keys = p.getKeys();
        for (var k = keys.length - 1; k >= 0; k--) { try { p.removeKey(keys[k]); } catch (e2) {} }
      } catch (e3) {}
      /* Keyframe times on a TrackItem's parameter are CLIP-relative (the media's
         own time base), not sequence time. Passing clip.start/clip.end put both
         keys outside the clip's own range, where the pan did nothing at all and
         still reported OK. inPoint/outPoint are that same clip-relative base. */
      var kA = clip.inPoint, kB = clip.outPoint;
      try {
        p.addKey(kA); p.setValueAtKey(kA, [xa, y], true);
        p.addKey(kB); p.setValueAtKey(kB, [xb, y], true);
      } catch (e4) { return "ERR|Couldn't set the pan keyframes: " + e4.toString(); }
      return "OK|Pan set on '" + clip.name + "'.";
    }

    try { if (p.isTimeVarying()) p.setTimeVarying(false); } catch (e5) {}
    try { p.setValue([xa, y], true); } catch (e6) { return "ERR|Couldn't move the shot: " + e6.toString(); }
    return "OK|Framing set on '" + clip.name + "'.";
  } catch (e) { return "ERR|" + e.toString(); }
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
   leave the comp). Clips placed with OLDER templates have no such controls -
   they fall back to Motion > Position, whose anchor knows nothing about the
   element (that's why it was replaced), clamped to the frame as before.
   Motion gotcha kept for the fallback: the param is NORMALIZED (fractions of
   the frame, [0.5,0.5] = centre) while Effect Controls displays px - writing
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

/* ---------------------------------------------------------------------------
   COLOUR - looks and basic adjustments, via Lumetri Color.

   Same shape as the reel's Gaussian Blur, which is the one video effect this
   panel already adds successfully: qe.addVideoEffect() to attach it, then the
   normal DOM component to set parameters.

   The NUMBERS are the web app's (engine/look.py). A clip corrected here and one
   corrected in the web app land in the same place - one colour model across both
   products, not two that drift.

   Lumetri's parameter names are not documented for scripting and differ between
   Premiere versions, so every setter tries a LIST of likely names and reports
   which one took. A parameter that cannot be found is reported, never silently
   skipped: "I set 3 of 4" is useful, "done" when nothing happened is not.
   ------------------------------------------------------------------------ */

// Basic Correction parameter aliases, most likely first.
var OCHA_LUMETRI_PARAMS = {
  exposure:   ["Exposure", "Basic Correction/Exposure", "Lumetri Color/Exposure"],
  contrast:   ["Contrast", "Basic Correction/Contrast", "Lumetri Color/Contrast"],
  saturation: ["Saturation", "Basic Correction/Saturation", "Lumetri Color/Saturation"],
  temperature:["Temperature", "White Balance/Temperature", "Basic Correction/Temperature"],
  shadows:    ["Shadows", "Basic Correction/Shadows", "Lumetri Color/Shadows"],
  highlights: ["Highlights", "Basic Correction/Highlights", "Lumetri Color/Highlights"]
};

function ochaLumetriComp(clip) {
  try {
    var comps = clip.components;
    for (var i = 0; i < comps.numItems; i++) {
      var mn = "", dn = "";
      try { mn = comps[i].matchName; } catch (e1) {}
      try { dn = comps[i].displayName; } catch (e2) {}
      if (/lumetri/i.test(mn) || /lumetri/i.test(dn)) return comps[i];
    }
  } catch (e) {}
  return null;
}

// Attach Lumetri if the clip has none yet. Returns the component or null.
function ochaEnsureLumetri(clip, seq, trackIdx, clipIdx, isVideo) {
  var have = ochaLumetriComp(clip);
  if (have) return have;
  try {
    if (typeof qe === "undefined" || !qe) return null;
    var qseq = qe.project.getActiveSequence();
    if (!qseq) return null;
    var qt = qseq.getVideoTrackAt(trackIdx);
    if (!qt) return null;
    // NEVER getItemAt(clipIdx): QE counts EMPTY GAPS as items, so the DOM clip
    // index only lines up when the clip sits at the head of a gapless track.
    // That is why colour "worked with one clip" and failed on the rest
    // (2026-07-31) - and on the wrong layout an index lookup would attach the
    // effect to a DIFFERENT clip. Match the clip by its START TICKS instead,
    // skipping gap items; no match = fail honestly, never guess.
    var wantTicks = "";
    try { wantTicks = String(clip.start.ticks); } catch (eT) {}
    var qc = null, total = 0;
    try { total = qt.numItems; } catch (eNI) {}
    for (var j = 0; j < total && !qc; j++) {
      var it = null;
      try { it = qt.getItemAt(j); } catch (eGI) { it = null; }
      if (!it) continue;
      var ty = ""; try { ty = String(it.type); } catch (eTy) {}
      if (ty && ty.toLowerCase().indexOf("empty") >= 0) continue;
      var tk = ""; try { tk = String(it.start.ticks); } catch (eTk) {}
      if (wantTicks && tk === wantTicks) qc = it;
    }
    var fx = qe.project.getVideoEffectByName("Lumetri Color");
    if (!qc || !fx) return null;
    qc.addVideoEffect(fx);
  } catch (e) { return null; }
  // An effect's parameters attach a BEAT after the effect itself - the same
  // behaviour ochaAdd() already polls for with Graphic Parameters. Reading
  // straight away finds the component with nothing on it.
  var got = null;
  for (var w = 0; w < 8 && !got; w++) {
    got = ochaLumetriComp(clip);
    if (!got) $.sleep(120);
  }
  return got;
}

function ochaSetLumetriParam(comp, key, value) {
  var names = OCHA_LUMETRI_PARAMS[key] || [key];
  for (var i = 0; i < names.length; i++) {
    var p = ochaFindParam(comp.properties, names[i]);
    if (p) {
      try { p.setValue(value, true); return names[i]; } catch (e) {}
    }
  }
  return null;
}

/* Apply adjustments to the selected clips, or to every video clip in the
   sequence when scope is "all".
     b,c,s,w : -100..100, 0 = unchanged (the panel's own scale)
   Returns "OK|<clips>|<detail>" or "ERR|...". */
function ochaApplyColour(b, c, s, w, sh, hi, scope) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open a sequence first.";
    var nb = parseFloat(b) || 0, nc = parseFloat(c) || 0;
    var ns = parseFloat(s) || 0, nw = parseFloat(w) || 0;
    var nsh = parseFloat(sh) || 0, nhi = parseFloat(hi) || 0;

    // Panel scale -> Lumetri units. Ranges deliberately modest: this is for
    // correcting a cast or a dark room, not grading.
    var exposure    = nb / 100 * 1.2;          // stops
    var contrast    = nc;                      // Lumetri contrast is -100..100
    var saturation  = 100 + ns;                // 100 = unchanged
    var temperature = nw;                      // -100..100, 0 = as shot
    // Shadows/Highlights pass straight through as Lumetri's own -100..100.
    // NOT inverted: an earlier version flipped Highlights so that dragging right
    // "recovered" blown areas, but Javi's call is the plain reading - left darker,
    // right brighter, same as Lumetri's own slider (2026-07-31). A control that
    // disagrees with the panel it mirrors is a trap, however well-reasoned.
    var shadows    = nsh;
    var highlights = nhi;

    var all = String(scope) === "all";
    var targets = [], i, j, tr;
    if (all) {
      for (i = 0; i < seq.videoTracks.numTracks; i++) {
        tr = seq.videoTracks[i];
        for (j = 0; j < tr.clips.numItems; j++) targets.push({ c: tr.clips[j], t: i, k: j });
      }
    } else {
      var sel = null;
      try { sel = seq.getSelection(); } catch (eS) {}
      var n = 0; try { n = sel.length; } catch (eN) { n = 0; }
      for (i = 0; i < n; i++) {
        var it = sel[i], mt = "";
        try { mt = String(it.mediaType); } catch (eM) {}
        if (mt && mt.toLowerCase().indexOf("audio") >= 0) continue;
        // find its track/index so QE can reach it
        for (var ti = 0; ti < seq.videoTracks.numTracks; ti++) {
          var t2 = seq.videoTracks[ti];
          for (var ci = 0; ci < t2.clips.numItems; ci++) {
            if (t2.clips[ci].start.ticks === it.start.ticks && t2.clips[ci].name === it.name) {
              targets.push({ c: it, t: ti, k: ci });
              ti = seq.videoTracks.numTracks; break;
            }
          }
        }
      }
      if (!targets.length) return "ERR|Select one or more video clips first, or choose the whole sequence.";
    }

    var done = 0, noFx = 0, missed = {};
    for (i = 0; i < targets.length; i++) {
      var comp = ochaEnsureLumetri(targets[i].c, seq, targets[i].t, targets[i].k, true);
      if (!comp) { noFx++; continue; }
      var okAny = false;
      var pairs = [["exposure", exposure], ["contrast", contrast],
                   ["saturation", saturation], ["temperature", temperature],
                   ["shadows", shadows], ["highlights", highlights]];
      for (j = 0; j < pairs.length; j++) {
        var used = ochaSetLumetriParam(comp, pairs[j][0], pairs[j][1]);
        if (used) okAny = true; else missed[pairs[j][0]] = 1;
      }
      if (okAny) done++;
    }
    var miss = [];
    for (var k in missed) { if (missed.hasOwnProperty(k)) miss.push(k); }
    if (!done) {
      // DIAGNOSTIC, not an apology. Every failure here has three possible causes -
      // no clip found, Lumetri not attachable, or its parameters named differently
      // in this Premiere build - and they need completely different fixes. So say
      // which one it was, and when it is the third, list the names actually present.
      var why = "targets=" + targets.length + " lumetriMissing=" + noFx;
      if (targets.length && !noFx) {
        var first = ochaLumetriComp(targets[0].c);
        var names = [];
        if (first) {
          try {
            for (var q = 0; q < first.properties.numItems && names.length < 25; q++) {
              var dn = ""; try { dn = first.properties[q].displayName; } catch (eD) {}
              if (dn) names.push(dn);
            }
          } catch (eP) {}
        }
        why += " params[" + names.length + "]: " + (names.join(", ") || "none readable");
      }
      return "ERR|Nothing was changed. " + why;
    }
    var detail = "Adjusted " + done + " clip" + (done === 1 ? "" : "s");
    if (noFx) detail += ", skipped " + noFx + " (no Lumetri)";
    if (miss.length) detail += ". Not supported in this Premiere build: " + miss.join(", ");
    return "OK|" + done + "|" + detail + ".";
  } catch (e) { return "ERR|" + e.toString(); }
}

/* Read the selected clip's CURRENT colour back into panel units - the exact
   inverse of ochaApplyColour's maths. Without this the sliders would lie: they
   would sit at zero over a clip that is already graded, and the first nudge would
   throw away everything previously applied.

   "OK|<name>|b|c|s|w|sh|hi" or "none" (nothing selected / no Lumetri on it). The
   clip NAME travels back so the panel can tell "same clip, mid-drag" from "a
   different clip, repopulate". */
function ochaReadColour() {
  try {
    var clip = ochaSelectedClipAny();
    if (!clip) return "none";
    var nm = ""; try { nm = clip.name; } catch (eN) {}
    var comp = ochaLumetriComp(clip);
    if (!comp) return "OK|" + nm + "|0|0|0|0|0|0";      // no grade yet: all neutral
    function get(key, dflt) {
      var names = OCHA_LUMETRI_PARAMS[key] || [key];
      for (var i = 0; i < names.length; i++) {
        var pr = ochaFindParam(comp.properties, names[i]);
        if (pr) { try { var v = pr.getValue(); if (typeof v === "number") return v; } catch (e) {} }
      }
      return dflt;
    }
    var exposure    = get("exposure", 0);
    var contrast    = get("contrast", 0);
    var saturation  = get("saturation", 100);
    var temperature = get("temperature", 0);
    var shadows     = get("shadows", 0);
    var highlights  = get("highlights", 0);
    var b  = Math.round(exposure / 1.2 * 100);
    var c  = Math.round(contrast);
    var sa = Math.round(saturation - 100);
    var w  = Math.round(temperature);
    var sh = Math.round(shadows);
    var hi = Math.round(highlights);
    function cap(x) { return Math.max(-100, Math.min(100, x || 0)); }
    return "OK|" + nm + "|" + cap(b) + "|" + cap(c) + "|" + cap(sa) + "|" +
           cap(w) + "|" + cap(sh) + "|" + cap(hi);
  } catch (e) { return "none"; }
}

/* EMPTY TRACKS - video and audio. Listed first so the user confirms which go:
   removing a track is not undoable in the "obviously fine" way that adding one is,
   and a 16-channel broadcast file can leave a lot of them.

   A track holding a clip is NEVER listed, even if that clip is silent. Deleting
   audio because it happens to be quiet is not a decision a tool should make.

   Returns "OK|<count>|V2<US>V3<US>A5..." - the same shape the tick-list modal
   already consumes for Remove unused. */
function ochaEmptyTrackList() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open a sequence first.";
    var US = String.fromCharCode(31);
    var names = [];
    var i, t, n;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
      t = seq.videoTracks[i];
      n = 0; try { n = t.clips.numItems; } catch (e1) { n = 0; }
      if (n === 0) names.push("V" + (i + 1));
    }
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      t = seq.audioTracks[i];
      n = 0; try { n = t.clips.numItems; } catch (e2) { n = 0; }
      if (n === 0) names.push("A" + (i + 1));
    }
    return "OK|" + names.length + "|" + names.join(US);
  } catch (e) { return "ERR|" + e.toString(); }
}

/* Remove the named tracks, e.g. "V2,A5,A6" (display names, 1-based).

   Premiere's QE removal is called ONE TRACK AT A TIME and the result is VERIFIED
   against the real sequence after every call - the count must drop, and no track
   that held clips may vanish. Two reasons, both earned today:
   - the first version of this tool reported success over a complete no-op (it was
     fed row indexes, parsed nothing, removed nothing, said "Removed").
   - QE's index base is undocumented; if it ever disagrees, the fingerprint check
     catches the wrong-track case after ONE removal and says to press Undo,
     instead of ploughing on.

   HIGHEST INDEX FIRST per type: removing V2 renumbers everything above it. */
function ochaTrackPrints(seq) {
  var f = { v: [], a: [] };
  var i, t, n;
  for (i = 0; i < seq.videoTracks.numTracks; i++) {
    t = seq.videoTracks[i];
    n = 0; try { n = t.clips.numItems; } catch (e1) {}
    f.v.push(n);
  }
  for (i = 0; i < seq.audioTracks.numTracks; i++) {
    t = seq.audioTracks[i];
    n = 0; try { n = t.clips.numItems; } catch (e2) {}
    f.a.push(n);
  }
  return f;
}

function ochaRemoveTracks(csv) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "ERR|Open a sequence first.";
    var qseq = (typeof qe !== "undefined" && qe) ? qe.project.getActiveSequence() : null;
    if (!qseq) return "ERR|This Premiere build does not expose track removal to scripts.";

    var wantV = [], wantA = [];
    var parts = String(csv || "").split(",");
    for (var i = 0; i < parts.length; i++) {
      var raw = (parts[i] || "").replace(/^\s+|\s+$/g, "");
      if (!raw) continue;
      var kind = raw.substring(0, 1).toUpperCase();
      var idx = parseInt(raw.substring(1), 10) - 1;        // "A5" -> 4
      if (isNaN(idx) || idx < 0) continue;
      if (kind === "V") wantV.push(idx); else if (kind === "A") wantA.push(idx);
    }
    if (!wantV.length && !wantA.length) return "ERR|Nothing recognisable to remove (got: " + String(csv).substring(0, 40) + ")";
    var desc = function (a, b) { return b - a; };
    wantV.sort(desc); wantA.sort(desc);

    var goneV = 0, goneA = 0, refused = [], wrong = false;

    function removeOne(kind, idx) {
      var isV = kind === "V";
      var tracks = isV ? app.project.activeSequence.videoTracks : app.project.activeSequence.audioTracks;
      if (idx >= tracks.numTracks) { refused.push(kind + (idx + 1) + " (gone already)"); return true; }
      var n = 0; try { n = tracks[idx].clips.numItems; } catch (eN) {}
      if (n > 0) { refused.push(kind + (idx + 1) + " (not empty any more)"); return true; }
      var before = ochaTrackPrints(app.project.activeSequence);
      try { if (isV) qseq.removeVideoTrack(idx); else qseq.removeAudioTrack(idx); }
      catch (eR) { refused.push(kind + (idx + 1)); return true; }
      var after = ochaTrackPrints(app.project.activeSequence);
      var bArr = isV ? before.v : before.a, aArr = isV ? after.v : after.a;
      if (aArr.length !== bArr.length - 1) { refused.push(kind + (idx + 1) + " (Premiere refused)"); return true; }
      // the expected result is the before-list minus THAT slot; anything else
      // means a different track went - stop and say so, it is one Undo away
      var expect = [];
      for (var k = 0; k < bArr.length; k++) if (k !== idx) expect.push(bArr[k]);
      for (var m = 0; m < expect.length; m++) {
        if (expect[m] !== aArr[m]) { wrong = true; return false; }
      }
      if (isV) goneV++; else goneA++;
      return true;
    }

    var go = true;
    for (var x = 0; x < wantA.length && go; x++) go = removeOne("A", wantA[x]);
    for (var y = 0; y < wantV.length && go; y++) go = removeOne("V", wantV[y]);

    if (wrong) {
      return "ERR|Premiere removed a DIFFERENT track than asked - press Cmd+Z / Ctrl+Z once to undo. This build counts tracks unexpectedly; stopped rather than continue.";
    }
    var gone = goneV + goneA;
    if (!gone) {
      return "ERR|Premiere did not remove " + (refused.length ? refused.join(", ") : "any of them") + ". Sequence > Delete Tracks does the same job from the menu.";
    }
    var msg = "Removed " + gone + " empty track" + (gone === 1 ? "" : "s");
    if (goneV && goneA) msg += " (" + goneV + " video, " + goneA + " audio)";
    if (refused.length) msg += ". Skipped: " + refused.join(", ");
    return "OK|" + gone + "|" + msg + ".";
  } catch (e) { return "ERR|" + e.toString(); }
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
      // to 0-100 - see sizeGroup in the AE builder); panel speaks px
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
    // Font index rides along on the SAME call. Selecting a clip used to cost two
    // round trips (ochaReadMotion + ochaFontStatus) and CEP round trips are the
    // slow part - this is why the panel felt laggier than Premiere's own
    // Properties panel. Empty when the template has no Font control.
    var fi = "";
    var fpR = ochaFontParam(clip);
    if (fpR) { try { fi = String(Math.round(fpR.getValue())); } catch (eF) { fi = ""; } }
    // Fade rides along too, for the same reason as the font: this call already
    // happens on every tick, so reading it here costs nothing, while a separate
    // ochaFadeStatus() would double the traffic. "el|value", both blank when the
    // clip has no adjustable amount.
    var fadeEl = "", fadeVal = "";
    var fd = ochaFadeParam(clip);
    if (fd) {
      fadeEl = fd.el;
      try { fadeVal = String(Math.round(fd.p.getValue())); } catch (eD) { fadeVal = ""; }
    }
    return nm + "|" + x + "|" + y + "|" + w + "|" + h + "|" + mode + "|" + fi
             + "|" + fadeEl + "|" + fadeVal;
  } catch (e) { return "none"; }
}

/* The one "amount" control a placed clip exposes, if any:
     gradient -> Opacity   (the fade)
     vignette -> Amount    (the strength)
   Returns { el, p } or null. Fully guarded - a clip with no MOGRT component, or
   an older template without the control, degrades to "no slider" rather than
   throwing up through ochaReadMotion and unbinding everything. */
function ochaFadeParam(clip) {
  try {
    var nm = ""; try { nm = clip.name; } catch (e0) { return null; }
    var el = ochaElOfClip(nm);
    if (el !== "gradient" && el !== "vignette") return null;
    var mgt = clip.getMGTComponent();
    if (!mgt) return null;
    var want = (el === "gradient") ? "Opacity" : "Amount";
    var p = ochaFindParam(mgt.properties, want);
    return p ? { el: el, p: p } : null;
  } catch (e) { return null; }
}

/* Is a gradient or vignette selected right now, and at what value?
   "<el>|<value>" or "none". Used when a tool modal OPENS, so it can offer to edit
   the selected clip instead of adding a second one. */
function ochaSelectedFade() {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "none";
    var fd = ochaFadeParam(clip);
    if (!fd) return "none";
    var v = 0;
    try { v = Math.round(fd.p.getValue()); } catch (e1) { return "none"; }
    return fd.el + "|" + v;
  } catch (e) { return "none"; }
}

/* Write the fade/strength of the selected gradient or vignette. */
function ochaSetFade(val) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|no OCHA clip selected";
    var fd = ochaFadeParam(clip);
    if (!fd) return "ERR|that clip has no fade control";
    var v = parseFloat(val);
    if (isNaN(v)) return "ERR|bad value";
    if (v < 0) v = 0; if (v > 100) v = 100;
    fd.p.setValue(v, true);
    return "OK|" + Math.round(v);
  } catch (e) { return "ERR|" + e.toString(); }
}

/* ---------------------------------------------------------------------------
   FONT (Advanced settings > Font). The template carries a "Font" dropdown control
   and the panel drives it, exactly the way it already drives Position X/Y and
   Size. A control has to be exposed on the template for getMGTComponent() to see
   it at all, so it also shows as a plain row in Premiere's Properties panel; the
   panel is simply the nicer front end.

   SELF-GATING: a template built before this feature has no "Font" param, so
   ochaReadMotion reports an empty font field and the panel hides the whole
   group. An old installed template degrades quietly instead of offering a
   control that does nothing.
   ------------------------------------------------------------------------ */
function ochaFontParam(clip) {
  // The WHOLE lookup is guarded, not just getMGTComponent. ochaFindParam walks
  // props.numItems, and a throw there would propagate up into ochaReadMotion and
  // make it return "none" - i.e. one odd clip would silently unbind the Position
  // sliders for every clip. A missing font control must degrade, never cascade.
  try {
    var mgt = clip.getMGTComponent();
    if (!mgt) return null;
    return ochaFindParam(mgt.properties, "Font");
  } catch (e) { return null; }
}

function ochaSetFont(idx) {
  try {
    var clip = ochaSelectedOchaClip();
    if (!clip) return "ERR|no OCHA clip selected";
    var fp = ochaFontParam(clip);
    if (!fp) return "ERR|this template has no Font control (rebuild the templates)";
    // 0-BASED from Premiere (Raleway=0, Bebas=1), like "Pin colour". Clamping to a
    // minimum of 1 is what made Raleway select Bebas and Bebas fall off the end.
    var n = parseInt(idx, 10);
    if (isNaN(n) || n < 0) n = 0;
    fp.setValue(n, true);
    return "OK|" + n;
  } catch (e) { return "ERR|" + e.toString(); }
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
function ochaIsBin(it) { try { return !!(it.children && it.children.numItems !== undefined); } catch (e) { return false; } }
function ochaIsSequence(it) { try { return !!(it.isSequence && it.isSequence()); } catch (e) { return false; } }
// a real footage/media item to collect: not a bin, not a sequence, not an OCHA template
function ochaIsMedia(it) {
  if (ochaIsBin(it) || ochaIsSequence(it)) return false;
  var nm = ""; try { nm = it.name; } catch (e) {}
  if (!nm || OCHA_EL_RE.test(nm)) return false;
  return true;
}

// ---- Clean unused MOGRTs ----

// ---- Package project ----
// Copy every file the project depends on into one clean folder (sorted by type)
// beside the .prproj, then save a portable, relinked copy of the project inside
// it. The ORIGINAL project + media are never modified (everything is a copy).
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

// Items that point at a file which ISN'T on disk right now. These used to be
// dropped silently by ochaPkgMediaItems - so an offline clip was never copied,
// never relinked, and the packaged project quietly kept pointing at the
// original. The user only found out later, as a "locate the file" dialog.
function ochaPkgMissingItems() {
  var out = [];
  ochaEachItem(app.project.rootItem, function (it) {
    var p = ""; try { p = it.getMediaPath(); } catch (e) { p = ""; }
    if (p && !new File(p).exists) {
      var nm = ""; try { nm = decodeURI(new File(p).name); } catch (e2) { nm = p; }
      // name for the message, full path for the report file - a bare name tells you
      // nothing about WHY it is offline (moved? renamed? pointing into an old package?)
      out.push({ name: nm, path: p });
    }
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

/* Package a project so it travels.

   THE OPEN PROJECT IS NEVER TOUCHED. An earlier cut used app.project.saveAs() to
   produce the relinked copy, which switches Premiere INTO that copy - so after
   packaging you were unknowingly editing the package, and packaging again
   packaged a package. It also meant relinking went through changeMediaPath(),
   which Premiere flatly refuses for Motion Graphics templates, so MOGRTs could
   never be made to point inside.

   Instead: copy the media, copy the .prproj as a FILE, and rewrite the paths
   inside that copy as text (the panel does it - CEP has Node + zlib). No project
   switching, and templates relink like everything else because Premiere's API
   never gets a say. */
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
    var missing = ochaPkgMissingItems();          // already offline - nothing to copy
    if (!items.length) return "ERR|No media files found on disk to package.";

    // Package what is on screen: save first so the copy matches the current edit.
    try { app.project.save(); } catch (eS) {}

    // 1) copy each unique source file into its category folder (dedupe by path)
    var map = {}, counts = { footage: 0, images: 0, graphics: 0, audio: 0, other: 0 };
    var copied = 0, failed = 0, firstErr = "";
    for (var i = 0; i < items.length; i++) {
      var src = items[i].path;
      if (map[src]) continue;
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

    // 2) copy the PROJECT FILE itself - a plain file copy, so Premiere's state
    //    never changes and the user stays exactly where they were
    var newProj = new File(root.fsName + "/" + ochaSafeName(d.projName) + ".prproj");
    var projCopied = false;
    try { projCopied = new File(projPath).copy(newProj.fsName); } catch (e2) { firstErr = firstErr || e2.toString(); }

    // 3) bundle the OCHA templates folder
    var brandingCopied = 0;
    try {
      var assetDir = new Folder(new File(projPath).parent.fsName + "/" + OCHA_ASSET_DIR);
      if (assetDir.exists) brandingCopied = ochaCopyTree(assetDir, new Folder(root.fsName + "/" + OCHA_ASSET_DIR));
    } catch (e3) {}

    // 4) hand every old->new pair to the panel, which rewrites them inside the
    //    copied .prproj. Sidecar file, not the return string: these are long
    //    absolute paths and packing them into a reply is a truncation bug waiting.
    var fixFile = "", pairs = 0;
    if (projCopied) {
      try {
        var ff = new File(Folder.temp.fsName + "/ocha_pkg_fix.txt");
        ff.encoding = "UTF-8"; ff.lineFeed = "Unix"; ff.open("w");
        ff.write(newProj.fsName);
        for (var k in map) if (map.hasOwnProperty(k)) { ff.write("\n" + k + "\t" + map[k]); pairs++; }
        ff.close();
        fixFile = ff.fsName;
      } catch (e4) { fixFile = ""; }
    }

    // 5) manifest, for the person receiving this
    try {
      var rep = new File(root.fsName + "/_package_report.txt");
      rep.encoding = "UTF-8"; rep.lineFeed = "Unix"; rep.open("w");
      rep.write("OCHA QuickVid - package report\n" + d.projName + "\n\n");
      rep.write("COPIED: " + copied + " file(s)  (footage " + counts.footage + ", images " +
                counts.images + ", graphics " + counts.graphics + ", audio " + counts.audio +
                ", other " + counts.other + ")\n");
      if (brandingCopied) rep.write("OCHA templates bundled: " + brandingCopied + " file(s)\n");
      if (missing.length) {
        rep.write("\nSKIPPED - these were already offline in the project, so there was " +
                  "nothing to copy (" + missing.length + "):\n");
        for (var r = 0; r < missing.length; r++) rep.write("  " + missing[r].name + "\n      " + missing[r].path + "\n");
      }
      rep.close();
    } catch (e5) {}

    var msg = "Packaged " + copied + " file(s) into '" + root.name + "' (footage " + counts.footage +
              ", images " + counts.images + ", graphics " + counts.graphics + ", audio " + counts.audio + ").";
    if (brandingCopied) msg += " Bundled the OCHA branding folder (" + brandingCopied + " template file(s)).";
    if (!projCopied) msg += " NOTE: couldn't copy the project file (" + firstErr + ") - the media is there, but you'll need to copy the .prproj yourself.";
    if (failed) msg += " " + failed + " file(s) failed to copy.";
    // Offline items are NOT a failure of the package: they were already missing
    // before we started. Say it plainly once and move on.
    if (missing.length) msg += " " + missing.length + " item(s) were already offline and were skipped (listed in _package_report.txt).";
    msg += " Your own project is untouched and still open.";
    return "OK|" + msg + (fixFile ? "|fix=" + fixFile : "");
  } catch (e) { return "ERR|" + e.toString(); }
}
