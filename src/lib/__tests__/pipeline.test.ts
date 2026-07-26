import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKml } from '../kml';
import { listPlacemarkFolders, runPipeline, type DistanceInput } from '../pipeline';

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

  describe('folder selection', () => {
    // A signage post drawn at the same spot as COT 1, which is where its cut-off lives.
    const withSignage = kml.replace(
      '<Folder>\n      <name>MEDICAL STATION &amp; AMBULANCE</name>',
      `<Folder>
      <name>SIGNAGE: STATION</name>
      <Placemark>
        <name>S1</name>
        <Point><coordinates>106.000000,10.045020,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>S2 &amp; S3</name>
        <Point><coordinates>106.000000,10.060000,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>MEDICAL STATION &amp; AMBULANCE</name>`
    );

    it('lists the folders holding point placemarks', () => {
      const names = listPlacemarkFolders(parseKml(withSignage).placemarks).map((f) => f.folder);
      expect(names).toContain('SIGNAGE: STATION');
      expect(names).toContain('CUT-OFF TIME');
    });

    it('schedules only the selected folder', () => {
      const signageOnly = runPipeline(withSignage, inputs, { stationFolders: ['SIGNAGE: STATION'] });
      expect(signageOnly.stations).toHaveLength(2);
      expect(signageOnly.stations.every((s) => s.folder === 'SIGNAGE: STATION')).toBe(true);
      expect(signageOnly.stations.some((s) => s.schedule.name.includes('COT'))).toBe(false);
    });

    it('keeps the cut-off from a co-located placemark in an unselected folder', () => {
      const signageOnly = runPipeline(withSignage, inputs, { stationFolders: ['SIGNAGE: STATION'] });
      const s1 = signageOnly.stations.find((s) => s.schedule.name === 'S1')!;

      // S1 sits on COT 1, so the 10km pass is still bound by that 5:15 AM cut-off.
      const tenK = s1.crossings.find((c) => c.courseName === '10km')!;
      expect(tenK.officialCutoffClock).toBe('5:15 AM');
      expect(s1.coLocatedNames).toContain('COT 1');
    });

    it('reports no co-located names for a station standing on its own', () => {
      const signageOnly = runPipeline(withSignage, inputs, { stationFolders: ['SIGNAGE: STATION'] });
      const s2 = signageOnly.stations.find((s) => s.schedule.name === 'S2 & S3')!;
      expect(s2.coLocatedNames).toEqual([]);
    });

    it('returns no stations when nothing is selected', () => {
      expect(runPipeline(withSignage, inputs, { stationFolders: [] }).stations).toHaveLength(0);
    });

    describe('sequential numbering', () => {
      const numbered = runPipeline(withSignage, inputs, {
        stationFolders: ['SIGNAGE: STATION'],
        renumberStationsAs: 'Station',
      });

      it('names stations in course order', () => {
        expect(numbered.stations.map((s) => s.schedule.name)).toEqual(['Station 1', 'Station 2']);
      });

      it('keeps the map names so the numbering stays checkable', () => {
        expect(numbered.stations[0].sourceNames).toEqual(['S1']);
        expect(numbered.stations[1].sourceNames).toEqual(['S2 & S3']);
      });

      it('carries the numbering into the cut-off table', () => {
        const rows = numbered.cutoffTable.filter((r) => r.stationName.startsWith('Station'));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => /^Station \d+$/.test(r.stationName))).toBe(true);
      });

      it('leaves the map names in place when numbering is off', () => {
        const plain = runPipeline(withSignage, inputs, { stationFolders: ['SIGNAGE: STATION'] });
        expect(plain.stations.map((s) => s.schedule.name)).toEqual(['S1', 'S2 & S3']);
      });
    });
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
