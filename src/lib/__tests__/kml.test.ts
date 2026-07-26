import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKml } from '../kml';
import { buildCourses, snapPlacemarks } from '../snap';

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/test/fixtures', name), 'utf-8');
}

describe('parseKml', () => {
  const result = parseKml(loadFixture('sample.kml'));

  it('treats only LineStrings inside RACE ROUTE as courses', () => {
    expect(result.courses.map((c) => c.name)).toEqual(['10km', 'Half Marathon']);
  });

  it('keeps LineStrings from other folders as segments, not courses', () => {
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].folder).toBe('COURSE SETUP');
    expect(result.segments[0].label.timeWindow).toEqual({ open: '03:00', close: '04:24' });
  });

  it('parses coordinates as {lat, lon}, converting from KML lon,lat,alt order', () => {
    const [first] = result.courses[0].points;
    expect(first.lat).toBeCloseTo(10.0, 6);
    expect(first.lon).toBeCloseTo(106.0, 6);
  });

  it('extracts point placemarks with their containing folder name', () => {
    const byName = Object.fromEntries(result.placemarks.map((p) => [p.name, p]));
    expect(byName['Start'].folder).toBe('RACE ROUTE');
    expect(byName['MEDICAL 1 (03:00 - 09:30)'].folder).toBe('MEDICAL STATION & AMBULANCE');
    expect(byName['COT 1 (KM5/10 - 5:15 AM)'].folder).toBe('CUT-OFF TIME');
  });

  it('warns when no course folder is found, naming the folders it did see', () => {
    const other = parseKml(loadFixture('sample.kml'), { courseFolderName: 'NOT A FOLDER' });
    expect(other.courses).toHaveLength(0);
    expect(other.warnings[0]).toContain('RACE ROUTE');
  });

  it('throws a clear error on malformed XML', () => {
    expect(() => parseKml('<kml><Document><Folder></kml>')).toThrow(/Invalid KML/);
  });
});

describe('parseKml + snapPlacemarks on the sample course', () => {
  const parsed = parseKml(loadFixture('sample.kml'));
  const courses = buildCourses(parsed.courses);
  const snapped = snapPlacemarks(
    parsed.placemarks.filter((p) => p.folder === 'CUT-OFF TIME'),
    courses
  );
  const byName = Object.fromEntries(snapped.map((s) => [s.name, s]));

  it('measures the courses at their intended lengths', () => {
    expect(courses.find((c) => c.name === '10km')!.totalKm).toBeCloseTo(10, 1);
    expect(courses.find((c) => c.name === 'Half Marathon')!.totalKm).toBeCloseTo(21.1, 1);
  });

  it('reconciles every cut-off label with a computed crossing', () => {
    for (const s of snapped) {
      expect(s.labelMismatches, `${s.name} should have no mismatches`).toEqual([]);
    }
  });

  it('resolves a single cut-off time covering two distances', () => {
    const cot2 = byName['COT 2 (KM7.5/10 & KM7.5/21 - 6:00 AM)'];
    expect(cot2.label.cutoffs).toHaveLength(2);
    expect(cot2.label.cutoffs.map((c) => c.raceDistanceKm).sort()).toEqual([10, 21]);
    expect(cot2.label.cutoffs.every((c) => c.cutoffClock === '6:00 AM')).toBe(true);
  });

  it('resolves two separate cut-off windows on an out-and-back course', () => {
    const cot3 = byName['COT 3 (KM2.5/21 - 4:30 AM) (KM18.6/21 - 8:30 AM)'];
    expect(cot3.label.cutoffs.map((c) => c.km)).toEqual([2.5, 18.6]);

    // The Half passes this point outbound and again on the way back.
    const halfPasses = cot3.snaps.filter((s) => s.courseName === 'Half Marathon');
    expect(halfPasses).toHaveLength(2);
    const kms = halfPasses.map((s) => s.kmFromStart).sort((a, b) => a - b);
    expect(kms[0]).toBeCloseTo(2.5, 0);
    expect(kms[1]).toBeCloseTo(18.6, 0);
  });

  it('parses a km mark written without the KM prefix', () => {
    const cot4 = byName['COT 4 (9/10 - 7:15 AM)'];
    expect(cot4.label.cutoffs[0]).toMatchObject({ km: 9, raceDistanceKm: 10, cutoffClock: '7:15 AM' });
  });
});
