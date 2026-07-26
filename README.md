# EnduranceMap — Race CP Operations Calculator

MVP feature for [endurancepath.org](https://endurancepath.org): upload a race KML
(from Google My Maps) plus optional results CSV or manual pace bands, and get back
a checkpoint operating schedule, crossing-time distributions, and a cut-off time
table. Fully client-side and stateless — no backend, no database.

## Stack

Vite + React + TypeScript, deployed as a static site to Cloudflare Pages.

## Requires Node.js

This machine did not have Node/npm installed when the project was scaffolded, so
none of the commands below have been run yet. Install Node 20+ (`nvm install 20` or
similar — an `.nvmrc` is included), then:

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
    geo.ts          # haversine distance, cumulative course distance, point-to-line snapping
    labels.ts       # parses "KM7.4/42" and "(03:00 - 09:30)" tokens out of placemark names
    kml.ts          # parses KML: RACE ROUTE LineStrings + Point placemarks with folder names
    snap.ts         # snaps placemarks onto courses, flags km-label mismatches, groups shared stations
    time.ts         # clock-time <-> seconds-since-midnight helpers
    csv.ts          # results CSV parsing + split-column-to-checkpoint matching via pace consistency
    percentiles.ts  # arrival-time percentile computation from raw data
    paceModel.ts    # models percentile arrivals from manual fastest/typical/slowest pace bands
    schedule.ts      # combines operating windows across distances, activity level, cutoff table
  lib/__tests__/    # vitest unit tests for everything above
  test/fixtures/    # sample.kml and sample-results.csv used by the tests
```

The UI (upload flow, tables, charts) has not been built yet — this pass covers the
parsing/calculation engine only, per the plan of building that first.

## Deploying to Cloudflare Pages

No `wrangler.toml` is needed for a static Pages site. In the Cloudflare Pages
dashboard, connect this repo and set:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

`vite build` (invoked by `npm run build`) produces a fully static `dist/` folder
that Pages serves directly — no server-side functions are used.

## Known MVP limitations

- Each placemark is snapped to at most one position per course (the closest point
  on that course's line). Courses that loop back on themselves and cross a station
  more than once are not yet modeled as multiple separate crossings.
- The pace-band model (used when no results CSV is available) interpolates in
  log-pace space between three anchor points (fastest/typical/slowest) — it's a
  reasonable approximation for an MVP, not a fitted distribution.
