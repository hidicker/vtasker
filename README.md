# VTasker

Plan paragliding and hang-gliding cross-country tasks, share them, and put a
date on them so other pilots can join.

Live at **https://nbparagliding.nz/vtasker/**

## What it does

- **Quick task builder.** Tap a route on the map and VTasker places the turnpoint
  cylinders so that route becomes the shortest path. It names a task after its
  nearest launch and length, e.g. "Tasman 33km".
- **Task Library.** Publish tasks, browse them on a map or as a list, vote on
  them, and copy one to change it.
- **Fly Days.** Schedule a task for a date (elapsed time or race to goal), invite
  pilots with a link, and see who is in. Days can sit under a competition.
- **XCTrack.** A QR code, an "Open in XCTrack" link and a short XContest code
  each load a task onto an instrument.
- **Map.** A waypoint library built from the `data/` folder, launch sites from
  ParaglidingEarth, airspace from openAIP (advisory only), and skyways and
  thermals from thermal.kk7.ch.
- **Results (beta).** Upload an IGC file for simplified GAP-style scoring and an
  Elo-style ranking.

## Run it locally

Needs Node.js. The task builder and map work with no backend at all; sharing,
Fly Days and results need a (free) Supabase project, set up as described in
[SETUP.md](SETUP.md).

```
npm install
cp .env.local.example .env.local     # then fill in your Supabase URL and anon key
npm run dev
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm run fetch:sites` | Refresh the launch-site snapshot from ParaglidingEarth |
| `npm run fetch:airspace` | Refresh the airspace snapshot. Needs `OPENAIP_API_KEY` in the environment; do not give it a `VITE_` prefix, which would put it in the browser bundle |
| `npm run deploy` | Build and upload over WebDAV; see `scripts/deploy.mjs` |

`.env.local` is git-ignored. Keep keys and passwords there and nowhere else.

## Adding waypoints

Drop files into `data/`; no code changes needed. See
[data/README.md](data/README.md).

## Data and third-party material

The licence below covers the code. These data files keep their publishers' terms
(full detail in [NOTICE](NOTICE)):

| Where | What | Terms |
| --- | --- | --- |
| `lib/launchSites.json` | Launch sites, from ParaglidingEarth | CC BY-SA 3.0 |
| `lib/airspace/` | Airspace, from openAIP | CC BY-NC 4.0, advisory only |
| `data/` | Waypoint sets from clubs and organisers | Their publishers' own terms |

## Licence

Copyright (C) 2026 hidicker.

VTasker is free software under the GNU Affero General Public Licence, version 3
or later ([LICENSE](LICENSE)). You may run, study, share and change it. If you
change it and let other people use your version, including over a network, you
have to offer them its source too. Provided as is, without warranty of any kind.
