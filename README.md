# Lift Log

Personal workout and body-weight tracker. A static, installable web app (PWA) with no
build step and no server. Data lives on the device and is backed up as a JSON file
in a private GitHub repository.

- **Workouts**: six predefined templates (editable), set-by-set logging with the previous
  session's numbers shown next to each input and a ▲ / = / ▼ marker per set.
- **Myo-rep match sets**: the activation reps go in the Reps box, the mini-set reps in the
  MYO box (`4 4 3`). Matching in fewer mini-sets counts as progress.
- **Progress**: per exercise (top weight, estimated 1RM, volume, total reps) and per workout
  (session volume) over 7 d / 14 d / 30 d / 3 m / 6 m / 1 y / all.
- **Body weight**: daily entries, chart with 7-day rolling average and trend line, mean,
  median, change and kg/week for any period or a custom date range.
- **Offline**: service worker caches the app; syncs when back online.
- Light / dark / system theme.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | shell and styles |
| `js/app.js` | views, routing, event handling |
| `js/store.js` | localStorage persistence, merge of two data copies |
| `js/sync.js` | GitHub Contents API push/pull |
| `js/stats.js` | progression and weight statistics |
| `js/templates.js` | default workout split |
| `js/charts.js` | Chart.js wrapper (theme-aware) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA bits |
| `deploy.ps1` | one-time setup: create repos, push, enable GitHub Pages |

## Data model

Everything is one JSON document (`data.json` in the data repo):

```json
{
  "version": 1,
  "templates": [{ "id": "w1", "name": "Workout 1", "exercises": [{ "id": "squat", "name": "Squat", "sets": 2, "rest": 300, "myoLast": false, "supersetWithPrev": false }] }],
  "sessions":  [{ "id": "…", "templateId": "w1", "date": "2026-09-05", "exercises": [{ "id": "squat", "name": "Squat", "sets": [{ "kg": 100, "reps": 8, "myo": [] }] }], "notes": "", "updatedAt": 0 }],
  "weights":   [{ "date": "2026-09-05", "kg": 82.4, "updatedAt": 0 }]
}
```

Every record has `updatedAt`; when the phone and the desktop disagree, the newer record wins.
Deletions are tombstones (`deleted: true`) so they survive a merge.

## Setup

1. Run `deploy.ps1` once (needs `gh auth login` first). It creates the public code repo,
   the private `workout-data` repo with an empty `data.json`, pushes, and enables GitHub Pages.
2. Create a fine-grained personal access token limited to the data repo with
   *Contents: read and write*. Paste it into the app under Settings → Backup & sync.
3. On the iPhone open the Pages URL in Safari → Share → **Add to Home Screen**.

## Local development

Any static file server works, e.g. `npx serve .` or `python -m http.server 8765`, then open
`http://localhost:8765/`.
