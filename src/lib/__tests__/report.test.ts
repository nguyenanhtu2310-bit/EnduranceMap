import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AMENITY_RULES } from '../amenities';
import { runPipeline, type DistanceInput } from '../pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from '../time';
import { buildReportHtml } from '../report';
import { buildReportSheets } from '../workbook';

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
];

const result = runPipeline(kml, inputs);

const html = buildReportHtml(result, {
  raceName: 'Fixture race',
  rules: DEFAULT_AMENITY_RULES,
  overrides: {},
});

const sheets = buildReportSheets(result, {
  raceName: 'Fixture race',
  rules: DEFAULT_AMENITY_RULES,
  overrides: {},
});

/** The cut-off section, so a match cannot come from some other table. */
function cutoffSection(): string {
  const start = html.indexOf('<h2>Cut-off times</h2>');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</table>', start));
}

describe('the printed cut-off section', () => {
  it('carries the same columns as the screen, in the same order', () => {
    const headers = [...cutoffSection().matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual([
      'Station',
      'Distance',
      'Km',
      'Slowest arrival',
      'Proposed cut-off',
      'Margin',
      'Provided COT',
    ]);
  });

  it('prints the cut-off the organiser provided, not only the proposed one', () => {
    const row = result.cutoffTable.find((r) => r.mapClockTime);
    expect(row, 'the fixture should carry at least one provided cut-off').toBeTruthy();
    // The map writes cut-offs loosely ("5:15 "); the report pads them to a clock.
    const clock = secondsToClockTime(parseClockTimeToSeconds(row!.mapClockTime!)!).slice(0, 5);
    expect(cutoffSection()).toContain(clock);
  });

  it('gives every row a cell for each column', () => {
    for (const row of cutoffSection().matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>/g)].length;
      expect(cells).toBe(7);
    }
  });

  it('states the margin between the modelled tail and the proposed cut-off', () => {
    expect(cutoffSection()).toMatch(/\+\d+ min/);
  });
});

describe('the exported workbook', () => {
  it('calls a station a station, never a position', () => {
    const summary = sheets.find((s) => s.name === 'Summary')!;
    const text = summary.rows.flat().join('|');
    expect(text).toContain('Stations');
    expect(text.toLowerCase()).not.toContain('position');
  });

  it('counts the stations on the cover sheet', () => {
    const summary = sheets.find((s) => s.name === 'Summary')!;
    const row = summary.rows.find((r) => r[0] === 'Stations')!;
    expect(row[1]).toBe(result.stations.length);
  });

  it('gives the cut-off sheet a provided-COT column beside the proposal', () => {
    const sheet = sheets.find((s) => s.name === 'Cut-off times')!;
    expect(sheet.rows[0]).toEqual([
      'Distance',
      'Station',
      'Km',
      'Slowest arrival',
      'Proposed cut-off',
      'Margin (min)',
      'Provided COT',
      'Provided is tighter',
    ]);
  });

  it('writes the provided cut-off into that column', () => {
    const sheet = sheets.find((s) => s.name === 'Cut-off times')!;
    const provided = sheet.rows.slice(1).map((r) => r[6]).filter(Boolean);
    expect(provided.length).toBeGreaterThan(0);
  });

  it('writes the margin as a number, so a spreadsheet can sort on it', () => {
    const sheet = sheets.find((s) => s.name === 'Cut-off times')!;
    for (const row of sheet.rows.slice(1)) {
      if (row[5] !== '') expect(typeof row[5]).toBe('number');
    }
  });
});

describe('the printed distribution chart', () => {
  const withLeaders = runPipeline(kml, [
    {
      ...inputs[0],
      leaders: [
        { sex: 'M', startOffsetSeconds: 0, paceMinPerKm: 4, finishSeconds: 40 * 60 },
        { sex: 'F', startOffsetSeconds: 30, paceMinPerKm: 5, finishSeconds: 50 * 60 },
      ],
    },
  ]);
  const printed = buildReportHtml(withLeaders, {
    raceName: 'Fixture race',
    rules: DEFAULT_AMENITY_RULES,
    overrides: {},
  });

  it('draws the same lead marks the screen does', () => {
    const marks = withLeaders.stations.reduce((n, s) => n + s.leadArrivals.length, 0);
    expect(marks).toBeGreaterThan(0);
    expect((printed.match(/♂/g) ?? []).length + (printed.match(/♀/g) ?? []).length).toBeGreaterThanOrEqual(
      marks
    );
  });

  it('names each mark, since a printed page has no tooltip to open', () => {
    expect(printed).toMatch(/<title>First Male — [^<]*\d\d:\d\d at [\d.]+ km<\/title>/);
    expect(printed).toMatch(/<title>First Female — /);
  });

  it('carries the two times as text as well as marks', () => {
    expect(printed).toContain('<th class="num">First Male</th>');
    expect(printed).toContain('<th class="num">First Female</th>');
  });

  it('leaves the chart unchanged where no export named the sexes', () => {
    // The plain fixture has no leaders; it must not grow an empty marker band.
    expect(html).not.toContain('♂');
    expect(html).not.toContain('First Male');
  });

  it('gives every row the same height, so labels stay level with their bars', () => {
    // One band for the whole chart: rows are laid out by index, so a row that grew to
    // fit its own marks would put every row under it out of step with its label.
    // Matched by aria-label — the page carries other SVGs, the brand mark among them.
    const chart = printed.match(
      /<svg viewBox="0 0 [\d.]+ ([\d.]+)"[^>]*aria-label="Runner arrivals/
    );
    expect(chart, 'the report should carry a distribution chart').toBeTruthy();

    const plotted = Number(chart![1]) - 26;
    const rows = withLeaders.stations.length;
    expect(plotted % rows).toBe(0);
    // Tall enough for the bars and a lane of glyphs, not just the bars.
    expect(plotted / rows).toBeGreaterThan(40);
  });
});
