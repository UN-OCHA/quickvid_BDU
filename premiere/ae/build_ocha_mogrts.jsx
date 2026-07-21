// ============================================================================
// OCHA Branding — After Effects MOGRT builder (GENERATED FILE — do not edit
// build_ocha_mogrts.jsx by hand; edit src/builder_template.jsx and re-run
// premiere/ae/make_assets.py, which injects the baked brand data below).
//
// Run in After Effects 2026: File → Scripts → Run Script File…
// Builds, for each QuickVid format (Reels 9:16, Feed 4:5, Square 1:1,
// Event 16:9), four comps with Essential Graphics controls:
//   1. OCHA Lower Third   — name (black on white, uppercase) + title bar
//                           (white on OCHA cyan), staggered left wipe + settle
//                           pan, exit in reverse. Look B, ASG Ukraine reference.
//   2. OCHA Location      — the pin locator: map pin (bottom-tip scale-in with
//                           a subtle rebound) + two cyan bands wiping in.
//   3. OCHA Bug           — vertical white OCHA lockup, top-right, static.
//   4. OCHA Ending        — horizontal white lockup SNAPS on (hold keyframes,
//                           no fade) with the OCHA click; optional black card.
// Then exports each as a .mogrt into premiere/mogrts/<format>/.
//
// Numbers come from browser/brand-lt.json + brand-pin.json (baked in below) —
// the same single source of truth the QuickVid engine renders from.
// Motion parity notes:
//   * the engine's cubic ease-in-out is approximated with AE "easy ease" at
//     66.7% influence (visually identical at these durations);
//   * the pin's back-ease overshoot is reproduced with an exact-peak keyframe
//     (value + time computed from the same maths as engine/pin_locator.py);
//   * intro/outro are protected regions — trim the clip in Premiere and the
//     HOLD stretches while the in/out animations keep their timing.
// ============================================================================

(function () {

var DATA = {
 "lt": {
  "timing": {
   "name_in": 0.5,
   "org_delay": 0.26,
   "org_in": 0.5,
   "org_out": 0.44,
   "name_out_delay": 0.2,
   "name_out": 0.44
  },
  "geometry": {
   "name_ratio": {
    "portrait": 0.02292,
    "square": 0.0306,
    "landscape": 0.0382
   },
   "org_scale": 0.5909,
   "name_pad_x": 0.6,
   "name_pad_y": 0.32,
   "org_pad_x": 0.85,
   "org_pad_y": 0.55,
   "org_line": 1.42,
   "pan": 0.5,
   "letter_spacing": 0.5
  },
  "colors": {
   "name_bg": "#FFFFFF",
   "name_text": "#000000",
   "org_bg": "#009EDB",
   "org_text": "#FFFFFF"
  },
  "fonts": {
   "family": "Raleway",
   "name_weight": 700,
   "org_weight": 500
  },
  "uppercase_name": true
 },
 "pin": {
  "timing": {
   "pin_in": 0.42,
   "line1_delay": 0.18,
   "line1_in": 0.42,
   "line2_delay": 0.16,
   "line2_in": 0.42,
   "line2_out": 0.4,
   "line1_out_delay": 0.14,
   "line1_out": 0.4,
   "pin_out_delay": 0.12,
   "pin_out": 0.36,
   "pin_overshoot": 0.9
  },
  "geometry": {
   "line1_ratio": {
    "portrait": 0.0281,
    "square": 0.0344,
    "landscape": 0.043
   },
   "line2_scale": 0.7,
   "pad_x": 0.66,
   "pad_y": 0.4,
   "line_gap": 0.3,
   "pin_gap": 0.42,
   "pin_scale": 1.05,
   "letter_spacing": 0.3
  },
  "colors": {
   "rect_bg": "#009EDB",
   "text": "#FFFFFF",
   "pin_red": "#ED1847",
   "pin_blue": "#004987"
  },
  "fonts": {
   "family": "Raleway",
   "line1_weight": 800,
   "line2_weight": 500
  }
 },
 "safe": {
  "landscape": {
   "top": 0.06,
   "bottom": 0.09,
   "left": 0.045,
   "right": 0.06
  },
  "portrait": {
   "top": 0.11,
   "bottom": 0.2,
   "left": 0.06,
   "right": 0.06
  },
  "square": {
   "top": 0.08,
   "bottom": 0.1,
   "left": 0.08,
   "right": 0.08
  }
 },
 "formats": [
  {
   "key": "reels",
   "label": "Reels 9x16",
   "w": 1080,
   "h": 1920,
   "orient": "portrait"
  },
  {
   "key": "feed45",
   "label": "Feed 4x5",
   "w": 1080,
   "h": 1350,
   "orient": "portrait"
  },
  {
   "key": "square",
   "label": "Square 1x1",
   "w": 1080,
   "h": 1080,
   "orient": "square"
  },
  {
   "key": "event",
   "label": "Event 16x9",
   "w": 1920,
   "h": 1080,
   "orient": "landscape"
  }
 ],
 "text": {
  "ratio": {
   "portrait": 0.052,
   "square": 0.058,
   "landscape": 0.062
  },
  "color": "#FFFFFF",
  "line_gap": 1.16,
  "letter_spacing": 0,
  "y_frac": 0.56,
  "enter": 0.5,
  "exit": 0.4,
  "rise": 0.045,
  "stagger": 0.09,
  "fonts": {
   "family": "Raleway",
   "weight": 700
  }
 },
 "gradient": {
  "height_frac": 0.45,
  "opacity": 80,
  "feather_frac": 0.75
 },
 "bug_height_frac": 0.065,
 "ending": {
  "logo_frac": 0.054,
  "lead_in": 0.3,
  "hold": 1.5
 },
 "pin_path": {
  "w": 32.0,
  "h": 47.86743,
  "subs": [
   {
    "v": [
     [
      0.0,
      -47.8674
     ],
     [
      -16.0,
      -30.9074
     ],
     [
      -0.85,
      -0.4574
     ],
     [
      0.0,
      0.0
     ],
     [
      0.85,
      -0.4574
     ],
     [
      16.0,
      -30.9074
     ]
    ],
    "i": [
     [
      8.8401,
      0.0
     ],
     [
      0.0,
      -9.36
     ],
     [
      -3.3199,
      -4.78
     ],
     [
      -0.3422,
      0.0
     ],
     [
      -0.1885,
      0.2856
     ],
     [
      0.0,
      8.0599
     ]
    ],
    "o": [
     [
      -8.8401,
      0.0
     ],
     [
      0.0,
      8.0599
     ],
     [
      0.1885,
      0.2856
     ],
     [
      0.3422,
      0.0
     ],
     [
      3.3199,
      -4.78
     ],
     [
      0.0,
      -9.36
     ]
    ]
   },
   {
    "v": [
     [
      0.0,
      -23.9974
     ],
     [
      -8.0,
      -31.9974
     ],
     [
      -0.0,
      -39.9974
     ],
     [
      8.0,
      -31.9974
     ],
     [
      5.6575,
      -26.34
     ]
    ],
    "i": [
     [
      2.1219,
      0.0006
     ],
     [
      0.0,
      4.4183
     ],
     [
      -4.4183,
      0.0
     ],
     [
      0.0,
      -4.4183
     ],
     [
      1.5004,
      -1.5004
     ]
    ],
    "o": [
     [
      -4.4183,
      0.0
     ],
     [
      -0.0,
      -4.4183
     ],
     [
      4.4183,
      -0.0
     ],
     [
      0.0006,
      2.1219
     ],
     [
      -1.5004,
      1.5004
     ]
    ]
   }
  ]
 },
 "assets": {
  "logo_h": "assets/logo_horizontal_white.png",
  "logo_v": "assets/logo_vertical_white.png",
  "click": "assets/OCHA_logo_click.wav"
 }
};

if (!DATA) { alert("This is the template — run make_assets.py to bake the data."); return; }

// ---------------------------------------------------------------- helpers
var SCRIPT_DIR = File($.fileName).parent;                 // …/premiere/ae
var MOGRT_ROOT = SCRIPT_DIR.parent.fsName + "/mogrts";    // …/premiere/mogrts

function hex2rgb(h) {
  return [parseInt(h.substr(1, 2), 16) / 255,
          parseInt(h.substr(3, 2), 16) / 255,
          parseInt(h.substr(5, 2), 16) / 255];
}

// Cubic ease-in-out stand-in: speed 0, influence 66.7 on both sides.
function easeArr(prop) {
  var n;
  if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
      prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) n = 1;
  else if (prop.value instanceof Array) n = prop.value.length;
  else n = 1;
  var arr = [];
  for (var i = 0; i < n; i++) arr.push(new KeyframeEase(0, 66.7));
  return arr;
}

// Two eased keyframes (the workhorse for every wipe / pan / scale move).
function key2(prop, t1, v1, t2, v2) {
  prop.setValueAtTime(t1, v1);
  prop.setValueAtTime(t2, v2);
  var e = easeArr(prop);
  var k1 = prop.nearestKeyIndex(t1), k2 = prop.nearestKeyIndex(t2);
  prop.setTemporalEaseAtKey(k1, e, e);
  prop.setTemporalEaseAtKey(k2, e, e);
}

function holdKey(prop, t, v) {
  prop.setValueAtTime(t, v);
  var k = prop.nearestKeyIndex(t);
  prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD,
                                    KeyframeInterpolationType.HOLD);
}

