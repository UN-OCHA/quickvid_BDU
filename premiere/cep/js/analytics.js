/* OCHA QuickVid (Premiere panel) — anonymous usage pings.
 *
 * Same shape as the DataViz plugin's client/analytics.js, pointed at QuickVid's
 * OWN Apps Script deployment so it can never inflate the DataViz figures (that
 * endpoint appends to one flat log its dashboard counts wholesale).
 *
 * WHAT IS SENT, and nothing else:
 *   v   = panel version          e.g. "0.27.0"
 *   e   = event name             e.g. "open:mac", "add:lt", "tool:reel"
 *   loc = approximate location   e.g. "Geneva, Switzerland"  (city/country only)
 * NEVER send project names, typed text, file paths or sequence names — the point
 * is "which features get used, on what platform", not who did what.
 *
 * Fire-and-forget: every call is wrapped, a failure is silent, and nothing here
 * may ever block or break the panel.
 *
 * SETUP: paste the /exec URL of your deployment into ENDPOINT below.
 * While it is empty this file is a NO-OP — no request leaves the machine.
 * Steps: docs/ANALYTICS_SETUP.md
 */
var Analytics = (function () {
  "use strict";

  // QuickVid's OWN deployment (sheet: "OCHA QuickVid Plugin Analytics") — deliberately
  // not the DataViz endpoint, whose dashboard counts every row in its log.
  var ENDPOINT = "https://script.google.com/macros/s/AKfycbwxIHRGOb5rLeXbL2RtHDNFMPRRNrBg8VvEnHp-mru8u4lTkiRfrmb8ItSN_aTrUQ_2-g/exec";

  var _version = "";
  var _location = "unknown";
  var _platform = "other";

  function detectPlatform() {
    try {
      var p = (navigator.platform || "").toLowerCase();
      if (p.indexOf("win") >= 0) return "win";
      if (p.indexOf("mac") >= 0) return "mac";
      if (p.indexOf("linux") >= 0) return "linux";
    } catch (e) {}
    return "other";
  }

  function init(appVersion) {
    if (!ENDPOINT) return;                       // not configured — stay silent
    _version = appVersion || "";
    _platform = detectPlatform();

    // Look up the approximate location once, then fire the startup ping so it
    // lands with a real value instead of "unknown".
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      ping("open:" + _platform);
    }
    try {
      var geo = new XMLHttpRequest();
      geo.open("GET", "http://ip-api.com/json/?fields=city,country", true);
      geo.timeout = 5000;
      geo.onload = function () {
        try {
          var loc = JSON.parse(geo.responseText);
          _location = (loc.city || "") + ", " + (loc.country || "");
        } catch (e) {}
        fire();
      };
      geo.onerror = fire;
      geo.ontimeout = fire;
      geo.send();
    } catch (e) { fire(); }
    setTimeout(fire, 6000);                      // safety net: never wait forever
  }

  function ping(event) {
    if (!ENDPOINT) return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", ENDPOINT +
        "?v=" + encodeURIComponent(_version) +
        "&e=" + encodeURIComponent(event || "open") +
        "&loc=" + encodeURIComponent(_location), true);
      xhr.timeout = 5000;
      xhr.onerror = function () {};
      xhr.send();
    } catch (e) { /* silent */ }
  }

  return { init: init, ping: ping };
})();
