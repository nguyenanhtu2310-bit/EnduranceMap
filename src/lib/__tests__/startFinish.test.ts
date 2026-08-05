import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKml } from '../kml';
import { runPipeline, type DistanceInput } from '../pipeline';
import { buildCourses, groupCoincidentPlacemarks, snapPlacemarks } from '../snap';
import { splitStartFinish, trafficStationName } from '../startFinish';

const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');

const inputs: DistanceInput[] = [
  {
    courseName: '10km',
    startTimeClock: '05:00',
    runnerCount: 500,
    startSpreadMinutes: 5,
    fastestMinPerKm: 3.5,
    typicalMinPerKm: 6.5,
    slowestMinPerKm: 10,
  },
  {
    courseName: 'Half Marathon',
    startTimeClock: '04:30',
    runnerCount: 800,
    startSpreadMinutes: 5,
    fastestMinPerKm: 3.5,
    typicalMinPerKm: 6.5,
    slowestMinPerKm: 10,
  },
];

const result = runPipeline(kml, inputs);
const entries = splitStartFinish(result);

describe('a point that both starts and finishes a race', () => {
  it('is counted as two, so neither crew reads the other’s numbers', () => {
    const split = entries.filter((e) => e.role !== 'whole');
    expect(split.length).toBeGreaterThan(0);
    // Both halves come from one placemark.
    const names = new Set(split.map((e) => e.name));
    for (const name of names) {
      expect(split.filter((e) => e.name === name).map((e) => e.role).sort()).toEqual([
        'finish',
        'start',
      ]);
    }
  });

  it('splits the arrivals rather than duplicating them', () => {
    for (const name of new Set(entries.filter((e) => e.role !== 'whole').map((e) => e.name))) {
      const halves = entries.filter((e) => e.name === name);
      const whole = result.stations.find((s) => s.schedule.name === name)!;
      const sum = (bins: { total: number }[]) => bins.reduce((n, b) => n + b.total, 0);
      expect(halves.reduce((n, h) => n + sum(h.distribution), 0)).toBe(sum(whole.distribution));
    }
  });

  it('keeps the start’s own busiest window off the finish', () => {
    for (const start of entries.filter((e) => e.role === 'start')) {
      const finish = entries.find((e) => e.name === start.name && e.role === 'finish')!;
      const peakOf = (e: typeof start) =>
        e.peakBinIndex >= 0 ? e.distribution[e.peakBinIndex].binStartSeconds : -1;
      expect(peakOf(start)).not.toBe(peakOf(finish));
    }
  });

  it('gives the lead markers to the finish, never the gun', () => {
    for (const start of entries.filter((e) => e.role === 'start')) {
      expect(start.leadArrivals).toEqual([]);
    }
  });

  it('lists the starts first, since that is where the field begins', () => {
    const lastStart = entries.map((e) => e.role).lastIndexOf('start');
    const firstOther = entries.findIndex((e) => e.role !== 'start');
    if (lastStart >= 0) expect(lastStart).toBeLessThan(firstOther);
  });

  it('leaves an ordinary checkpoint exactly as it was', () => {
    for (const entry of entries.filter((e) => e.role === 'whole')) {
      const station = result.stations.find((s) => s.schedule.name === entry.name)!;
      expect(entry.distribution).toBe(station.distribution);
      expect(entry.peakBinIndex).toBe(station.peakBinIndex);
      expect(trafficStationName(entry)).toBe(station.schedule.name);
    }
  });

  it('names the halves so a crew knows which page is theirs', () => {
    const start = entries.find((e) => e.role === 'start');
    if (start) {
      expect(trafficStationName(start)).toMatch(/ — Start$/);
      expect(trafficStationName(start, (e) => (e === 'Start' ? 'Xuất phát' : e))).toMatch(/ — Xuất phát$/);
    }
  });
});

describe('two points a few metres apart', () => {
  /** A start and a finish either side of one intersection, as Quang Tri drew them. */
  function mapWith(names: [string, string]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Map</name>
        <Folder><name>RACE ROUTE</name>
          <Placemark><name>5km</name><LineString><coordinates>
            106.64607,17.45777,0 106.64629,17.45777,0 106.64700,17.45800,0
          </coordinates></LineString></Placemark>
        </Folder>
        <Folder><name>TIMING</name>
          <Placemark><name>${names[0]}</name><Point><coordinates>106.64629,17.45777,0</coordinates></Point></Placemark>
          <Placemark><name>${names[1]}</name><Point><coordinates>106.64607,17.45777,0</coordinates></Point></Placemark>
        </Folder>
      </Document></kml>`;
  }

  function group(names: [string, string]) {
    const parsed = parseKml(mapWith(names));
    const courses = buildCourses(parsed.courses);
    return groupCoincidentPlacemarks(snapPlacemarks(parsed.placemarks, courses));
  }

  it('stays two stations when one is a start and the other a finish', () => {
    // 24 m apart — inside the 30 m merge, but they are two different jobs.
    const groups = group(['RUN START', 'RUN FINISH']);
    expect(groups).toHaveLength(2);
  });

  it('still merges two names for the same job', () => {
    // A finish drawn twice, or a checkpoint labelled per distance, is one station.
    expect(group(['FINISH', 'RUN FINISH'])).toHaveLength(1);
    expect(group(['CP1 10km', 'CP1 21km'])).toHaveLength(1);
  });

  it('treats a name carrying both words as one point doing both jobs', () => {
    expect(group(['SWIM START/FINISH', 'SWIM START/FNISH'])).toHaveLength(1);
  });

  it('reads the Vietnamese words too', () => {
    expect(group(['XUẤT PHÁT', 'VỀ ĐÍCH'])).toHaveLength(2);
  });
});