function setText(layer, str, psFont, sizePx, rgb, trackingPx) {
  var st = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var td = st.value;
  td.resetCharStyle();
  td.font = psFont;
  td.fontSize = sizePx;
  td.fillColor = rgb;
  td.applyStroke = false;
  td.applyFill = true;
  td.justification = ParagraphJustification.LEFT_JUSTIFY;
  // AE tracking is 1/1000 em (INTEGER only); the brand spec gives absolute px
  // at this size — round to the nearest thousandth-em unit.
  td.tracking = trackingPx ? Math.round((trackingPx / sizePx) * 1000) : 0;
  st.setValue(td);
  return layer;
}

// Rectangle shape layer whose geometry lives on expressions (responsive width).
// Origin = the rect's TOP-LEFT (so wipes anchor on the left edge).
function rectLayer(comp, name, fillHex, sizeExpr, posExpr) {
  var lyr = comp.layers.addShape();
  lyr.name = name;
  var grp = lyr.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  grp.name = "box";
  var rect = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
  rect.property("ADBE Vector Rect Size").expression = sizeExpr;
  // keep the rect's top-left pinned to the layer origin whatever its width
  rect.property("ADBE Vector Rect Position").expression =
    "var s = thisProperty.propertyGroup(1)('Size');\n[s[0]/2, s[1]/2];";
  var fill = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
  fill.property("ADBE Vector Fill Color").setValue(hex2rgb(fillHex));
  lyr.transform.position.expression = posExpr;
  return lyr;
}

// New-style track matte (AE 23+): one matte layer can serve several consumers.
function applyMatte(consumers, matteLayer) {
  for (var i = 0; i < consumers.length; i++) {
    if (typeof consumers[i].setTrackMatte !== "function")
      throw new Error("This script needs After Effects 23 or newer (layer.setTrackMatte).");
    consumers[i].setTrackMatte(matteLayer, TrackMatteType.ALPHA);
  }
  matteLayer.enabled = false;
}

function protectRegions(comp, enterEnd, exitDur) {
  var mIn = new MarkerValue("intro"); mIn.duration = enterEnd; mIn.protectedRegion = true;
  var mOut = new MarkerValue("outro"); mOut.duration = exitDur; mOut.protectedRegion = true;
  comp.markerProperty.setValueAtTime(0, mIn);
  comp.markerProperty.setValueAtTime(comp.duration - exitDur, mOut);
}

function addEGP(prop, comp, label) {
  if (prop.canAddToMotionGraphicsTemplate && !prop.canAddToMotionGraphicsTemplate(comp)) return false;
  if (typeof prop.addToMotionGraphicsTemplateAs === "function")
    return prop.addToMotionGraphicsTemplateAs(comp, label);
  return prop.addToMotionGraphicsTemplate(comp);
}

