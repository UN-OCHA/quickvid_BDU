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
