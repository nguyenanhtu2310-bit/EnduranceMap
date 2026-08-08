import { describe, expect, it } from 'vitest';
import { buildCourse } from '../geo';
import { MANUAL_FOLDER, manualPlacemarks, type ManualStation } from '../manualStations';

/** A straight course of a given length, running north, so km maps to latitude. */
const course = (km: number) =>
  buildCourse(
    Array.from({ length: 401 }, (_, i) => ({
      lat: 22 + (km / 111.32) * (i / 400),
      lon: 103.84,
    }))
  );

const courses = new Map([
  ['100km', course(100.9)],
  ['70km', course(69.8)],
]);

/**
 * The published VMM 100 km table, as a race writes it: name, cumulative km, cut-off.
 * Abridged to the rows that matter here.
 */
const CARD: ManualStation[] = [
  { name: 'CP M2', km: 5.6, courseName: '100km' },
  { name: 'CP M3', km: 12.4, courseName: '100km' },
  { name: 'WS Lếch Mông', km: 17.6, courseName: '100km' },
  { name: 'CP Topas Ecolodge', km: 26.2, courseName: '100km', cutoffClock: '12:00' },
  { name: 'CP3', km: 61.4, courseName: '100km', cutoffClock: '21:00' },
  { name: 'Finish', km: 100.9, courseName: '100km', cutoffClock: '09:00' },
];