function ctlNull(comp) {
  var n = comp.layers.addNull(comp.duration);
  n.name = "Controls";
  n.enabled = false;
  return n;
}

function addCheckbox(ctl, label, on) {
  var fx = ctl.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
  fx.name = label;
  fx.property(1).setValue(on ? 1 : 0);
  return fx;
}

function addSlider(ctl, label, v) {
  var fx = ctl.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
  fx.name = label;
  fx.property(1).setValue(v);
  return fx;
}

// A "Size" slider (on the comp's Controls) that scales the WHOLE element about a
// pinned anchor — so a per-video "make it bigger/smaller" grows in place instead
// of drifting off its safe corner the way native Motion→Scale does.
//   Trick: a parent null whose position == anchorPoint == the anchor point is
//   IDENTITY at 100% (children keep their comp-coord expressions untouched) and
//   scales purely about that point otherwise: child_world = A + (Size/100)*(child - A).
// `axExpr`/`ayExpr` are expression-string comp coords for the anchor.
function sizeGroup(comp, layers, axExpr, ayExpr) {
  var n = comp.layers.addNull(comp.duration);
  n.name = "Size anchor";
  n.enabled = false;
  var pe = "[" + axExpr + ", " + ayExpr + "]";
  n.transform.position.expression = pe;
  n.transform.anchorPoint.expression = pe;
  n.transform.scale.expression =
    "var z = thisComp.layer('Controls').effect('Size')('Slider'); [z, z];";
  for (var i = 0; i < layers.length; i++) if (layers[i]) layers[i].parent = n;
  return n;
}

// ---------------------------------------------------------------- project
// The .mogrt export writes files, which AE gates behind Preferences >
// Scripting & Expressions > "Allow Scripts to Write Files…". Try to grant it
// programmatically (works on current AE); the checkbox is the manual fallback.
try {
  if (typeof PREF_Type_MACHINE_INDEPENDENT !== "undefined")
    app.preferences.savePrefAsLong("Main Pref Section v2",
      "Pref_SCRIPTING_FILE_NETWORK_SECURITY", 1, PREF_Type_MACHINE_INDEPENDENT);
  else
    app.preferences.savePrefAsLong("Main Pref Section v2",
      "Pref_SCRIPTING_FILE_NETWORK_SECURITY", 1);
  app.preferences.saveToDisk();
} catch (ePref) { /* fall back to the manual checkbox */ }

app.beginUndoGroup("OCHA Branding — build MOGRTs");
app.beginSuppressDialogs();

var proj = app.project ? app.project : app.newProject();
var GEN = "OCHA Branding [generated]";
for (var it = proj.numItems; it >= 1; it--)                 // idempotent re-runs
  if (proj.item(it) instanceof FolderItem && proj.item(it).name === GEN)
    proj.item(it).remove();
var root = proj.items.addFolder(GEN);

function importAsset(rel) {
  var f = new File(SCRIPT_DIR.fsName + "/" + rel);
  if (!f.exists) throw new Error("Missing asset: " + f.fsName + " — run make_assets.py first.");
  var item = proj.importFile(new ImportOptions(f));
  item.parentFolder = root;
  return item;
}

// Incremental log — flushed line by line so outside automation (and a curious
// human) can watch progress live; also the post-mortem when something dies.
function log(line) {
  try {
    var f = new File(SCRIPT_DIR.fsName + "/build_log.txt");
    f.encoding = "UTF-8";
    f.lineFeed = "Unix";
    f.open("a");
    f.writeln(new Date().toTimeString().substr(0, 8) + "  " + line);
    f.close();
  } catch (e) { /* best-effort */ }
}
log("=== run start (AE " + app.version + ") ===");

importAsset(DATA.assets.logo_h);
importAsset(DATA.assets.logo_v);
importAsset(DATA.assets.click);
log("assets imported");

// exportAsMotionGraphicsTemplate INVALIDATES every project reference (project,
// folders, footage items). All builders therefore go through this state object,
// re-resolved by NAME before each build.
function baseName(rel) { return rel.split("/").pop(); }
var S = { proj: null, root: null, logoH: null, logoV: null, click: null };
function refresh() {
  S.proj = app.project;
  S.root = null;
  for (var i = 1; i <= S.proj.numItems; i++)
    if (S.proj.item(i) instanceof FolderItem && S.proj.item(i).name === GEN) {
      S.root = S.proj.item(i);
      break;
    }
  if (!S.root) throw new Error("generated folder vanished");
  for (var k = 1; k <= S.root.numItems; k++) {
    var it2 = S.root.item(k);
    if (it2.name === baseName(DATA.assets.logo_h)) S.logoH = it2;
    else if (it2.name === baseName(DATA.assets.logo_v)) S.logoV = it2;
    else if (it2.name === baseName(DATA.assets.click)) S.click = it2;
  }
}
refresh();

var LT = DATA.lt, PIN = DATA.pin;
var CAP_CENTER = 0.355;   // alphabetic-baseline offset for vertically-centred text
                          // (≈ half Raleway's cap height). Tweak here if the name/
                          // pin lines sit a hair high or low vs the engine render.
var results = [], failures = [];

