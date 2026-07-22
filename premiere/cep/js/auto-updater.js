/* OCHA QuickVid panel — auto-updater.
 *
 * A line-for-line port of the DataViz plugin's PROVEN updater
 * (ocha_dataviz_tool/ocha_dataviz_plugin/client/auto-updater.js), which went
 * through a long Windows debugging saga before it worked. The hard-won rules,
 * so nobody re-learns them here:
 *
 *   1. DOWNLOAD  — fetch the package into the extension folder as
 *                  __pendingUpdate.zxp + drop a __pendingUpdate.json marker.
 *   2. APPLY     — spawn a DETACHED helper script that waits for Premiere to
 *                  quit, extracts the package over the folder, and leaves an
 *                  __pendingUpdate.applied.json marker the panel reports next
 *                  launch.
 *
 * WINDOWS SPAWN — VBS ONLY, NO cmd.exe ANYWHERE. DataViz tried, in order:
 * cmd /c (quote-strip mangles paths), shell:true (same), cmd /d /s /c (same),
 * start "" /B (its own buggy quote parser), every detached/windowsHide combo
 * (orthogonal). The ONLY reliable launch is a tiny .vbs in %TEMP% run by
 * wscript.exe, whose WScript.Shell.Run starts the .bat DIRECTLY with VBS
 * doubled-quote escaping. An earlier QuickVid port wrapped the .bat in
 * "cmd /c" INSIDE the VBS — that reintroduces the mangling; never do it.
 *
 * EXTRACTION — tar.exe on Windows (ships with Win10 2018+; reads a .zxp as the
 * zip it is). NOT PowerShell Expand-Archive: it rejects non-.zip extensions
 * with a NON-TERMINATING error, so the helper "succeeds" having extracted
 * nothing. unzip -oq on macOS.
 *
 * SAFETY GATES (isAvailable) — helper present + NOT a symlinked dev install
 * (auto-updating a symlink would clobber the git working tree; Javi's Mac runs
 * live source exactly like that) + the extension folder actually writable (the
 * ZXP installer's system-wide location under Program Files is read-only for
 * non-admin users — detect it and fall back to the notify-only banner instead
 * of pretending).
 *
 * Needs --enable-nodejs in CSXS/manifest.xml for https + fs + child_process.
 * Without it every entry point reports "node unavailable" and the panel shows
 * the notify-only banner.
 */
