# QuickVid analytics — one-time setup (~5 minutes)

The Premiere panel can send **anonymous** usage pings so we can see which features
get used and on which platform. It ships **switched off**: until you paste an
endpoint into `premiere/cep/js/analytics.js`, no request leaves anyone's machine.

QuickVid gets its **own** sheet and deployment, deliberately separate from the
DataViz plugin's. That endpoint appends every ping to one flat log whose dashboard
counts all rows, so mixing QuickVid events in would inflate the DataViz figures.

## What is sent

Three values per ping, and nothing else:

| Field | Example | Why |
|---|---|---|
| `v` — panel version | `0.27.0` | shows how fast people take updates |
| `e` — event | `open:mac`, `add:lt:reels`, `gradient:bottom`, `tool:reel` | which features are used |
| `loc` — approximate location | `Geneva, Switzerland` | city/country from the IP, nothing finer |

**Never sent:** typed text, names, job titles, project or sequence names, file
paths, or anything from the video. There is no user id — pings can't be tied to a
person. Keep it that way if you add events.

## Setup

1. **Create the sheet.** New Google Sheet, name it e.g. *OCHA QuickVid — analytics*.
2. **Add the script.** In that sheet: **Extensions → Apps Script**. Delete the
   placeholder code and paste all of `tools/quickvid-analytics.gs`.
3. **Set the token.** At the top of the script, change
   `var TOKEN = 'CHANGE-ME-quickvid-analytics';` to a long random string. This
   gates the read/write admin API, not the pings. Save.
4. **Deploy.** **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**  ← required, the panel calls it unauthenticated
   - Deploy, approve the permission prompt, and copy the **/exec URL**.
5. **Wire the panel.** Paste that URL into `ENDPOINT` at the top of
   `premiere/cep/js/analytics.js`, then commit and push.
6. **Check it.** Open the panel in Premiere; within a few seconds a row should
   appear in the sheet's **Events** tab (`open:mac` or `open:win`).

Keep the /exec URL and token in your private CLAUDE.md, next to the DataViz ones —
**not** in a public commit message or issue.

## Reading it back without a browser

Same pattern as the DataViz sheet — Apps Script 302-redirects, so use Python, not
curl:

```python
import json, urllib.request, urllib.parse
EXEC  = "<your /exec URL>"
TOKEN = "<your token>"
q = urllib.parse.urlencode({"action": "read", "tab": "Events", "token": TOKEN})
print(json.load(urllib.request.urlopen(EXEC + "?" + q))["values"][:5])
```

## Turning it off

Blank the `ENDPOINT` string in `premiere/cep/js/analytics.js` and push — the client
becomes a no-op again. To stop an already-installed panel, archive the deployment
(**Deploy → Manage deployments → Archive**); pings then fail silently.

---

## The web app reports too (2026-08-04)

Both products ping the **same deployment**, tagged by product, and land on
**separate tabs of the same spreadsheet** — Javi's call, so the two can have
separate dashboards later:

| Product | `p=` | Tab |
|---|---|---|
| Premiere plugin | `plugin`, or absent | `Events` |
| Web app | `webapp` | `Events Web App` |

**`p` absent means `plugin`.** That is deliberate: every panel already installed
in the field sends no `p`, and must keep logging exactly where it always did. Do
not "tidy" this into a required parameter — it would silently drop every ping
from every panel that hasn't updated yet.

The `Events Web App` tab is created automatically on the first web-app ping, with
the same header as `Events`.

### Redeploy after changing `quickvid-analytics.gs`

Editing the script is **not** enough — the live `/exec` URL keeps serving the old
code until you publish a new version:

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Paste the current `tools/quickvid-analytics.gs`.
3. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.**
   Use *edit the existing deployment*, not "New deployment" — a new deployment
   gets a NEW `/exec` URL, and every panel in the field is hardcoded to the old
   one.

Until that redeploy happens, web-app pings still arrive but the old code ignores
`p` and files them under `Events`, mixed in with the plugin's.

### Web app client

`browser/analytics.js`. Differences from the panel's copy:

- an `<img>` beacon rather than `XMLHttpRequest` (no CORS preflight to fail);
- location is the browser's **time zone**, not a geo lookup;
- a user-facing **opt-out** — footer → *Privacy* → "Don't send anything at all",
  stored in `localStorage` under `quickvid.analytics.off`.

The opt-out exists because the app's headline promise is "your videos never leave
your computer". Anything that does leave has to be listed in plain words with an
off switch beside it. The Privacy modal lists the exact four fields — keep it
accurate if you ever add one.

### Turning the web app off

Blank `ENDPOINT` in `browser/analytics.js` and bump `VERSION`.
