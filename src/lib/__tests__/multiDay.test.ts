import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { formatEventClock } from '../time';

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>RACE ROUTE</name>
<Placemark><name>long</name><LineString><coordinates>
103.84,22.00,0 103.84,22.20,0 103.84,22.40,0 103.84,22.60,0 103.84,22.90,0
</coordinates></LineString></Placemark></Folder>
<Folder><name>CP</name>
<Placemark><name>CP1</name><Point><coordinates>103.84,22.60,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

describe('a race that spans days', () => {
  it('puts a Friday start and its Sunday cut-off on one timeline', () => {
    const out = runPipeline(KML, [{
      courseName: 'long', startTimeClock: '08:00', startDayOffset: 0,
      startSpreadMinutes: 5, runnerCount: 200,
      fastestMinPerKm: 6, typicalMinPerKm: 14, slowestMinPerKm: 22,
      organizerCutoffClock: '09:00', cutoffDayOffset: 2,
    }], { stationFolders: ['CP'] });

    const s = out.stations[0].schedule;
    console.log(`open  ${formatEventClock(s.openSeconds, '2026-09-25')}`);
    console.log(`close ${formatEventClock(s.closeSeconds, '2026-09-25')}`);
    console.log(`open seconds ${s.openSeconds}, close ${s.closeSeconds}`);
    // A slow field on a ~67 km course at 22 min/km runs past midnight.
    expect(s.closeSeconds).toBeGreaterThan(86400);
    expect(formatEventClock(s.openSeconds, '2026-09-25')).toMatch(/^Fri /);
    expect(formatEventClock(s.closeSeconds, '2026-09-25')).toMatch(/^Sat /);
  });

  it('starts a Saturday distance a day after a Friday one', () => {
    const base = { courseName: 'long', startSpreadMinutes: 0, runnerCount: 100,
      fastestMinPerKm: 6, typicalMinPerKm: 6, slowestMinPerKm: 6 };
    const fri = runPipeline(KML, [{ ...base, startTimeClock: '08:00', startDayOffset: 0 }], { stationFolders: ['CP'] });
    const sat = runPipeline(KML, [{ ...base, startTimeClock: '08:00', startDayOffset: 1 }], { stationFolders: ['CP'] });
    const gap = sat.stations[0].schedule.openSeconds - fri.stations[0].schedule.openSeconds;
    console.log(`gap between a Friday and a Saturday start: ${gap} s = ${gap / 3600} h`);
    expect(gap).toBe(86400);
  });
});
