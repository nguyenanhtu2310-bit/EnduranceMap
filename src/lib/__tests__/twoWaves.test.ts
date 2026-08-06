import { describe, expect, it } from 'vitest';
import { buildCourse } from '../geo';
import { runPipeline } from '../pipeline';
import { formatEventClock } from '../time';

/** One trail, run twice: a field the path cannot hold at once, split across two days. */
const course = buildCourse(
  Array.from({ length: 201 }, (_, i) => ({ lat: 22.0 + (21 / 111.32) * (i / 200), lon: 103.84 }))
);

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>RACE ROUTE</name><Placemark><name>21km</name><LineString><coordinates>${course
  .map((v) => `${v.lon},${v.lat},0`)
  .join(' ')}</coordinates></LineString></Placemark></Folder>
<Folder><name>CP</name><Placemark><name>CP1</name><Point><coordinates>103.84,22.09,0</coordinates></Point></Placemark></Folder>
</Document></kml>`;

const wave = (name: string, day: number) => ({
  courseName: name,
  sourceCourseName: '21km',
  startTimeClock: '08:00',
  startDayOffset: day,
  startSpreadMinutes: 10,
  runnerCount: 400,
  fastestMinPerKm: 4,
  typicalMinPerKm: 7,
  slowestMinPerKm: 11,
});

describe('two waves of one route', () => {
  const out = runPipeline(KML, [wave('21km Day 1', 0), wave('21km Day 2', 1)], {
    stationFolders: ['CP'],
  });

  it('gives each wave its own distance on the same trail', () => {
    expect(out.courses.map((c) => c.name).sort()).toEqual(['21km Day 1', '21km Day 2']);
    expect(out.courses[0].totalKm).toBeCloseTo(out.courses[1].totalKm, 6);
  });

  it('drops the route neither wave is named after, so nothing is scheduled twice', () => {
    expect(out.courses.map((c) => c.name)).not.toContain('21km');
  });

  it('crosses the checkpoint once for each wave', () => {
    const cp = out.stations[0];
    expect(cp.crossings.map((c) => c.courseName).sort()).toEqual(['21km Day 1', '21km Day 2']);
  });

  it('puts the second wave a day after the first, so the station stands twice', () => {
    const cp = out.stations[0];
    const [first, second] = cp.schedule.crossings;
    const p50 = (c: (typeof cp.schedule.crossings)[number]) =>
      c.arrivalPercentiles.find((p) => p.percentile === 50)!.seconds;
    expect(p50(second) - p50(first)).toBeCloseTo(86400, -1);
    console.log(
      `CP1 open ${formatEventClock(cp.schedule.openSeconds, '2026-09-25')} – ` +
        `${formatEventClock(cp.schedule.closeSeconds, '2026-09-25')}`
    );
    expect(cp.schedule.closeSeconds).toBeGreaterThan(86400);
  });
});