var AutoUpdater = (function () {
  "use strict";

  var HOST_PROCESS = "Adobe Premiere Pro";        // what the helper waits to exit
  var EXTENSION_ID = "org.unocha.branding";       // helper refuses any other folder

  var req  = (typeof require === "function") ? require : null;
  var https = req ? req("https") : null;
  var http  = req ? req("http")  : null;
  var fs    = req ? req("fs")    : null;
  var path  = req ? req("path")  : null;
  var os    = req ? req("os")    : null;
  var spawn = req ? req("child_process").spawn : null;

  var STAGED_NAME  = "__pendingUpdate.zxp";
  var MARKER_NAME  = "__pendingUpdate.json";
  var APPLIED_NAME = "__pendingUpdate.applied.json";
  var ERROR_NAME   = "__pendingUpdate.error.json";

  var _dir = null, _staged = null, _marker = null, _applied = null, _error = null,
      _helper = null, _log = null;

  function available() { return !!(https && fs && path && spawn); }

  /* Normalise whatever shape the extension path arrives in. main.js already
     decodes it, but re-stripping is idempotent and protects against every raw
     form CEP can emit:  file:///Users/…  |  /Users/…  |  /C:/Users/…  */
  function _normRoot(extRoot) {
    var p = String(extRoot || "");
    p = p.replace(/^file:\/{2,4}/, "/");
    try { p = decodeURIComponent(p); } catch (e) { /* already decoded */ }
    if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1);   // Windows "/C:/…" → "C:/…"
    return p;
  }

  function _paths(extRoot) {
    if (_dir) return true;
    if (!path || !extRoot) return false;
    _dir = _normRoot(extRoot);
    if (!_dir) return false;
    _staged  = path.join(_dir, STAGED_NAME);
    _marker  = path.join(_dir, MARKER_NAME);
    _applied = path.join(_dir, APPLIED_NAME);
    _error   = path.join(_dir, ERROR_NAME);
    var isWin = os && /^win/i.test(os.platform());
    _helper = path.join(_dir, "host", isWin ? "update-helper-win.bat" : "update-helper-mac.sh");
    // /tmp on macOS (universally writable, easy to tail), %TEMP% on Windows.
    _log = isWin ? path.join(os.tmpdir(), "ocha-quickvid-update.log")
                 : "/tmp/ocha-quickvid-update.log";
    return true;
  }

  function _readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
  }
  function _safeUnlink(p) { try { fs.unlinkSync(p); } catch (e) {} }

  /* Symlinked extension folder = a dev install running live source. Refuse to
     auto-update it: the extract would write straight into the linked git
     working tree. Dev installs update with git, not the updater. */
  function _isDevInstall() {
    if (!fs || !_dir) return false;
    try { return fs.lstatSync(_dir).isSymbolicLink(); } catch (e) { return false; }
  }

  /* Full gate for the one-click path: node + helper + not-a-dev-install + the
     folder is actually writable (probe). When this is false the panel shows
     the notify-only banner — never a fake "Update now". */
  function isAvailable(extRoot) {
    if (!available()) return false;
    if (!_paths(extRoot)) return false;
    if (!fs.existsSync(_helper)) return false;
    if (_isDevInstall()) return false;
    try {
      var probe = path.join(_dir, ".__updater_probe");
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      return true;
    } catch (e) { return false; }
  }

  /* Download the package. Follows redirects (GitHub raw 302s to its CDN) and
     only renames into place once the whole body has landed, so a dropped
     connection can't leave a truncated file the helper would happily unzip. */
  function download(url, version, extRoot, cb) {
    cb = cb || {};
    if (!available()) return cb.onError && cb.onError("node unavailable");
    if (!_paths(extRoot)) return cb.onError && cb.onError("could not resolve the extension folder");

    // start clean — stale markers from an earlier attempt must not survive
    _safeUnlink(_staged); _safeUnlink(_marker); _safeUnlink(_applied); _safeUnlink(_error);

    var tmp = _staged + ".part";
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}

    var hops = 0;
    function fetch(u) {
      if (++hops > 5) return fail("too many redirects");
      var lib = (u.indexOf("http://") === 0) ? http : https;
      var request;
      try {
        request = lib.get(u, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return fetch(res.headers.location);
          }
          if (res.statusCode !== 200) { res.resume(); return fail("HTTP " + res.statusCode); }
          var total = parseInt(res.headers["content-length"] || "0", 10), got = 0;
          var out = fs.createWriteStream(tmp);
          res.on("data", function (c) {
            got += c.length;
            if (cb.onProgress && total) cb.onProgress(Math.round((got / total) * 100));
          });
          res.pipe(out);
          out.on("finish", function () {
            out.close(function () {
              try {
                if (got < 1024) return fail("download was empty");
                fs.renameSync(tmp, _staged);        // atomic: only now is it "staged"
                fs.writeFileSync(_marker, JSON.stringify({
                  version: version, stagedAt: new Date().toISOString()
                }), "utf8");
                if (cb.onDone) cb.onDone(version);
              } catch (e) { fail("could not stage: " + e.message); }
            });
          });
          out.on("error", function (e) { fail("write failed: " + e.message); });
        });
      } catch (e) { return fail(e.message); }
      request.on("error", function (e) { fail(e.message); });
      request.setTimeout(60000, function () { request.abort(); fail("timed out"); });
    }
    function fail(m) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
      if (cb.onError) cb.onError(m);
    }
    // GitHub raw serves the SAME url for every version and its CDN can hand back
    // a STALE copy — which silently re-installs the old build. A unique query
    // forces current bytes. Only the FIRST hop is busted; redirect targets (the
    // signed CDN url) are followed verbatim.
    var firstUrl = url + (url.indexOf("?") < 0 ? "?" : "&") + "cb=" + version + "-" + new Date().getTime();
    fetch(firstUrl);
  }

  /* Panel-side spawn log, next to the extension. Without dev tools this is the
     only way to see WHAT the panel tried to spawn and whether it succeeded —
     the DataViz Windows debugging lived off this file. */
  function _logSpawn(line) {
    try {
      fs.appendFileSync(path.join(_dir, "__update-spawn.log"),
        "[" + new Date().toISOString() + "] " + line + "\n");
    } catch (e) { /* best-effort */ }
  }

  /* Hand the staged package to a detached helper and return. The helper outlives
     this panel on purpose — it can only do its job once Premiere has quit. */
  function apply(version) {
    if (!available()) return { ok: false, error: "node unavailable" };
    if (!_dir) return { ok: false, error: "extension folder not resolved" };
    if (!fs.existsSync(_staged)) return { ok: false, error: "no staged update to apply" };
    if (!fs.existsSync(_helper)) return { ok: false, error: "helper script missing" };

    var isWin = os && /^win/i.test(os.platform());
    var cmd, args, opts;

    if (isWin) {
      // VBS launcher, .bat run DIRECTLY by WScript.Shell.Run — see the header.
      // Inside a VBS string literal every " is written "" — so each argument is
      // wrapped in ""…"" (a literal quoted token) and the whole command line
      // sits inside one VBS string. window style 0 = hidden, False = don't wait.
      var vbsArg = function (s) {
        return '""' + String(s == null ? "" : s).replace(/"/g, '""') + '""';
      };
      var commandInVbs = [
        vbsArg(_helper), vbsArg(_staged), vbsArg(_dir),
        vbsArg(_marker), vbsArg(_log), vbsArg(version || "")
      ].join(" ");
      var vbsContent = [
        "' OCHA QuickVid update launcher - generated; safe to delete",
        'Set sh = CreateObject("WScript.Shell")',
        'sh.Run "' + commandInVbs + '", 0, False',
        "Set sh = Nothing"
      ].join("\r\n");
      var vbsPath = path.join(os.tmpdir(), "ocha-quickvid-update-" + Date.now() + ".vbs");
      try { fs.writeFileSync(vbsPath, vbsContent, "utf8"); }
      catch (e) { return { ok: false, error: "could not write launcher: " + e.message }; }
      cmd = "wscript.exe";
      args = [vbsPath];
      // No detached, no windowsHide — wscript exits the moment Run() returns;
      // the .bat it launched lives in its own hidden session (DataViz-proven).
      opts = { stdio: "ignore" };
    } else {
      cmd = "/bin/bash";
      args = [_helper, _staged, _dir, _marker, _log, version || ""];
      opts = { detached: true, stdio: "ignore" };
    }

    _logSpawn("apply() v" + (version || "?") + " platform=" + (os ? os.platform() : "?"));
    _logSpawn("  cmd: " + cmd + " args: " + JSON.stringify(args));
    try {
      var child = spawn(cmd, args, opts);
      child.unref();
      _logSpawn("  spawn OK pid=" + (child.pid || "?"));
      child.on("error", function (e) { _logSpawn("  child error: " + e.message); });
      return { ok: true };
    } catch (e) {
      _logSpawn("  spawn THREW: " + e.message);
      return { ok: false, error: "spawn failed: " + e.message };
    }
  }

  /* What happened while we were away? Read on startup so the panel can confirm
     an applied update, surface a helper error, or re-arm a staged one. */
  function checkMarkers(extRoot) {
    if (!fs || !path || !_paths(extRoot)) return { kind: "none" };
    if (fs.existsSync(_applied)) {
      var a = _readJson(_applied) || {};
      _safeUnlink(_staged); _safeUnlink(_marker); _safeUnlink(_applied);
      return { kind: "applied", version: a.version || "" };
    }
    if (fs.existsSync(_error)) {
      var er = _readJson(_error) || {};
      _safeUnlink(_error);
      // keep the staged file — the panel may retry apply() without re-downloading
      return { kind: "error", message: er.error || "the update helper failed" };
    }
    if (fs.existsSync(_staged) && fs.existsSync(_marker)) {
      var m = _readJson(_marker) || {};
      return { kind: "staged", version: m.version || "" };   // downloaded, awaiting a restart
    }
    return { kind: "none" };
  }

  /* Drop a staged-but-unapplied download (user dismissed the update). */
  function cancelPending(extRoot) {
    if (!fs || !_paths(extRoot)) return;
    _safeUnlink(_staged); _safeUnlink(_marker); _safeUnlink(_error);
  }

  /* Verbose availability breakdown for the menu's diagnostics readout — which
     gate is failing, without attaching a debugger (DataViz pattern). */
  function diagnose(extRoot) {
    var d = {
      node: available() ? "yes" : "NO (enable-nodejs off?)",
      dir: "(unresolved)", devInstall: "?", helper: "?", writable: "?", oneClick: "no"
    };
    if (!_paths(extRoot)) { return d; }
    d.dir = _dir;
    d.devInstall = _isDevInstall() ? "YES (symlink - updater off)" : "no";
    d.helper = fs.existsSync(_helper) ? "yes" : "MISSING";
    try {
      var probe = path.join(_dir, ".__updater_probe");
      fs.writeFileSync(probe, ""); fs.unlinkSync(probe);
      d.writable = "yes";
    } catch (e) { d.writable = "NO (" + (e.code || e.message) + ")"; }
    d.oneClick = isAvailable(extRoot) ? "YES" : "no";
    return d;
  }

  return { available: available, isAvailable: isAvailable, download: download,
           apply: apply, checkMarkers: checkMarkers, cancelPending: cancelPending,
           diagnose: diagnose };
})();
