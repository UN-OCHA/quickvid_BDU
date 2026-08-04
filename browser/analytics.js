/* OCHA QuickVid web app — anonymous usage pings.
 *
 * Same Apps Script deployment as the Premiere plugin, but tagged `p=webapp` so it
 * lands on its OWN tab ("Events Web App"). Javi's call: one sheet, a tab per
 * product, separate dashboards later. Mixing them would make every plugin figure
 * wrong the day the web app started reporting, and the rows would be
 * indistinguishable afterwards.
 *
 * WHAT IS SENT, and nothing else:
 *   v   = app version        e.g. "2026.0.33"
 *   e   = event name         e.g. "open:mac", "render:reels", "transcribe"
 *   p   = "webapp"
 *   loc = coarse location    e.g. "Europe/Zurich" — the browser's TIME ZONE, not a
 *         lookup. No IP geolocation, no network call to a third party.
 *
 * NEVER sent: file names, paths, project names, transcript text, or anything typed.
 * The question is "which features get used, on what platform", not who did what.
 *
 * THE PROMISE THIS MUST NOT BREAK: "your video never leaves your computer". This
 * sends six short fields about the APP, never about the video. That is why it is
 * a plain GET with no body, why the payload is listed above in full, and why the
 * opt-out is one click in the footer.
 *
 * Fire-and-forget: every call is wrapped, failures are silent, nothing here may
 * block or break the app.
 */
window.OchaAnalytics = (function () {
  "use strict";

  // Same deployment as premiere/cep/js/analytics.js — one sheet, two tabs.
  var ENDPOINT = "https://script.google.com/macros/s/AKfycbwxIHRGOb5rLeXbL2RtHDNFMPRRNrBg8VvEnHp-mru8u4lTkiRfrmb8ItSN_aTrUQ_2-g/exec";
  var OPT_OUT_KEY = "quickvid.analytics.off";

  var _version = "";
  var _sent = {};                      // one ping per event per session

  function optedOut() {
    try { return localStorage.getItem(OPT_OUT_KEY) === "1"; } catch (e) { return false; }
  }
  function setOptOut(off) {
    try { localStorage.setItem(OPT_OUT_KEY, off ? "1" : "0"); } catch (e) {}
  }

  function platform() {
    try {
      var p = (navigator.platform || navigator.userAgent || "").toLowerCase();
      if (p.indexOf("win") >= 0) return "win";
      if (p.indexOf("mac") >= 0) return "mac";
      if (p.indexOf("linux") >= 0) return "linux";
    } catch (e) {}
    return "other";
  }

  // The browser's own time zone. Coarse, already known to the page, and it needs
  // no third-party lookup — which a geo-IP service would have been.
  function where() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"; }
    catch (e) { return "unknown"; }
  }

  function init(version) {
    _version = String(version || "");
    ping("open:" + platform());
  }

  /* `once` (default true for open:*) keeps a long session from logging the same
     event repeatedly — the figure we want is "people who used this", not "clicks". */
  function ping(event, once) {
    try {
      if (!ENDPOINT || optedOut() || !_version) return;
      var ev = String(event || "");
      if (!/^[a-z]{1,20}(:[A-Za-z0-9 ._-]{1,40}){0,3}$/.test(ev)) return;   // same shape the receiver accepts
      if (once !== false) {
        if (_sent[ev]) return;
        _sent[ev] = 1;
      }
      var url = ENDPOINT +
        "?v=" + encodeURIComponent(_version) +
        "&e=" + encodeURIComponent(ev) +
        "&p=webapp" +
        "&loc=" + encodeURIComponent(where());
      // An <img> beacon, not fetch: no CORS preflight to fail, no promise to leak,
      // and it cannot block the page. The response is discarded either way.
      var i = new Image();
      i.referrerPolicy = "no-referrer";
      i.src = url;
    } catch (e) { /* analytics must never break the app */ }
  }

  return { init: init, ping: ping, optedOut: optedOut, setOptOut: setOptOut };
})();
