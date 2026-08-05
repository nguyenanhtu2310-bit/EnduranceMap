import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline, type DistanceInput } from '../pipeline';
import { buildCrewSheetsHtml } from '../crewSheets';

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
    leaders: [
      { sex: 'M', startOffsetSeconds: 0, paceMinPerKm: 4, finishSeconds: 40 * 60 },
      { sex: 'F', startOffsetSeconds: 30, paceMinPerKm: 5, finishSeconds: 50 * 60 },
    ],
  },
];

const result = runPipeline(kml, inputs);
const html = buildCrewSheetsHtml(result, { raceName: 'Fixture race' });

describe('crew sheets', () => {
  it('gives every station a page of its own', () => {
    expect((html.match(/class="sheet"/g) ?? []).length).toBe(result.stations.length);
  });

  it('asks the printer for A4 landscape', () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*A4 landscape/);
  });

  it('breaks the page after each station but not after the last', () => {
    expect(html).toContain('page-break-after: always');
    expect(html).toMatch(/\.sheet:last-child\s*\{[^}]*page-break-after: auto/);
  });

  it('prints the figure on every bar, since paper has no tooltip', () => {
    const first = html.slice(html.indexOf('class="sheet"'));
    const svg = first.slice(first.indexOf('<svg'), first.indexOf('</svg>'));
    const bars = (svg.match(/<rect /g) ?? []).length;
    const numbers = [...svg.matchAll(/<text[^>]*>([\d,]+)<\/text>/g)].length;
    expect(bars).toBeGreaterThan(0);
    expect(numbers).toBe(bars);
  });

  it('names the station and the race on each page', () => {
    for (const station of result.stations) {
      expect(html).toContain(station.schedule.name);
    }
    expect(html).toContain('Fixture race');
  });

  it('carries traffic and nothing else', () => {
    // The sheet was deliberately kept to traffic: no cut-off, no amenity columns, no
    // notes strip. A crew page that grows extra sections stops fitting one page.
    expect(html).not.toContain('Proposed cut-off');
    expect(html).not.toContain('Provided COT');
    expect(html).not.toContain('Gap from previous');
    expect(html).not.toContain('Activity');
  });

  it('states the four facts a crew reads first', () => {
    for (const label of ['Operating time', 'Total visits', 'Busiest', 'First through']) {
      expect(html).toContain(label);
    }
  });

  it('speaks whatever language the app is in', () => {
    const vi = buildCrewSheetsHtml(result, {
      raceName: 'Fixture race',
      t: (english) => (english === 'Operating time' ? 'Thời gian vận hành' : english),
    });
    expect(vi).toContain('Thời gian vận hành');
    expect(vi).not.toContain('>Operating time<');
  });

  it('prints only the stations asked for', () => {
    const one = result.stations[0].schedule.name;
    const single = buildCrewSheetsHtml(result, { raceName: 'Fixture race', only: [one] });
    expect((single.match(/class="sheet"/g) ?? []).length).toBe(1);
    expect(single).toContain(one);
  });

  it('opens offline, with nothing to fetch', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('fitting one A4 landscape page', () => {
  /**
   * An SVG scaled to the page width renders at width x (viewBox height / viewBox width),
   * so the printed height of each chart is knowable from the markup alone. Checking the
   * outcome rather than the formula: if a heading grows or a row is added, the arithmetic
   * still says it fits while the paper says otherwise, and this is what notices.
   */
  const PAGE_W_MM = 277;
  const PAGE_H_MM = 190;

  const PX_PER_MM = 96 / 25.4;

  function sheets(html: string) {
    return [...html.matchAll(/<section class="sheet">([\s\S]*?)<\/section>/g)].map((m) => {
      const body = m[1];
      const vb = body.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
      // A drawing narrower than the paper carries its own cap; the rest fill the width.
      const capped = body.match(/<svg[^>]*max-width:(\d+)px/);
      const renderMM = capped ? Number(capped[1]) / PX_PER_MM : PAGE_W_MM;
      const chartMM = (renderMM * Number(vb[2])) / Number(vb[1]);
      const rows = (body.match(/<tr>/g) ?? []).length;
      return { chartMM, rows, cappedMM: capped ? renderMM : null };
    });
  }

  it('leaves every station room to spare on its page', () => {
    // Measured from the rendered sheet: heading, facts, key and footer come to ~34mm,
    // and each table row to ~4.7mm.
    for (const { chartMM, rows } of sheets(html)) {
      const totalMM = 34 + rows * 4.7 + chartMM;
      expect(totalMM).toBeLessThanOrEqual(PAGE_H_MM);
      // And not so short that the page trails off into white paper.
      expect(totalMM).toBeGreaterThan(PAGE_H_MM - 20);
    }
  });

  it('gives a station carrying more distances a shorter chart', () => {
    // The table grows with the races through a point, so the chart has to yield to it
    // or the page overflows on exactly the busiest stations.
    const many = runPipeline(kml, [
      inputs[0],
      { ...inputs[0], courseName: 'Half Marathon', startTimeClock: '04:30' },
    ]);
    const wide = sheets(buildCrewSheetsHtml(many, { raceName: 'Fixture race' }));
    const shared = wide.find((s) => s.rows > 2);
    const alone = sheets(html)[0];
    expect(shared, 'the fixture should have a station serving both distances').toBeTruthy();
    expect(shared!.chartMM).toBeLessThan(alone.chartMM);
  });

  it('never draws wider than the paper', () => {
    for (const { cappedMM } of sheets(html)) {
      if (cappedMM !== null) expect(cappedMM).toBeLessThanOrEqual(PAGE_W_MM);
    }
  });

  it('never squashes the bars below a readable height', () => {
    // Where fitting by height would flatten the bars, the drawing narrows instead — so
    // the plot keeps its minimum whatever the station's shape.
    const bands = 16 + 20;
    for (const m of html.matchAll(/viewBox="0 0 [\d.]+ ([\d.]+)"/g)) {
      expect(Number(m[1]) - bands).toBeGreaterThanOrEqual(150);
    }
  });
});