// ---------------------------------------------------------------- lower third
function buildLT(fmt) {
  var W = fmt.w, H = fmt.h, safe = DATA.safe[fmt.orient];
  var G = LT.geometry, T = LT.timing, C = LT.colors;
  var NSIZE = Math.max(20, Math.round(H * G.name_ratio[fmt.orient]));
  var OSIZE = Math.max(12, Math.round(NSIZE * G.org_scale));
  var NPX = Math.round(NSIZE * G.name_pad_x), NPY = Math.round(NSIZE * G.name_pad_y);
  var OPX = Math.round(OSIZE * G.org_pad_x), OPY = Math.round(OSIZE * G.org_pad_y);
  var OLINE = Math.round(OSIZE * G.org_line);
  var NH = NSIZE + 2 * NPY;
  var PAN = Math.round(NSIZE * G.pan);
  var SAFEL = Math.round(safe.left * W);
  var BOT = Math.round(H - safe.bottom * H - 0.02 * H);   // block bottom (engine place())
  var ENTER = T.org_delay + T.org_in, EXIT = T.name_out_delay + T.name_out;
  var HOLD = 3.6, DUR = ENTER + HOLD + EXIT;

  var comp = S.proj.items.addComp("OCHA Lower Third - " + fmt.label, W, H, 1, DUR, 30);
  comp.parentFolder = S.root;

  // shared expression fragments (numbers baked per format)
  // sourceRectAtTime THROWS on an empty text layer — every width lookup is
  // therefore gated on the (trimmed) text having content.
  var ohExpr =
    "var t1 = ('' + thisComp.layer('LT Title 1').text.sourceText).replace(/^\\s+|\\s+$/g, '');\n" +
    "var t2 = ('' + thisComp.layer('LT Title 2').text.sourceText).replace(/^\\s+|\\s+$/g, '');\n" +
    "var lines = (t1.length ? 1 : 0) + (t2.length ? 1 : 0);\n" +
    "var oh = lines ? (2*" + OPY + " + " + OSIZE + " + (lines - 1) * " + OLINE + ") : 0;\n";
  var centreExpr = "var c = thisComp.layer('Controls').effect('Centre align')('Checkbox') > 0;\n";
  var nwExpr = "var nr = thisComp.layer('LT Name').sourceRectAtTime(time, false);\n" +
               "var nw = nr.width + 2*" + NPX + ";\n";
  var owExpr = "var w1 = t1.length ? thisComp.layer('LT Title 1').sourceRectAtTime(time, false).width : 0;\n" +
               "var w2 = t2.length ? thisComp.layer('LT Title 2').sourceRectAtTime(time, false).width : 0;\n" +
               "var ow = Math.max(w1, w2) + 2*" + OPX + ";\n";

  // --- name block (static position; wipes via matte) ---
  var nameSize = nwExpr + "[nw, " + NH + "];";
  var namePos = centreExpr + nwExpr + ohExpr +
    "var x = c ? (thisComp.width - nw)/2 : " + SAFEL + ";\n" +
    "[x, " + BOT + " - oh - " + NH + "];";
  var nameBand = rectLayer(comp, "LT Name band", C.name_bg, nameSize, namePos);
  var nameMatte = rectLayer(comp, "LT Name matte", "#FFFFFF", nameSize, namePos);

  var nameText = comp.layers.addText("NAME SURNAME");
  nameText.name = "LT Name";
  setText(nameText, "NAME SURNAME", LT.fonts.family + "-Bold", NSIZE,
          hex2rgb(C.name_text), G.letter_spacing);
  if (LT.uppercase_name)
    nameText.property("ADBE Text Properties").property("ADBE Text Document").expression =
      "('' + value).toUpperCase();";
  nameText.transform.position.expression = centreExpr + ohExpr +
    "var r = thisLayer.sourceRectAtTime(time, false);\n" +
    "var nw = r.width + 2*" + NPX + ";\n" +
    "var x = (c ? (thisComp.width - nw)/2 : " + SAFEL + ") + " + NPX + " - r.left;\n" +
    "[x, " + BOT + " - oh - " + (NH / 2) + " - r.top - r.height/2];";   // ink-centre in the name band

  // --- title block (parented to a mover null for the settle pan) ---
  var mover = comp.layers.addNull(DUR);
  mover.name = "LT Title mover";
  mover.enabled = false;

  var orgSize = ohExpr + owExpr + "[ow, oh];";
  var orgPos = centreExpr + ohExpr + owExpr +
    "var x = c ? (thisComp.width - ow)/2 : " + SAFEL + ";\n" +
    "[x, " + BOT + " - oh];";
  var orgBand = rectLayer(comp, "LT Title band", C.org_bg, orgSize, orgPos);
  orgBand.transform.opacity.expression = ohExpr + "oh ? 100 : 0;";
  var orgMatte = rectLayer(comp, "LT Title matte", "#FFFFFF", orgSize, orgPos);

  function titleLayer(n, defTxt, startEmpty) {
    var t = comp.layers.addText(defTxt);           // never CREATE empty —
    t.name = "LT Title " + n;                      // styling needs glyphs
    setText(t, defTxt, LT.fonts.family + "-Medium", OSIZE, hex2rgb(C.org_text), 0);
    if (startEmpty) {                              // blank AFTER styling
      var st = t.property("ADBE Text Properties").property("ADBE Text Document");
      var td = st.value; td.text = ""; st.setValue(td);
    }
    t.transform.position.expression = centreExpr + ohExpr + owExpr +
      "var me = ('' + text.sourceText).replace(/^\\s+|\\s+$/g, '');\n" +
      "var r = me.length ? thisLayer.sourceRectAtTime(time, false) : {left:0, width:0, top:0, height:0};\n" +
      "var bx = c ? (thisComp.width - ow)/2 : " + SAFEL + ";\n" +
      "var x = (c ? bx + (ow - r.width)/2 : bx + " + OPX + ") - r.left;\n" +
      // ink-centre this line in its equal row of the org band (1 or 2 lines)
      "var rowH = oh / Math.max(1, lines);\n" +
      "var rc = (" + BOT + " - oh) + (" + n + " - 0.5) * rowH;\n" +
      "[x, rc - r.top - r.height/2];";
    if (n === 2) t.transform.opacity.expression =
      "('' + text.sourceText).replace(/^\\s+|\\s+$/g, '').length ? 100 : 0;";
    return t;
  }
  var t1 = titleLayer(1, "Job title, Duty station", false);
  var t2 = titleLayer(2, "Second line", true);

  applyMatte([nameBand, nameText], nameMatte);
  applyMatte([orgBand, t1, t2], orgMatte);
  orgBand.parent = mover; orgMatte.parent = mover; t1.parent = mover; t2.parent = mover;

  // --- motion (matches engine/lower_third.py state()) ---
  key2(nameMatte.transform.scale, 0, [0, 100], T.name_in, [100, 100]);
  key2(orgMatte.transform.scale, T.org_delay, [0, 100], T.org_delay + T.org_in, [100, 100]);
  key2(mover.transform.position, T.org_delay, [PAN, 0], T.org_delay + T.org_in, [0, 0]);
  var E0 = DUR - EXIT;
  key2(orgMatte.transform.scale, E0, [100, 100], E0 + T.org_out, [0, 100]);
  key2(mover.transform.position, E0, [0, 0], E0 + T.org_out, [PAN, 0]);
  key2(nameMatte.transform.scale, E0 + T.name_out_delay, [100, 100], DUR, [0, 100]);

  var ctl = ctlNull(comp);
  addCheckbox(ctl, "Centre align", false);
  addSlider(ctl, "Size", 100);
  // scale the whole strip about its pinned corner (bottom-left, or bottom-centre
  // when centred) via the Size slider — stays put while resizing.
  sizeGroup(comp, [nameBand, nameMatte, nameText, mover],
            "(thisComp.layer('Controls').effect('Centre align')('Checkbox') > 0 ? thisComp.width/2 : " + SAFEL + ")",
            "" + BOT);

  protectRegions(comp, ENTER, EXIT);
  comp.motionGraphicsTemplateName = comp.name;
  // Add in REVERSE of the desired display order: AE prepends each control to the
  // Essential Graphics list, so the last added shows at the TOP. Desired top→bottom
  // (matching the on-screen stack): Name, Title, Title line 2, Centre align, Size.
  addEGP(ctl.effect("Size").property(1), comp, "Size");
  addEGP(ctl.effect("Centre align").property(1), comp, "Centre align");
  addEGP(t2.property("ADBE Text Properties").property("ADBE Text Document"), comp, "Title line 2 (optional)");
  addEGP(t1.property("ADBE Text Properties").property("ADBE Text Document"), comp, "Title");
  addEGP(nameText.property("ADBE Text Properties").property("ADBE Text Document"), comp, "Name");
  return comp;
}

