import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseKml } from '../kml';

function loadFixture(name: string): string {
  const url = new URL(`../../test/fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8');
}

describe('parseKml', () => {
  const result = parseKml(loadFixture('sample.kml'));

  it('extracts one course per LineString under RACE ROUTE', () => {
    expect(result.courses).toHaveLength(2);
    expect(result.courses.map((c) => c.name)).toEqual(['10km', 'Half Marathon']);
    expect(result.courses[0].points).toHaveLength(2);
  });

  it('parses coordinates as {lat, lon}, converting from KML lon,lat,alt order', () => {
    const [first] = result.courses[0].points;
    expect(first.lat).toBeCloseTo(10.0, 6);
    expect(first.lon).toBeCloseTo(106.0, 6);
  });

  it('extracts point placemarks with their containing folder name', () => {
    expect(result.placemarks).toHaveLength(3);
    const byName = Object.fromEntries(result.placemarks.map((p) => [p.name, p]));

    expect(byName['KM5/10 Water Station (05:30 - 08:15)'].folder).toBe('CUT-OFF TIME');
    expect(byName['KM8/10 Turnaround'].folder).toBe('CUT-OFF TIME');
    expect(byName['Medical Post 1'].folder).toBe('MEDICAL STATION & AMBULANCE');
  });

  it('parses embedded km/time-window labels on placemarks', () => {
    const waterStation = result.placemarks.find((p) => p.name.startsWith('KM5/10'))!;
    expect(waterStation.label.kmFromName).toBe(5);
    expect(waterStation.label.raceDistanceFromName).toBe(10);
    expect(waterStation.label.timeWindow).toEqual({ open: '05:30', close: '08:15' });
    expect(waterStation.label.cleanName).toBe('Water Station');
  });

  it('leaves placemarks without a km label unparsed for that field', () => {
    const medical = result.placemarks.find((p) => p.name === 'Medical Post 1')!;
    expect(medical.label.kmFromName).toBeUndefined();
  });

  it('produces no warnings when a valid RACE ROUTE folder is present', () => {
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when no course LineStrings are found', () => {
    const empty = parseKml(`<?xml version="1.0"?><kml><Document></Document></kml>`);
    expect(empty.courses).toHaveLength(0);
    expect(empty.warnings.some((w) => w.includes('RACE ROUTE'))).toBe(true);
  });

  it('throws a clear error on malformed XML', () => {
    expect(() => parseKml('<kml><Document><Folder></kml>')).toThrow(/Invalid KML/);
  });
});
