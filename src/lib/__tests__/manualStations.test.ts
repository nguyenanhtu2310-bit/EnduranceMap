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
    // Bound to this pass, so a return leg through the same point keeps its own deadline.
    expect(topas.label.cutoffs[0]?.km).toBe(26.2);
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

  it('keeps two stations of one name apart', () => {
    // Merged, the second one's crossings quietly join the first's and one tent serves
    // two places.
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