// ---------------------------------------------------------------- pin locator
function buildPin(fmt) {
  var W = fmt.w, H = fmt.h, safe = DATA.safe[fmt.orient];
  var G = PIN.geometry, T = PIN.timing, C = PIN.colors;
  var S1 = Math.max(16, Math.round(H * G.line1_ratio[fmt.orient]));
  var S2 = Math.max(12, Math.round(S1 * G.line2_scale));
  var PADX = Math.round(S1 * G.pad_x), PADY = Math.round(S1 * G.pad_y);
  var GAP = Math.round(S1 * G.line_gap), PINGAP = Math.round(S1 * G.pin_gap);
  var BOXH = 2 * PADY + S1 + GAP + S2;
  var PINH = Math.round(BOXH * G.pin_scale);
  var PINW = Math.round(PINH * DATA.pin_path.w / DATA.pin_path.h);
  var SPLIT = PADY + S1 + Math.round(GAP / 2);
  var SHIFT = PINW + PINGAP;
  var SAFEL = Math.round(safe.left * W), SAFET = Math.round(safe.top * H);
  var ENTER = Math.max(T.pin_in, T.line1_delay + T.line1_in,
                       T.line1_delay + T.line2_delay + T.line2_in);
  var EXIT = Math.max(T.line2_out, T.line1_out_delay + T.line1_out,
                      T.pin_out_delay + T.pin_out);
  var HOLD = 5.0 - ENTER - EXIT, DUR = 5.0;      // QuickVid default duration = 5s total

  var comp = S.proj.items.addComp("OCHA Location - " + fmt.label, W, H, 1, DUR, 30);
  comp.parentFolder = S.root;

  var ckExpr = "var ck = thisComp.layer('Controls').effect('Show pin icon')('Checkbox') > 0;\n";
  var boxXExpr = ckExpr + "var bx = " + SAFEL + " + (ck ? " + SHIFT + " : 0);\n";
  var boxYExpr = ckExpr + "var by = ck ? " + (SAFET + Math.round((PINH - BOXH) / 2)) +
                 " : " + SAFET + ";\n";
  // each band hugs ITS OWN line's text (place band = place width, date band =
  // date width) — a shared max width left the shorter line with a cyan overhang.
  function band(name, y0, h, txtLayer) {
    var size = "var pp = ('' + thisComp.layer('" + txtLayer + "').text.sourceText).replace(/^\\s+|\\s+$/g, '');\n" +
               "var bw = pp.length ? thisComp.layer('" + txtLayer + "').sourceRectAtTime(time, false).width + 2*" + PADX + " : 0;\n" +
               "[bw, " + h + "];";
    var pos = boxXExpr + boxYExpr + "[bx, by + " + y0 + "];";
    return { band: rectLayer(comp, name + " band", C.rect_bg, size, pos),
             matte: rectLayer(comp, name + " matte", "#FFFFFF", size, pos) };
  }
  var b1 = band("Pin line 1", 0, SPLIT, "Pin place");
  var b2 = band("Pin line 2", SPLIT, BOXH - SPLIT, "Pin date");

  function pinText(name, defTxt, font, size, bc, trackPx) {   // bc = band centre (rel. to by)
    var t = comp.layers.addText(defTxt);
    t.name = name;
    setText(t, defTxt, font, size, hex2rgb(C.text), trackPx);
    // centre the MEASURED glyph box in the BAND (bc = band centre relative to by).
    // Targeting the typographic slot instead left place 7px low / date 7px high
    // (the slot sits ~7px off the band centre); band-centre is what reads centred.
    t.transform.position.expression = boxXExpr + boxYExpr +
      "var r = thisLayer.sourceRectAtTime(time, false);\n" +
      "[bx + " + PADX + " - r.left, by + " + bc + " - r.top - r.height/2];";
    return t;
  }
  var place = pinText("Pin place", "City, Country", PIN.fonts.family + "-ExtraBold",
                      S1, SPLIT / 2, G.letter_spacing);                 // ink-centre in band 1
  var date = pinText("Pin date", "Month 2026", PIN.fonts.family + "-Medium",
                     S2, SPLIT + (BOXH - SPLIT) / 2, 0);                 // ink-centre in band 2

  applyMatte([b1.band, place], b1.matte);
  applyMatte([b2.band, date], b2.matte);

  // --- the pin icon: exact SVG path, tip-anchored so it grows bottom→top ---
  var icon = comp.layers.addShape();
  icon.name = "Pin icon";
  var g = icon.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "pin";
  for (var sp = 0; sp < DATA.pin_path.subs.length; sp++) {
    var sub = DATA.pin_path.subs[sp];
    var shp = new Shape();
    shp.vertices = sub.v; shp.inTangents = sub.i; shp.outTangents = sub.o; shp.closed = true;
    var pathGrp = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
    pathGrp.property("ADBE Vector Shape").setValue(shp);
  }
  var fill = g.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
  fill.property("ADBE Vector Fill Rule").setValue(2);       // even-odd → the hole
  fill.property("ADBE Vector Fill Color").expression =
    "var m = thisComp.layer('Controls').effect('Pin colour')('Menu');\n" +
    "m == 1 ? " + "[" + hex2rgb(C.pin_red).join(",") + ",1] : [" +
    hex2rgb(C.pin_blue).join(",") + ",1];";
  // static size via the group transform; the LAYER scale carries the animation
  g.property("ADBE Vector Transform Group").property("ADBE Vector Scale")
    .setValue([PINH / DATA.pin_path.h * 100, PINH / DATA.pin_path.h * 100]);
  icon.transform.position.setValue([SAFEL + PINW / 2, SAFET + PINH]);   // tip
  icon.transform.opacity.expression = ckExpr + "ck ? 100 : 0;";

  // --- motion (mirrors engine/pin_locator.py state()) ---
  var s = T.pin_overshoot;
  var scl = icon.transform.scale;
  if (s > 0) {                                   // exact overshoot crest, then settle
    var u = -2 * s / (3 * (s + 1));
    var peak = (1 + (s + 1) * Math.pow(u, 3) + s * u * u) * 100;
    var tPeak = T.pin_in * (1 + u);
    key2(scl, 0, [0, 0], tPeak, [peak, peak]);
    key2(scl, tPeak, [peak, peak], T.pin_in, [100, 100]);
  } else {
    key2(scl, 0, [0, 0], T.pin_in, [100, 100]);
  }
  key2(b1.matte.transform.scale, T.line1_delay, [0, 100],
       T.line1_delay + T.line1_in, [100, 100]);
  key2(b2.matte.transform.scale, T.line1_delay + T.line2_delay, [0, 100],
       T.line1_delay + T.line2_delay + T.line2_in, [100, 100]);
  var E0 = DUR - EXIT;
  key2(b2.matte.transform.scale, E0, [100, 100], E0 + T.line2_out, [0, 100]);
  key2(b1.matte.transform.scale, E0 + T.line1_out_delay, [100, 100],
       E0 + T.line1_out_delay + T.line1_out, [0, 100]);
  key2(scl, E0 + T.pin_out_delay, [100, 100],
       E0 + T.pin_out_delay + T.pin_out, [0, 0]);

  var ctl = ctlNull(comp);
  // setPropertyParameters REPLACES the dropdown effect (old references go
  // stale), and adding the checkbox after invalidates references again —
  // so rename via the parade by index, and re-fetch by name for the EGP.
  var parade = ctl.property("ADBE Effect Parade");
  var dd = parade.addProperty("ADBE Dropdown Control");
  dd.property(1).setPropertyParameters(["Red", "Blue"]);
  parade.property(parade.numProperties).name = "Pin colour";
  addCheckbox(ctl, "Show pin icon", true);
  addSlider(ctl, "Size", 100);
  // scale the whole strip (bands + text + pin) about the top-left safe corner
  sizeGroup(comp, [b1.band, b1.matte, b2.band, b2.matte, place, date, icon],
            "" + SAFEL, "" + SAFET);

  protectRegions(comp, ENTER, EXIT);
  comp.motionGraphicsTemplateName = comp.name;
  // reverse order (AE prepends) → displays top→bottom: Place, Date, Pin colour, Show pin icon, Size
  addEGP(ctl.effect("Size").property(1), comp, "Size");
  addEGP(ctl.effect("Show pin icon").property(1), comp, "Show pin icon");
  addEGP(ctl.effect("Pin colour").property(1), comp, "Pin colour");
  addEGP(date.property("ADBE Text Properties").property("ADBE Text Document"), comp, "Date");
  addEGP(place.property("ADBE Text Properties").property("ADBE Text Document"), comp, "Place");
  return comp;
}

