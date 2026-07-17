/* CEP spike: prove Premiere's ExtendScript can WRITE a MOGRT text control —
   the exact thing UXP cannot do (see docs/decisions.md). getMGTComponent() is
   CEP-only; there is no UXP equivalent. */
function ochaProbe() {
  var L = [];
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "no active sequence";
    L.push("sequence: " + seq.name);

    // newest MOGRT clip, scanning tracks top-down
    var hit = null;
    for (var t = seq.videoTracks.numTracks - 1; t >= 0 && !hit; t--) {
      var track = seq.videoTracks[t];
      for (var c = track.clips.numItems - 1; c >= 0 && !hit; c--) {
        var clip = track.clips[c];
        var mgt = null;
        try { mgt = clip.getMGTComponent(); } catch (e) {}
        if (mgt) hit = { clip: clip, mgt: mgt, t: t, c: c };
      }
    }
    if (!hit) return L.join("\n") + "\nno MOGRT clip found on any video track";
    L.push("MOGRT clip: " + hit.clip.name + "  (V" + (hit.t + 1) + ", clip " + hit.c + ")");

    var props = hit.mgt.properties;
    L.push("getMGTComponent() -> " + props.numItems + " params");
    for (var i = 0; i < props.numItems; i++) {
      var p = props[i];
      var v = "";
      try { v = String(p.getValue()); } catch (e) { v = "<unreadable>"; }
      L.push("  [" + i + "] " + p.displayName + " = " + v.substring(0, 40));
    }
    // THE TEST: write a string into the first text control
    for (var i = 0; i < props.numItems; i++) {
      var p = props[i];
      var n = p.displayName;
      if (n === "Name" || n === "Place") {
        try { p.setValue("CEP-TEXT-WORKS", true); L.push("SET " + n + ' = "CEP-TEXT-WORKS"  <<< TEXT WRITE OK'); }
        catch (e) { L.push("SET " + n + " ERR " + e.toString()); }
      }
      if (n === "Title" || n === "Date") {
        try { p.setValue("set from CEP panel", true); L.push("SET " + n + " OK"); }
        catch (e) { L.push("SET " + n + " ERR " + e.toString()); }
      }
    }
  } catch (e) { L.push("FATAL " + e.toString()); }
  return L.join("\n");
}
