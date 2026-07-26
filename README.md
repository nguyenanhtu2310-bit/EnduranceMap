# EnduranceMap — Race CP Operations Calculator

MVP feature for [endurancepath.org](https://endurancepath.org): upload a race KML
(from Google My Maps) plus optional results CSV or manual pace bands, and get back
a checkpoint operating schedule, crossing-time distributions, and a cut-off time
table. Fully client-side and stateless — no backend, no database.

## Stack

Vite + React + TypeScript, deployed as a static site to Cloudflare Pages.

## Requires Node.js

Node 20+ (an `.nvmrc` is included).

```bash
npm install
npm test
npm run dev
```

## Project layout

```
src/
  lib/
    config.ts       # all tunable thresholds/buffers in one place
    geo.ts          # haversine distance, cumulative course distance, multi-crossing snapping
    labels.ts       # parses km marks, cut-off times and operating windows out of placemark names
    kml.ts          # parses KML: race-route LineStrings, other segments, and Point placemarks
    snap.ts         # locates placemarks on courses, validates km labels, groups shared stations
    time.ts         # clock-time <-> seconds-since-midnight helpers, incl. AM/PM
    csv.ts          # results CSV parsing + split-column-to-checkpoint matching via pace consistency
    percentiles.ts  # arrival-time percentile computation from raw data
    paceModel.ts    # models percentile arrivals from manual fastest/typical/slowest pace bands
    schedule.ts     # combines operating windows across distances, activity level, cutoff table
  lib/__tests__/    # vitest unit tests for everything above
  test/fixtures/    # sample.kml and sample-results.csv used by the tests
```

The UI (upload flow, tables, charts) has not been built yet — this pass covers the
parsing/calculation engine only, per the plan of building that first.

## Notes from validating against a real race map

The engine was checked against a real Google My Maps export (a 42/21/10 km city
race). Behaviour that a synthetic fixture would not have surfaced:

- **Only one folder holds the race routes.** That file had 228 LineStrings, of which
  3 were courses; the other 225 were road-closure and course-setup spans. Course
  detection is therefore folder-scoped (`courseFolderName`, default `RACE ROUTE`),
  not "any LineString".
- **Measured routes run long.** The traced courses measured 42.55 / 21.21 / 10.03 km
  against official 42.195 / 21.098 / 10, i.e. ~0.5–0.8% over. Race distances named in
  labels are matched to courses by measured length within a tolerance, rather than by
  parsing course names.
- **Out-and-back courses pass a point more than once.** A checkpoint labelled both
  `KM14.5/21` and `KM35.5/42` is a single location the marathon crosses twice. Snapping
  returns every pass; the return-leg pass is usually the operationally important one.
- **Cut-off labels take several shapes**, all supported: `(KM7.4/42 - 4:10 AM)`, one
  time covering two distances (`KM15.3/42 & KM10.3/21`), two windows in one name, and
  a bare `27.5/42` with no `KM` prefix. Times may be 24-hour or AM/PM.
- **Names contain U+00A0**, not plain spaces, and occasionally malformed numbers
  (`KM14.4.5`). Malformed values are normalized and reported as warnings rather than
  silently guessed or dropped.

`sample.kml` mirrors this structure. The real map is not committed — point a scratch
test at it locally if you want to re-validate after changing the parser.

## Deploying to Cloudflare Pages

No `wrangler.toml` is needed for a static Pages site. In the Cloudflare Pages
dashboard, connect this repo and set:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

`vite build` (invoked by `npm run build`) produces a fully static `dist/` folder
that Pages serves directly — no server-side functions are used.

## Known MVP limitations

- **Start and finish lines that sit metres apart are indistinguishable by geometry
  alone.** Both resolve to two passes (0 km and the full course length); deciding
  which is which needs the placemark name, not the coordinates.
- The pace-band model (used when no results CSV is available) interpolates in
  log-pace space between three anchor points (fastest/typical/slowest) — it's a
  reasonable approximation for an MVP, not a fitted distribution.
- Crossing detection uses a fixed 50 m corridor. Two different roads running closer
  than that could register as an extra pass; `offsetKm` is reported on every snap so
  such cases stay visible.
- `PRE-FINISH`-style placemarks with no km label and no cut-off are parsed but are
  not treated as staffed stations.