// ---------------------------------------------------------------- bug
function buildBug(fmt) {
  var W = fmt.w, H = fmt.h, safe = DATA.safe[fmt.orient];
  var comp = S.proj.items.addComp("OCHA Bug - " + fmt.label, W, H, 1, 5, 30);
  comp.parentFolder = S.root;
  var lyr = comp.layers.add(S.logoV);
  lyr.name = "OCHA bug";
  var targetH = H * DATA.bug_height_frac;
  var sc = targetH / S.logoV.height * 100;
  var w = S.logoV.width * sc / 100;
  lyr.transform.scale.setValue([sc, sc]);
  lyr.transform.position.setValue([W - Math.round(safe.right * W) - w / 2,
                                   Math.round(safe.top * H) + targetH / 2]);
  var ctl = ctlNull(comp);
  addSlider(ctl, "Opacity", 100);
  addSlider(ctl, "Size", 100);
  lyr.transform.opacity.expression =
    "thisComp.layer('Controls').effect('Opacity')('Slider');";
  sizeGroup(comp, [lyr], "" + (W - Math.round(safe.right * W)), "" + Math.round(safe.top * H));
  comp.motionGraphicsTemplateName = comp.name;
  addEGP(ctl.effect("Size").property(1), comp, "Size");        // display: Opacity, Size
  addEGP(ctl.effect("Opacity").property(1), comp, "Opacity");
  return comp;
}

