/**
 * OCHA QuickVid — analytics receiver (Google Apps Script, bound to the QuickVid
 * analytics spreadsheet). Deploy as a Web app; paste the /exec URL into
 * premiere/cep/js/analytics.js.
 *
 * Deliberately its OWN deployment, separate from the DataViz plugin's: that one
 * appends to a single flat log its dashboard counts wholesale, so mixing QuickVid
 * events in would inflate the DataViz figures.
 *
 * Two jobs:
 *   1. PING  (no `action` param) — the panel's anonymous usage ping. Appends a row
 *      to the "Events" sheet: Timestamp | Version | Action | Location.
 *   2. ADMIN (`action` + `token`) — token-gated read/write so the dashboard can be
 *      built and maintained without opening the browser. Mirrors the DataViz API.
 *
 * Setup steps: docs/ANALYTICS_SETUP.md
 */

// Change this before deploying, and keep it out of git.
var TOKEN = 'CHANGE-ME-quickvid-analytics';

var LOG_SHEET = 'Events';
var HEADER = ['Timestamp', 'Version', 'Action', 'Location'];

function _log() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};

  // ---- 1. the ping path: no action param, no token, nothing sensitive ----
  // The /exec URL ships inside the panel, and the panel lives in a PUBLIC repo, so
  // this endpoint is effectively public knowledge. That is unavoidable for any
  // client-side ping (the DataViz plugin is in the same position). It is not a data
  // risk — nothing here reads the sheet — but it does mean someone could post junk
  // rows. So only accept values that look like ours, and drop anything else on the
  // floor: shapes are cheap to check and keep the log trustworthy.
  if (!p.action) {
    try {
      var v = String(p.v || '');
      var ev = String(p.e || '');
      var loc = String(p.loc || 'unknown');
      var okV = /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(v);            // 0.28.0
      var okE = /^[a-z]{1,20}(:[A-Za-z0-9 ._-]{1,40}){0,3}$/.test(ev);  // open:mac, add:lt:reels
      if (okV && okE) {
        _log().appendRow([new Date().toISOString(), v, ev, loc.slice(0, 120)]);
      }
    } catch (err) { /* never surface anything to the panel */ }
    return ContentService.createTextOutput('ok');   // always 'ok' — reveal nothing
  }

  // ---- 2. the admin path ----
  if (p.token !== TOKEN) return _json({ ok: false, error: 'bad token' });
  try {
    if (p.action === 'read') {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.tab || LOG_SHEET);
      if (!sh) return _json({ ok: false, error: 'no such tab' });
      var rng = p.range ? sh.getRange(p.range) : sh.getDataRange();
      return _json({ ok: true, values: rng.getValues() });
    }
    return _json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {
    return _json({ ok: false, error: 'bad json' });
  }
  if (body.token !== TOKEN) return _json({ ok: false, error: 'bad token' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (body.action === 'update_range') {
      var sh = ss.getSheetByName(body.tab);
      if (!sh) return _json({ ok: false, error: 'no such tab' });
      var vals = body.values || [];
      if (!vals.length) return _json({ ok: false, error: 'no values' });
      sh.getRange(body.range).offset(0, 0, vals.length, vals[0].length).setValues(vals);
      return _json({ ok: true });
    }
    if (body.action === 'clear_range') {
      ss.getSheetByName(body.tab).getRange(body.range).clearContent();
      return _json({ ok: true });
    }
    if (body.action === 'add_sheet') {
      ss.insertSheet(body.tab);
      return _json({ ok: true });
    }
    return _json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