describe('stations typed in from a published table', () => {
  it('places every row on the course', () => {
    const { placemarks, warnings } = manualPlacemarks(CARD, courses);
    expect(placemarks).toHaveLength(CARD.length);
    expect(warnings).toEqual([]);
    expect(new Set(placemarks.map((p) => p.folder))).toEqual(new Set([MANUAL_FOLDER]));
  });

  it('puts them where the table says, in order along the route', () => {
    // A straight north-running course, so a later kilometre is a higher latitude.
    const lats = manualPlacemarks(CARD, courses).placemarks.map((p) => p.coord.lat);
    expect(lats).toEqual([...lats].sort((a, b) => a - b));
  });

  it('places a station at the distance given, not near it', () => {
    const line = courses.get('100km')!;
    const total = line[line.length - 1].cumulativeKm;
    const [only] = manualPlacemarks([{ name: 'CP', km: total / 2, courseName: '100km' }], courses)
      .placemarks;
    // Half way along by distance is half way along by latitude, on a course running due
    // north — measured against the course's own length, not the advertised one.
    expect(only.coord.lat).toBeCloseTo((22 + line[line.length - 1].lat) / 2, 4);
  });

  it('carries a cut-off where the table publishes one', () => {
    const { placemarks } = manualPlacemarks(CARD, courses);
    const topas = placemarks.find((p) => p.name === 'CP Topas Ecolodge')!;
    expect(topas.label.cutoffs[0]?.cutoffClock).toBe('12:00');
    // Bound to its distance by that distance's length, not by kilometre: the station has
    // one position, and the kilometre each course measures to it is its own — which is
    // exactly the figure two published tables disagree about.
    expect(topas.label.cutoffs[0]?.raceDistanceKm).toBeCloseTo(100.9, 0);
    // And leaves the name alone — the cut-off is not part of what the station is called.
    expect(topas.label.cleanName).toBe('CP Topas Ecolodge');
  });

  it('leaves a station with no cut-off carrying none', () => {
    const { placemarks } = manualPlacemarks(CARD, courses);
    expect(placemarks.find((p) => p.name === 'CP M2')!.label.cutoffs).toEqual([]);
  });

  it('measures along the course it was told to', () => {
    // Both fixtures run due north from one start, so the same absolute distance lands in
    // the same place — what the course name settles is which route the kilometres are
    // counted along, and a 92.9 belongs to one of them and not the other.
    const onLong = manualPlacemarks([{ name: 'CP7', km: 92.9, courseName: '100km' }], courses);
    const onShort = manualPlacemarks([{ name: 'CP7', km: 92.9, courseName: '70km' }], courses);
    expect(onLong.placemarks).toHaveLength(1);
    expect(onShort.placemarks).toHaveLength(0);
  });

  it('reports a station past the end instead of stacking it on the finish', () => {
    // The usual cause is a table written for a longer distance. Pinning it silently
    // would hide that behind a plan that looks fine.
    const { placemarks, warnings } = manualPlacemarks(
      [{ name: 'CP7', km: 92.9, courseName: '70km' }],
      courses
    );
    expect(placemarks).toEqual([]);
    expect(warnings[0]).toContain('CP7');
    expect(warnings[0]).toMatch(/69\.\d km/);
  });

  it('says so when the course it measures along is not loaded', () => {
    const { warnings } = manualPlacemarks([{ name: 'CP', km: 5, courseName: '50km' }], courses);
    expect(warnings[0]).toContain('50km');
  });

  it('keeps one name where the same checkpoint is typed for two distances', () => {
    // The case that makes this usable at all: a checkpoint serving several distances is
    // typed once per distance, at each one's own cumulative kilometre. Both fixtures run
    // due north from one start, so km 30 is one place on either. Suffixed, they read
    // "CP3 / CP3 (2)" on a station that was correct underneath — which is how a right
    // answer gets disbelieved.
    const { placemarks } = manualPlacemarks(
      [
        { name: 'CP3', km: 30, courseName: '100km' },
        { name: 'CP3', km: 30, courseName: '70km' },
      ],
      courses
    );
    // Two placemarks — one per distance, each at its own kilometre — under one name and
    // one identity, which is what makes them a single station downstream.
    expect(placemarks.map((p) => p.name)).toEqual(['CP3', 'CP3']);
    expect(new Set(placemarks.map((p) => p.stationId)).size).toBe(1);
  });

  it('keeps two stations of one name apart when they are far apart', () => {
    // "WS" is what half the water stations on a card are called. Two of them sixty-five
    // kilometres apart are two places whatever they share, and merging them would have
    // one tent serving both.
    const { placemarks } = manualPlacemarks(
      [
        { name: 'WS', km: 17.6, courseName: '100km' },
        { name: 'WS', km: 82.9, courseName: '100km' },
      ],
      courses
    );
    expect(placemarks.map((p) => p.name)).toEqual(['WS', 'WS (2)']);
  });

  it('ignores a blank row rather than placing it at the start', () => {
    const { placemarks } = manualPlacemarks(
      [{ name: '  ', km: 10, courseName: '100km' }, { name: 'CP', km: 10, courseName: '100km' }],
      courses
    );
    expect(placemarks.map((p) => p.name)).toEqual(['CP']);
  });

  it('takes a finish typed longer than the route measures', () => {
    // A published 100.9 against a GPS 100.4 is not a mistake — one is measured along the
    // ground and the other along a line drawn on it — so the last row still lands.
    const line = courses.get('100km')!;
    const total = line[line.length - 1].cumulativeKm;
    const { placemarks, warnings } = manualPlacemarks(
      [{ name: 'Finish', km: total * 1.005, courseName: '100km' }],
      courses
    );
    expect(placemarks).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(placemarks[0].coord.lat).toBeCloseTo(line[line.length - 1].lat, 5);
  });

  it('refuses a row with no distance', () => {
    const { placemarks, warnings } = manualPlacemarks(
      [{ name: 'CP', km: Number.NaN, courseName: '100km' }],
      courses
    );
    expect(placemarks).toEqual([]);
    expect(warnings[0]).toContain('CP');
  });

  it('accepts the start itself', () => {
    const { placemarks } = manualPlacemarks([{ name: 'Start', km: 0, courseName: '100km' }], courses);
    expect(placemarks[0].coord.lat).toBeCloseTo(22, 5);
  });
});