// ---------------------------------------------------------------- ending
function buildEnding(fmt) {
  var W = fmt.w, H = fmt.h;
  var E = DATA.ending;
  var DUR = E.lead_in + E.hold;                   // 0.3s lead (click attack) + 1.5s hold
  var comp = S.proj.items.addComp("OCHA Ending - " + fmt.label, W, H, 1, DUR, 30);
  comp.parentFolder = S.root;

  var black = comp.layers.addSolid([0, 0, 0], "Black card", W, H, 1, DUR);
  holdKey(black.transform.opacity, 0, 0);
  holdKey(black.transform.opacity, E.lead_in, 100);
  black.transform.opacity.expression =
    "value * (thisComp.layer('Controls').effect('Over black')('Checkbox') > 0 ? 1 : 0);";

  var lyr = comp.layers.add(S.logoH);
  lyr.name = "OCHA logo";
  var sc = (H * E.logo_frac) / S.logoH.height * 100;
  lyr.transform.scale.setValue([sc, sc]);
  lyr.transform.position.setValue([W / 2, H / 2]);
  holdKey(lyr.transform.opacity, 0, 0);           // SNAP on — hold keys, never a fade
  holdKey(lyr.transform.opacity, E.lead_in, 100);

  var au = comp.layers.add(S.click);
  au.name = "Click";
  au.startTime = 0;
  if (au.outPoint > DUR) au.outPoint = DUR;

  var ctl = ctlNull(comp);
  addCheckbox(ctl, "Over black", false);
  addSlider(ctl, "Size", 100);
  sizeGroup(comp, [lyr], "" + (W / 2), "" + (H / 2));   // logo only, scales about frame centre
  var mv = new MarkerValue("ending"); mv.duration = DUR; mv.protectedRegion = true;
  comp.markerProperty.setValueAtTime(0, mv);      // fixed piece — protect it all
  comp.motionGraphicsTemplateName = comp.name;
  addEGP(ctl.effect("Size").property(1), comp, "Size");        // display: Over black, Size
  addEGP(ctl.effect("Over black").property(1), comp, "Over black");
  return comp;
}

// ---------------------------------------------------------------- text on screen
// Emphasis text: white Raleway Bold, left-aligned, typed by the editor into the
// Essential Graphics "Text" field. Rises into place + fades in, holds, fades out.
// Placement is a sensible default (left safe margin, lower-middle, like the
// reference clip); the panel's Size & position X/Y nudges it per shot via the
// clip's native Motion, so no position control is exposed here.
function buildText(fmt) {
  var W = fmt.w, H = fmt.h, safe = DATA.safe[fmt.orient], T = DATA.text;
  var DUR = 5, LINES = 3;
  var comp = S.proj.items.addComp("OCHA Text - " + fmt.label, W, H, 1, DUR, 30);
  comp.parentFolder = S.root;

  var size = Math.round(H * T.ratio[fmt.orient]);
  var px = Math.round(safe.left * W);
  var py = Math.round(H * T.y_frac);
  var lineH = Math.round(size * T.line_gap);
  var rise = Math.round(H * T.rise);
  var stagger = T.stagger;
  var DEFAULTS = ["YOUR TEXT HERE", "", ""];

  // THREE INDEPENDENT LINES, not one multi-line layer.
  // The previous build animated a single layer with a Range Selector "based on
  // Lines". That worked, but it made the whole template hostage to one obscure
  // property path (ADBE Text Range Type2, which lives in the selector's Advanced
  // group) — when that lookup failed the builder silently dropped to a whole-block
  // reveal whose exit was a plain fade. Three layers need no selector at all: each
  // line owns its keyframes, so the stagger is explicit and the exit is guaranteed
  // to be the entrance reversed. It also gives the panel one field per line.
  var layers = [];
  for (var i = 0; i < LINES; i++) {
    var name = "Line " + (i + 1);
    // AE will not create an empty text layer, so seed a space and let the editor
    // clear it; a lone space renders as nothing.
    var seed = DEFAULTS[i] || " ";
    var L = comp.layers.addText(seed);
    L.name = name;
    setText(L, seed, T.fonts.family + "-Bold", size, hex2rgb(T.color), T.letter_spacing * size);
    L.transform.position.setValue([px, py + i * lineH]);

    // In: rise + fade. Out: the exact reverse — fall back down by the same amount
    // and fade, which is what "reversed" has to mean and what the old fallback
    // never did. Each line is offset by `stagger`, so they cascade.
    var t0 = i * stagger;
    key2(L.transform.position, t0, [px, py + i * lineH + rise], t0 + T.enter, [px, py + i * lineH]);
    key2(L.transform.opacity, t0, 0, t0 + T.enter, 100);
    // Reversed exit: the LAST line to arrive is the first to leave, and line 1
    // finishes exactly on DUR. Getting this backwards makes the exit replay the
    // entrance order instead of reversing it — it still moves, so it looks almost
    // right, which is exactly why it's worth spelling out.
    var tOut = DUR - T.exit - i * stagger;
    key2(L.transform.position, tOut, [px, py + i * lineH], tOut + T.exit, [px, py + i * lineH + rise]);
    key2(L.transform.opacity, tOut, 100, tOut + T.exit, 0);

    // Close the gap left by an empty line above, so "line 1 + line 3" doesn't
    // render with a hole in it. Reads the layers above and shifts up one line
    // height for each blank; `value` keeps the keyframed animation intact.
    if (i > 0) {
      var checks = [];
      for (var j = 1; j <= i; j++) {
        checks.push('if (thisComp.layer("Line ' + j + '").text.sourceText.toString().replace(/\\s/g,"").length == 0) blank++;');
      }
      L.transform.position.expression =
        'var blank = 0; ' + checks.join(" ") + ' value - [0, blank * ' + lineH + '];';
    }
    layers.push(L);
  }

  var ctl = ctlNull(comp);
  addSlider(ctl, "Size", 100);
  sizeGroup(comp, layers, "" + px, "" + py);     // scales the block in place
  protectRegions(comp, T.enter + (LINES - 1) * stagger, T.exit + (LINES - 1) * stagger);
  comp.motionGraphicsTemplateName = comp.name;
  addEGP(ctl.effect("Size").property(1), comp, "Size");
  for (var k = 0; k < LINES; k++) {
    addEGP(layers[k].property("ADBE Text Properties").property("ADBE Text Document"),
           comp, "Line " + (k + 1));
  }
  return comp;
}

