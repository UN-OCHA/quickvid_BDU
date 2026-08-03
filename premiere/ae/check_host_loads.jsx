/* Does premiere/cep/jsx/host.jsx actually EVALUATE in ExtendScript?

   Run this in After Effects (File > Scripts > Run Script File...). AE and Premiere
   run the same ExtendScript language, and host.jsx only DEFINES functions at load
   time - it never touches a Premiere API until one is called. So AE can source it
   and tell us, in plain words, whether the file itself is the problem.

   This isolates the one question the Premiere panel cannot answer: the panel only
   ever reports "not sourced", with no line number and no reason.

   Written 2026-07-31, chasing "host: not sourced (typeof=EvalScript error.)".
   ASCII only, var only - same rules as host.jsx itself. */

(function () {
  var here = File($.fileName).parent;                 // premiere/ae
  var repo = here.parent.parent;                      // repo root
  var host = new File(repo.fsName + "/premiere/cep/jsx/host.jsx");

  var lines = [];
  lines.push("HOST FILE CHECK");
  lines.push("");
  lines.push("path : " + host.fsName);
  lines.push("found: " + host.exists);

  if (!host.exists) {
    alert(lines.join("\n") + "\n\nThe file is not where this script expects it.");
    return;
  }

  host.encoding = "UTF-8";
  host.open("r");
  var src = host.read();
  host.close();
  lines.push("bytes: " + src.length);
  lines.push("");

  // 1) Does it PARSE and evaluate at all?
  var parseErr = null;
  try {
    $.evalFile(host);
  } catch (e) {
    parseErr = e;
  }

  if (parseErr) {
    lines.push("RESULT: FAILED TO LOAD  <-- this is the bug");
    lines.push("");
    lines.push("error : " + parseErr.toString());
    if (parseErr.line) {
      lines.push("line  : " + parseErr.line);
      var arr = src.split("\n");
      var from = Math.max(0, parseErr.line - 3), to = Math.min(arr.length, parseErr.line + 2);
      lines.push("");
      for (var i = from; i < to; i++) {
        lines.push((i + 1 === parseErr.line ? ">> " : "   ") + (i + 1) + ": " + arr[i]);
      }
    }
  } else {
    // 2) It loaded - are the functions the panel needs actually defined?
    var need = ["ochaGetFormat", "ochaAdd", "ochaReadMotion", "ochaWriteMotion",
                "ochaSetFont", "ochaFontParam", "ochaSelectedOchaClip", "ochaFindParam"];
    var missing = [];
    for (var k = 0; k < need.length; k++) {
      if (eval("typeof " + need[k]) !== "function") missing.push(need[k]);
    }
    if (missing.length) {
      lines.push("RESULT: loaded, but these are MISSING: " + missing.join(", "));
    } else {
      lines.push("RESULT: LOADS CLEANLY, all functions present.");
      lines.push("");
      lines.push("So host.jsx is NOT the problem - the fault is on the Premiere side");
      lines.push("(its script engine is refusing every call).");
    }
  }

  alert(lines.join("\n"));
})();
