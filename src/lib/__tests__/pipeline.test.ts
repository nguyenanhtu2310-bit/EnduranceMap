import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline, type DistanceInput } from '../pipeline';

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/test/fixtures', name), 'utf-8');
}

const kml = loadFixture('sample.kml');

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

describe('runPipeline', () => {
  const result = runPipeline(kml, inputs);

  it('builds schedules for the stations on the course', () => {
    expect(result.courses.map((c) => c.name)).toEqual(['10km', 'Half Marathon']);
    expect(result.stations.length).toBeGreaterThan(0);
  });

  it('orders stations by their first crossing along the course', () => {
    const firstKms = result.stations.map((s) => Math.min(...s.crossings.map((c) => c.kmFromStart)));
    for (let i = 1; i < firstKms.length; i++) {
      expect(firstKms[i]).toBeGreaterThanOrEqual(firstKms[i - 1]);
    }
  });

  it('opens a station before its first arrival and closes it after the last', () => {
    for (const station of result.stations) {
      expect(station.schedule.openClockTime < station.schedule.closeClockTime).toBe(true);
    }
  });

  it('schedules both legs of an out-and-back station as separate crossings', () => {
    const cot3 = result.stations.find((s) => s.schedule.name.includes('COT 3'))!;
    const halfPasses = cot3.crossings.filter((c) => c.courseName === 'Half Marathon');
    expect(halfPasses).toHaveLength(2);
    expect(halfPasses.every((p) => p.passCount === 2)).toBe(true);
  });

  it('applies each cut-off to the pass it belongs to, not to every pass', () => {
    const cot3 = result.stations.find((s) => s.schedule.name.includes('COT 3'))!;
    const outbound = cot3.crossings.find((c) => c.courseName === 'Half Marathon' && c.kmFromStart < 10)!;
    const inbound = cot3.crossings.find((c) => c.courseName === 'Half Marathon' && c.kmFromStart > 10)!;
    expect(outbound.officialCutoffClock).toBe('4:30 AM');
    expect(inbound.officialCutoffClock).toBe('8:30 AM');
  });

  it('holds a shared station open for the slowest distance still on course', () => {
    // COT 1 carries a 10km cut-off of 05:15, but the Half Marathon also passes it and
    // comes back through on its return leg. The station closes on the latest distance,
    // not on the first cut-off to expire.
    const cot1 = result.stations.find((s) => s.schedule.name.includes('COT 1'))!;

    const tenK = cot1.crossings.find((c) => c.courseName === '10km')!;
    expect(tenK.officialCutoffClock).toBe('5:15 AM');

    const halfReturn = cot1.crossings.find((c) => c.courseName === 'Half Marathon' && c.kmFromStart > 10);
    expect(halfReturn).toBeDefined();
    expect(cot1.schedule.closeClockTime > '05:15:00').toBe(true);
  });

  it('attaches a cut-off only to the distance its label names', () => {
    // COT 4's label reads "9/10", so the 10km pass is bound by 7:15 AM while the Half
    // Marathon passes at the same spot with no cut-off of its own.
    const cot4 = result.stations.find((s) => s.schedule.name.includes('COT 4'))!;

    const tenK = cot4.crossings.find((c) => c.courseName === '10km')!;
    expect(tenK.officialCutoffClock).toBe('7:15 AM');

    const half = cot4.crossings.filter((c) => c.courseName === 'Half Marathon');
    expect(half.length).toBeGreaterThan(0);
    expect(half.every((c) => c.officialCutoffClock === undefined)).toBe(true);
  });

  it('flags a station whose modeled arrivals run past its cut-off', () => {
    const rows = result.cutoffTable.filter((r) => r.exceeded);
    for (const row of rows) {
      expect(row.modeledLastArrivalClockTime > row.cutoffClockTime.padStart(8, '0')).toBeTruthy();
    }
    expect(result.cutoffTable.length).toBeGreaterThan(0);
  });

  it('warns when a course has no pace band entered', () => {
    const partial = runPipeline(kml, [inputs[0]]);
    expect(partial.warnings.some((w) => w.includes('Half Marathon'))).toBe(true);
  });

  it('surfaces malformed km values from the source map as warnings', () => {
    const withTypo = kml.replace('KM2.5/21', 'KM2.5.5/21');
    const typoResult = runPipeline(withTypo, inputs);
    expect(typoResult.warnings.some((w) => w.includes('2.5.5'))).toBe(true);
  });

  it('excludes a placemark listed in excludePlacemarkNames', () => {
    const without = runPipeline(kml, inputs, { excludePlacemarkNames: ['COT 1 (KM5/10 - 5:15 AM)'] });
    expect(without.stations.some((s) => s.schedule.name.includes('COT 1'))).toBe(false);
  });

  it('keeps a staffed position that happens to sit beside an unlabeled course marker', () => {
    // A marker with no km and no cut-off is skipped on its own, but must not remove a
    // neighbouring station from the schedule when the two merge into one group.
    const withMarker = kml.replace(
      '<Folder>\n      <name>MEDICAL STATION &amp; AMBULANCE</name>',
      `<Folder>
      <name>CUT-OFF TIME</name>
      <Placemark>
        <name>PRE-FINISH</name>
        <Point><coordinates>106.000000,10.030000,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>MEDICAL STATION &amp; AMBULANCE</name>`
    );

    const merged = runPipeline(withMarker, inputs);
    expect(merged.stations.some((s) => s.schedule.name.includes('MEDICAL 1'))).toBe(true);
  });
});