// ---------------------------------------------------------------- readability gradient
// A soft black scrim that keeps white text / event captions legible over busy
// footage. Built as a full-frame black solid cut by a FEATHERED LINEAR WIPE: the
// wipe clears the far end and the feather does the fade. Far more script-robust
// than assembling gradient-fill colour stops, and it scales to any format because
// completion is a percentage and the feather is derived from comp height.
function buildGradient(fmt) {
  var W = fmt.w, H = fmt.h, G = DATA.gradient;
  var DUR = 5;
  var comp = S.proj.items.addComp("OCHA Gradient - " + fmt.label, W, H, 1, DUR, 30);
  comp.parentFolder = S.root;

  var sol = comp.layers.addSolid([0, 0, 0], "Scrim", W, H, 1, DUR);
  var wipe = sol.property("ADBE Effect Parade").addProperty("ADBE Linear Wipe");
  // Linear Wipe CLEARS the side the angle points away from. Measured in Premiere:
  // angle 0 left the scrim at the TOP, not the bottom - the opposite of what the
  // first cut assumed - so the mapping is inverted here. Angle 180 = scrim at the
  // BOTTOM (the default), angle 0 = scrim at the TOP.
  wipe.property("Transition Completion").setValue(Math.round((1 - G.height_frac) * 100));
  wipe.property("Feather").setValue(Math.round(H * G.height_frac * G.feather_frac));
  wipe.property("Wipe Angle").expression =
    "thisComp.layer('Controls').effect('Top')('Checkbox') > 0 ? 0 : 180;";
  // "Full screen" bypasses the wipe entirely: an even scrim over the whole frame,
  // for text that sits anywhere. Completion 0 = nothing cleared.
  wipe.property("Transition Completion").expression =
    "thisComp.layer('Controls').effect('Full screen')('Checkbox') > 0 ? 0 : value;";
  sol.transform.opacity.expression =
    "thisComp.layer('Controls').effect('Opacity')('Slider');";

  var ctl = ctlNull(comp);
  addCheckbox(ctl, "Top", false);
  addCheckbox(ctl, "Full screen", false);
  addSlider(ctl, "Opacity", G.opacity);
  var mv = new MarkerValue("gradient"); mv.duration = DUR; mv.protectedRegion = true;
  comp.markerProperty.setValueAtTime(0, mv);     // fixed piece - protect it all
  comp.motionGraphicsTemplateName = comp.name;
  addEGP(ctl.effect("Opacity").property(1), comp, "Opacity");   // display: Top, Full screen, Opacity
  addEGP(ctl.effect("Full screen").property(1), comp, "Full screen");
  addEGP(ctl.effect("Top").property(1), comp, "Top");
  return comp;
}

// ---------------------------------------------------------------- build + export
function exportComp(comp, cname, fmtKey) {
  var dir = new Folder(MOGRT_ROOT + "/" + fmtKey);
  if (!dir.exists) dir.create();
  try {
    // NOTES from the field: the path argument is a destination FOLDER (a file
    // path becomes a directory with the .mogrt nested inside), and a SUCCESSFUL
    // export INVALIDATES the comp reference — touching comp.name afterwards
    // throws "Object is invalid". Hence the pre-captured cname.
    if (!comp.exportAsMotionGraphicsTemplate(true, dir.fsName))
      throw new Error("export returned false");
    results.push(cname + " -> " + fmtKey);
  } catch (e1) {
    failures.push("EXPORT " + cname + ": " + e1.toString() +
                  (e1.line ? " @line " + e1.line : ""));
  }
}

var builders = [buildLT, buildPin, buildBug, buildEnding, buildText, buildGradient];
var builderNames = ["LT", "Pin", "Bug", "Ending", "Text", "Gradient"];
try {
  for (var f = 0; f < DATA.formats.length; f++) {
    var fmt = DATA.formats[f];
    for (var b = 0; b < builders.length; b++) {
      var comp = null;
      try {
        refresh();                               // prior export staled all refs
        log("BUILD " + builderNames[b] + " " + fmt.key + " …");
        comp = builders[b](fmt);
        log("BUILD " + builderNames[b] + " " + fmt.key + " ok");
      } catch (be) {
        var bmsg = "BUILD " + builderNames[b] + " (" + fmt.key + "): " +
                   be.toString() + (be.line ? " @line " + be.line : "");
        failures.push(bmsg);
        log("ERR " + bmsg);
      }
      if (comp) {
        var cname = comp.name;                   // comp ref dies on export
        log("EXPORT " + cname + " …");
        exportComp(comp, cname, fmt.key);
        log("EXPORT " + cname + " done (ok=" + results.length +
            " err=" + failures.length + ")");
      }
    }
  }
} catch (fatal) {
  failures.push("FATAL: " + fatal.toString() + (fatal.line ? " @line " + fatal.line : ""));
  log("FATAL: " + fatal.toString() + (fatal.line ? " @line " + fatal.line : ""));
}

app.endSuppressDialogs(false);
app.endUndoGroup();

var msg = "OCHA Branding builder finished.\n\n" +
          "MOGRTs exported: " + results.length + "\n-> " + MOGRT_ROOT + "\n";
if (failures.length) {
  msg += "\nProblems (" + failures.length + "):\n";
  for (var i = 0; i < failures.length && i < 8; i++) msg += "- " + failures[i] + "\n";
  msg += "\nIf exports failed with a file-access error: enable Preferences > " +
         "Scripting & Expressions > 'Allow Scripts to Write Files and Access " +
         "Network' and run the script again.";
}

log("=== DONE exported=" + results.length + " failed=" + failures.length + " ===");
for (var q = 0; q < failures.length; q++) log("SUMMARY ERR " + failures[q]);

alert(msg);

})();