describe('one station whose published distances disagree', () => {
  // The real case: a card puts the same water station at km 16.0 of its 21 km and at a
  // point 564 m away via its 10 km. One tent, two tables, two roundings.
  /** A line between two latitudes, so a short course can share the long one's ground. */
  const between = (fromLat: number, toLat: number) =>
    buildCourse(
      Array.from({ length: 401 }, (_, i) => ({
        lat: fromLat + (toLat - fromLat) * (i / 400),
        lon: 103.84,
      }))
    );

  // The 21 km runs the whole line; the 10 km joins it half way and shares it to the end,
  // which is how a card with two distances on one trail is actually laid out.
  const LONG_FROM = 22.0;
  const LONG_TO = 22.0 + 22.1 / 111.32;
  const SHORT_FROM = LONG_FROM + (LONG_TO - LONG_FROM) * 0.51;
  const near = new Map([
    ['21km', between(LONG_FROM, LONG_TO)],
    ['10km', between(SHORT_FROM, LONG_TO)],
  ]);
  /** The 10 km distance to a point the 21 km calls `km`. */
  const onShort = (km: number) => {
    const lat = LONG_FROM + (LONG_TO - LONG_FROM) * (km / 22.1);
    return ((lat - SHORT_FROM) / (LONG_TO - SHORT_FROM)) * 10.83;
  };

  it('gives each distance its own kilometre, and only its own', () => {
    // Each row speaks for the distance it was typed against. Left to geometry the 10 km's
    // row would also land on the 21 km, half a kilometre from where the 21 km's own table
    // puts the tent — a second crossing no runner makes and no published figure supports.
    const { placemarks } = manualPlacemarks(
      [
        { name: 'WS', km: 16.0, courseName: '21km' },
        { name: 'WS', km: onShort(16.5), courseName: '10km' },
      ],
      near
    );
    expect(placemarks).toHaveLength(2);
    expect(placemarks.map((p) => p.onlyCourses)).toEqual([['21km'], ['10km']]);
    // Both under one identity, so they are one station however far apart they sit.
    expect(new Set(placemarks.map((p) => p.stationId)).size).toBe(1);
    expect(new Set(placemarks.map((p) => p.name)).size).toBe(1);
  });

  it('plans it as one station rather than two', () => {
    const { placemarks } = manualPlacemarks(
      [
        { name: 'WS Lếch Mông', km: 16.0, courseName: '21km' },
        { name: 'WS Lếch Mông', km: onShort(16.5), courseName: '10km', cutoffClock: '12:30' },
      ],
      near
    );
    // Two placemarks, one identity — which is what makes them one station downstream.
    expect(new Set(placemarks.map((p) => p.stationId)).size).toBe(1);
    expect(placemarks.every((p) => p.name === 'WS Lếch Mông')).toBe(true);
  });

  it('says the two distances disagree, and by how much', () => {
    // Silently picking one would hide a discrepancy only the operator can settle.
    const { warnings } = manualPlacemarks(
      [
        { name: 'WS Lếch Mông', km: 16.0, courseName: '21km' },
        { name: 'WS Lếch Mông', km: onShort(16.5), courseName: '10km' },
      ],
      near
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('WS Lếch Mông');
    expect(warnings[0]).toMatch(/\d+ m apart/);
    expect(warnings[0]).toContain('21km');
  });

  it('says nothing when they agree', () => {
    const { warnings } = manualPlacemarks(
      [
        { name: 'WS', km: 16.0, courseName: '21km' },
        { name: 'WS', km: onShort(16.02), courseName: '10km' },
      ],
      near
    );
    expect(warnings).toEqual([]);
  });

  it('positions it from the longest course it was given', () => {
    // A kilometre is measured more reliably along a long route than a short one.
    // The warning names the longest course, because a kilometre is measured more
    // reliably along a long route than a short one.
    const { warnings } = manualPlacemarks(
      [
        { name: 'WS', km: onShort(16.5), courseName: '10km' },
        { name: 'WS', km: 16.0, courseName: '21km' },
      ],
      near
    );
    expect(warnings[0]).toContain('21km km 16.0');
  });

  it('keeps each distance’s own cut-off', () => {
    const { placemarks } = manualPlacemarks(
      [
        { name: 'WS', km: 16.0, courseName: '21km', cutoffClock: '15:00' },
        { name: 'WS', km: onShort(16.5), courseName: '10km', cutoffClock: '12:30' },
      ],
      near
    );
    const clocks = placemarks.flatMap((p) => p.label.cutoffs.map((c) => c.cutoffClock)).sort();
    expect(clocks).toEqual(['12:30', '15:00']);
  });
});
