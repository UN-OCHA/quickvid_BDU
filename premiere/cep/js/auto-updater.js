/* OCHA QuickVid panel — auto-updater.
 *
 * Modelled on the DataViz plugin's proven updater (client/auto-updater.js), which
 * has been in the field since March. Same two-phase shape, because a CEP panel
 * cannot overwrite its own folder while Premiere holds it open:
 *
 *   1. DOWNLOAD  — fetch the package into the extension folder as
 *                  __pendingUpdate.zxp and drop a __pendingUpdate.json marker.
 *   2. APPLY     — spawn a DETACHED helper script that waits for Premiere to
 *                  quit, unzips the package over the folder, and leaves an
 *                  __pendingUpdate.applied.json marker the panel reports next launch.
 *
 * Needs --enable-nodejs in CSXS/manifest.xml for https + child_process. Without it
 * every entry point here returns "node unavailable" and the panel falls back to the
 * notify-only banner, which is what shipped before this file existed.
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

  var _dir = null, _staged = null, _marker = null, _helper = null, _log = null;

  function available() { return !!(https && fs && path && spawn); }

  function _paths(extRoot) {
    if (_dir) return true;
    if (!path || !extRoot) return false;
    // extRoot arrives percent-encoded from the raw CEP bridge ("OCHA%20QuickVid"),
    // and every fs call would miss by a space if it isn't decoded first.
    _dir = extRoot;
    _staged = path.join(_dir, STAGED_NAME);
    _marker = path.join(_dir, MARKER_NAME);
    _helper = path.join(_dir, "host",
      (os && /^win/i.test(os.platform())) ? "update-helper-win.bat" : "update-helper-mac.sh");
    _log = path.join((os ? os.tmpdir() : "/tmp"), "ocha-quickvid-update.log");
    return true;
  }

  /* Download the package. Follows redirects (GitHub raw 302s to its CDN) and only
     renames into place once the whole body has landed, so a dropped connection
     can't leave a truncated file the helper would happily unzip. */
  function download(url, version, extRoot, cb) {
    cb = cb || {};
    if (!available()) return cb.onError && cb.onError("node unavailable");
    if (!_paths(extRoot)) return cb.onError && cb.onError("could not resolve the extension folder");

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
    // GitHub raw serves the SAME url for every version, and its CDN can hand back a
    // STALE copy — which silently extracts the old build over itself (the marker,
    // taken from the freshly-fetched version.json, still says "updated"). Append a
    // unique query so we always pull the current bytes. Only the FIRST hop is busted;
    // redirect targets (the signed CDN url) are followed verbatim.
    var firstUrl = url + (url.indexOf("?") < 0 ? "?" : "&") + "cb=" + version + "-" + new Date().getTime();
    fetch(firstUrl);
  }

  /* Hand the staged package to a detached helper and return. The helper outlives
     this panel on purpose — it can only do its job once Premiere has quit. */
  function apply(version) {
    if (!available()) return { ok: false, error: "node unavailable" };
    if (!_dir) return { ok: false, error: "extension folder not resolved" };
    if (!fs.existsSync(_staged)) return { ok: false, error: "no staged update to apply" };
    if (!fs.existsSync(_helper)) return { ok: false, error: "helper script missing: " + _helper };

    var isWin = os && /^win/i.test(os.platform());
    var args = [_staged, _dir, _marker, _log, version || ""];
    try {
      if (isWin) {
        // Windows will NOT keep a .bat alive past its parent, whatever combination
        // of detached/stdio/windowsHide you use — DataViz burned a lot of time on
        // this. A tiny .vbs launched via wscript is the one thing that survives.
        var q = function (s) { return '""' + String(s).replace(/"/g, '""') + '""'; };
        var vbs = 'CreateObject("WScript.Shell").Run "cmd /c ""' +
                  q(_helper) + " " + args.map(q).join(" ") + '""", 0, False';
        var vbsPath = path.join(os.tmpdir(), "ocha-quickvid-update-" + Date.now() + ".vbs");
        fs.writeFileSync(vbsPath, vbs, "utf8");
        spawn("wscript.exe", [vbsPath], { detached: true, stdio: "ignore" }).unref();
      } else {
        try { fs.chmodSync(_helper, 0o755); } catch (e) {}   // zip loses the +x bit
        spawn("/bin/bash", [_helper].concat(args), { detached: true, stdio: "ignore" }).unref();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "spawn failed: " + e.message };
    }
  }

  /* What happened while we were away? Read on startup so the panel can confirm an
     update landed — or surface the reason it didn't, instead of silently retrying. */
  function checkMarkers(extRoot) {
    if (!fs || !path || !_paths(extRoot)) return { kind: "none" };
    function readJson(p) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
    }
    var appliedP = path.join(_dir, APPLIED_NAME), errorP = path.join(_dir, ERROR_NAME);
    if (fs.existsSync(appliedP)) {
      var a = readJson(appliedP) || {};
      try { fs.unlinkSync(appliedP); } catch (e) {}
      return { kind: "applied", version: a.version || "" };
    }
    if (fs.existsSync(errorP)) {
      var er = readJson(errorP) || {};
      try { fs.unlinkSync(errorP); } catch (e) {}
      return { kind: "error", message: er.error || "the update helper failed" };
    }
    if (fs.existsSync(_staged) && fs.existsSync(_marker)) {
      var m = readJson(_marker) || {};
      return { kind: "staged", version: m.version || "" };   // downloaded, awaiting a restart
    }
    return { kind: "none" };
  }

  return { available: available, download: download, apply: apply, checkMarkers: checkMarkers };
})();
