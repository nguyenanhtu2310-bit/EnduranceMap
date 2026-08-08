import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AMENITY_RULES } from '../amenities';
import { runPipeline, type DistanceInput } from '../pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from '../time';
import { ALL_CUTOFF_COLUMNS, ALL_REPORT_SECTIONS, buildReportHtml } from '../report';
import { buildStationTraffic } from '../stationTraffic';
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
    // Two of these were missing for as long as this test existed, which is what a test
    // named for parity and written as a literal list will do.
    expect(headers).toEqual([
      'Station',
      'Distance',
      'Km',
      'Slowest arrival',
      'Proposed cut-off',
      'Margin',
      'Provided COT',
      'Stops',
      'Effort needed',
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
      expect(cells).toBe(9);
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

/**
 * The report is the deliverable — the thing an organiser is handed and works from. It is
 * built by a separate renderer from the screen, so a column added to one has twice now
 * silently failed to reach the other. These pin every section's columns to what the
 * screen shows, so the next omission fails here rather than in front of a client.
 */
describe('the report presents the same columns as the screen', () => {
  const withLeaders = runPipeline(kml, [
    {
      ...inputs[0],
      leaders: [
        { sex: 'M', startOffsetSeconds: 0, paceMinPerKm: 4, finishSeconds: 40 * 60 },
        { sex: 'F', startOffsetSeconds: 30, paceMinPerKm: 5, finishSeconds: 50 * 60 },
      ],
    },
  ]);
  const page = buildReportHtml(withLeaders, {
    raceName: 'Fixture race',
    rules: DEFAULT_AMENITY_RULES,
    overrides: {},
  });

  /** Column headings of the first table under a heading matching `heading`. */
  function headersUnder(heading: RegExp): string[] {
    const at = page.search(heading);
    expect(at, `no section matching ${heading}`).toBeGreaterThan(-1);
    const head = page.slice(at, page.indexOf('</thead>', at));
    return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => m[1].replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
  }

  it('station operating schedule', () => {
    // Duration was on screen for weeks before the report grew it.
    expect(headersUnder(/<h2>Station operating schedule<\/h2>/)).toEqual([
      'Station',
      'Crossings',
      'Open',
      'Close',
      'Duration',
      'Peak window',
      'Peak /15 min',
      'Activity',
    ]);
  });

  it('course amenities', () => {
    expect(headersUnder(/<h2>10km — /)).toEqual([
      'Point',
      'At km',
      'Gap',
      'Open',
      'Close',
      'Cut-off',
      'Activity',
      'Water',
      'Medical',
    ]);
  });

  it('crossing time distribution', () => {
    expect(headersUnder(/<h2>Crossing time distribution<\/h2>/)).toEqual([
      'Station',
      'Peak window',
      'Through in 15 min',
      'Busiest distance',
      'Activity',
      'First Male',
      'First Female',
    ]);
  });

  it('cut-off times', () => {
    expect(headersUnder(/<h2>Cut-off times<\/h2>/)).toEqual([
      'Station',
      'Distance',
      'Km',
      'Slowest arrival',
      'Proposed cut-off',
      'Margin',
      'Provided COT',
      'Stops',
      'Effort needed',
    ]);
  });

  it('gives every row the same number of cells as the header', () => {
    for (const heading of [
      /<h2>Station operating schedule<\/h2>/,
      /<h2>10km — /,
      /<h2>Crossing time distribution<\/h2>/,
      /<h2>Cut-off times<\/h2>/,
    ]) {
      const at = page.search(heading);
      const table = page.slice(at, page.indexOf('</table>', at));
      // `<th` alone also matches `<thead`, which is one phantom column per table.
      const columns = [...table.slice(0, table.indexOf('</thead>')).matchAll(/<th[\s>]/g)].length;
      const body = table.slice(table.indexOf('<tbody'));
      for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        expect([...row[1].matchAll(/<td[\s>]/g)].length, `row under ${heading}`).toBe(columns);
      }
    }
  });
});

describe('the spreadsheet covers the same five sections', () => {
  it('has a sheet for every RESULT section, distribution included', () => {
    // The distribution had no sheet at all: ticking it in the export dialog changed
    // nothing, and the spreadsheet quietly arrived a section short.
    expect(sheets.map((s) => s.name)).toEqual([
      'Summary',
      'Station schedule',
      'Course amenities',
      'Split calculation',
      'Crossing distribution',
      'Cut-off times',
    ]);
  });

  it('gives the distribution sheet the screen’s columns', () => {
    const withLeaders = runPipeline(kml, [
      {
        ...inputs[0],
        leaders: [
          { sex: 'M', startOffsetSeconds: 0, paceMinPerKm: 4, finishSeconds: 40 * 60 },
          { sex: 'F', startOffsetSeconds: 30, paceMinPerKm: 5, finishSeconds: 50 * 60 },
        ],
      },
    ]);
    const sheet = buildReportSheets(withLeaders, {
      raceName: 'Fixture race',
      rules: DEFAULT_AMENITY_RULES,
      overrides: {},
    }).find((s) => s.name === 'Crossing distribution')!;

    expect(sheet.rows[0]).toEqual([
      'Station',
      'Peak window',
      'Through in 15 min',
      'Busiest distance',
      'Activity',
      'First Male',
      'First Male distance',
      'First Female',
      'First Female distance',
    ]);
    expect(sheet.rows.length).toBe(withLeaders.stations.length + 1);
  });

  it('writes the count as a number, so a spreadsheet can total it', () => {
    const sheet = sheets.find((s) => s.name === 'Crossing distribution')!;
    for (const row of sheet.rows.slice(1)) expect(typeof row[2]).toBe('number');
  });

  it('honours a section being switched off', () => {
    const only = buildReportSheets(result, {
      raceName: 'Fixture race',
      rules: DEFAULT_AMENITY_RULES,
      overrides: {},
      sections: { schedule: false, perDistance: false, splits: false, distribution: true, stationTraffic: false, cutoffs: false },
    });
    expect(only.map((s) => s.name)).toEqual(['Summary', 'Crossing distribution']);
  });
});

describe('traffic at each station', () => {
  const withLeaders = runPipeline(kml, [
    {
      ...inputs[0],
      leaders: [
        { sex: 'M', startOffsetSeconds: 0, paceMinPerKm: 4, finishSeconds: 40 * 60 },
        { sex: 'F', startOffsetSeconds: 30, paceMinPerKm: 5, finishSeconds: 50 * 60 },
      ],
    },
  ]);
  const base = { raceName: 'Fixture race', rules: DEFAULT_AMENITY_RULES, overrides: {} };
  const withTraffic = buildReportHtml(withLeaders, {
    ...base,
    sections: { ...ALL_REPORT_SECTIONS, stationTraffic: true },
  });

  it('prints one block per station', () => {
    expect((withTraffic.match(/class="station-block"/g) ?? []).length).toBe(withLeaders.stations.length);
  });

  it('writes the figure on every bar, since a printout cannot be hovered', () => {
    const block = withTraffic.slice(withTraffic.indexOf('class="station-block"'));
    const svg = block.slice(block.indexOf('<svg'), block.indexOf('</svg>'));
    const bars = (svg.match(/<rect /g) ?? []).length;
    const numbers = [...svg.matchAll(/<text[^>]*font-size="9"[^>]*>([\d,]+)<\/text>/g)].length;
    expect(bars).toBeGreaterThan(0);
    expect(numbers).toBe(bars);
  });

  it('repeats the figures as a table, one row per distance', () => {
    const at = withTraffic.indexOf('<h2>Traffic at each station</h2>');
    const table = withTraffic.slice(at, withTraffic.indexOf('</table>', at));
    expect(table).toContain('<th>Distance</th>');
    expect(table).toContain('<th class="num">Total</th>');
    expect(table).toContain('<strong>All</strong>');
  });

  it('stays out of the report unless it is asked for', () => {
    // A hundred points would be a hundred charts, so it is off by default.
    expect(ALL_REPORT_SECTIONS.stationTraffic).toBe(false);
    expect(buildReportHtml(withLeaders, base)).not.toContain('Traffic at each station');
  });

  it('shows a station only in the windows it is working', () => {
    // The shared grid spans the whole race; a point idle till 06:00 must not print
    // three hours of empty columns for a crew to read past.
    const station = withLeaders.stations.find((s) => s.distribution.some((b) => b.total > 0))!;
    const view = buildStationTraffic(station, withLeaders.courseOrder)!;
    expect(view.active.length).toBeLessThanOrEqual(station.distribution.length);
    expect(view.active[0].total).toBeGreaterThan(0);
    expect(view.active[view.active.length - 1].total).toBeGreaterThan(0);
  });
});

describe('the crossing-time axis on a page', () => {
  /**
   * Every time written along the bottom of the distribution chart.
   *
   * Matched on the axis label's own signature — middle-anchored at font-size 11 — rather
   * than by slicing the first <svg> in the document, which is a different chart.
   */
  const axisLabels = (reportHtml: string) =>
    [...reportHtml.matchAll(/text-anchor="middle"[^>]*font-size="11">([^<]*)</g)].map((m) => m[1]);

  /** A race whose tail sets the span, as its own report. */
  const reportFor = (typical: number, slowest: number, raceDate?: string) =>
    buildReportHtml(
      runPipeline(kml, [
        {
          courseName: '10km',
          startTimeClock: '05:00',
          runnerCount: 200,
          startSpreadMinutes: 5,
          fastestMinPerKm: 6,
          typicalMinPerKm: typical,
          slowestMinPerKm: slowest,
        },
      ]),
      { raceName: 'Span fixture', rules: DEFAULT_AMENITY_RULES, overrides: {}, raceDate }
    );

  it('does not write a label an hour on a race that runs for days', () => {
    // The complaint this fixes: forty-nine hourly ticks merging into a grey band on paper.
    const labels = axisLabels(reportFor(60, 180));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(14);
  });

  it('still writes a short race finely', () => {
    // Coarsening a ninety-minute race to three-hourly marks is the opposite mistake.
    expect(axisLabels(html).length).toBeGreaterThan(3);
    expect(axisLabels(html)[1]).toMatch(/^\d{2}:\d{2}$/);
  });

  it('names the day only where the day changes', () => {
    // "06:00" twice on a two-day chart means two different mornings, and on paper there
    // is nothing else to tell them apart — but naming every label is a wall of text.
    const labels = axisLabels(reportFor(60, 180));
    const dayed = labels.filter((l) => /^(Day \d|D\+\d|Fri|Sat|Sun|Mon|Tue|Wed|Thu)\s/.test(l));
    expect(dayed.length).toBeGreaterThanOrEqual(2);
    expect(dayed.length).toBeLessThan(labels.length);
  });

  it('uses the weekday where a race date was given', () => {
    const labels = axisLabels(reportFor(60, 180, '2026-09-18'));
    expect(labels.some((l) => /^Fri\s/.test(l))).toBe(true);
    expect(labels.some((l) => /^Sat\s/.test(l))).toBe(true);
  });

  it('keeps its ticks on the interval, not on the gun', () => {
    // A 05:00 start on a three-hourly axis reads 06:00, 09:00, 12:00 — hours a crew chief
    // can find without arithmetic.
    for (const label of axisLabels(reportFor(60, 180))) {
      const clock = label.split(' ').pop()!;
      expect(clock).toMatch(/^\d{2}:00$/);
    }
  });
});

describe('dates in the report', () => {
  /** A race long enough that its stations stand past midnight. */
  const overnight = buildReportHtml(
    runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 200,
        startSpreadMinutes: 5,
        fastestMinPerKm: 6,
        typicalMinPerKm: 60,
        slowestMinPerKm: 180,
      },
    ]),
    {
      raceName: 'Overnight',
      rules: DEFAULT_AMENITY_RULES,
      overrides: {},
      raceDate: '2026-09-18',
      // Off by default — a hundred stations would be a hundred charts — so the crew
      // sheets have to ask for it, and this test asks the same way.
      sections: { ...ALL_REPORT_SECTIONS, stationTraffic: true },
    }
  );

  it('names the day on the traffic columns', () => {
    // A station standing thirty hours has columns either side of midnight, and "06:00"
    // twice on a printed sheet has nothing else to tell the two apart.
    const days = [...overnight.matchAll(/<span class="col-day">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) expect(day).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  it('does not name it on every column', () => {
    // Naming all of them doubles the width of the widest table in the report.
    const headers = (overnight.match(/<th class="num">/g) ?? []).length;
    const days = (overnight.match(/class="col-day"/g) ?? []).length;
    expect(days).toBeLessThan(headers);
  });

  it('carries the day on the cut-off times', () => {
    const start = overnight.indexOf('<h2>Cut-off times</h2>');
    expect(start).toBeGreaterThan(-1);
    const section = overnight.slice(start, overnight.indexOf('</table>', start));
    expect(section).toMatch(/(Fri|Sat|Sun)\s\d{2}:\d{2}/);
  });

  it('carries the day on the lead-athlete times', () => {
    const leads = [...overnight.matchAll(/<span class="lead-time">([^<]+)<\/span>/g)].map((m) => m[1]);
    if (leads.length === 0) return;
    for (const lead of leads) expect(lead).toMatch(/^(Fri|Sat|Sun)\s\d{2}:\d{2}$/);
  });
});

describe('the two report themes', () => {
  const opts = {
    raceName: 'Both themes',
    rules: DEFAULT_AMENITY_RULES,
    overrides: {},
    raceDate: '2026-09-18',
    sections: { ...ALL_REPORT_SECTIONS, stationTraffic: true },
  };
  const light = buildReportHtml(result, { ...opts, theme: 'light' as const });
  const dark = buildReportHtml(result, { ...opts, theme: 'dark' as const });

  /** The report with its stylesheet and colour attributes taken out. */
  const contentOf = (html: string) =>
    html
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/(fill|stroke|background|color)="[^"]*"/g, '')
      .replace(/style="[^"]*"/g, '')
      .replace(/\s+/g, ' ');

  it('says exactly the same thing in both themes', () => {
    // A theme is a set of colours. Anything else differing between the two is a report
    // that tells two stories, and the reader has no way of knowing which they were given.
    expect(contentOf(dark)).toBe(contentOf(light));
  });

  it('carries every section in both', () => {
    for (const heading of [
      'Station operating schedule',
      'Cut-off times',
      'Traffic at each station',
      'Crossing time distribution',
    ]) {
      expect(light).toContain(heading);
      expect(dark).toContain(heading);
    }
  });

  it('dates its times in both', () => {
    for (const html of [light, dark]) {
      expect(html).toMatch(/<span class="col-day">(Fri|Sat|Sun)<\/span>/);
      const cutoffs = html.slice(html.indexOf('<h2>Cut-off times</h2>'));
      expect(cutoffs).toMatch(/(Fri|Sat|Sun)\s\d{2}:\d{2}/);
    }
  });

  it('differs only in its colours', () => {
    // The check above would also pass if neither had any colour at all.
    expect(dark).not.toBe(light);
    expect(dark).toContain('color-scheme: dark');
    expect(light).not.toContain('color-scheme: dark');
  });
});

describe('the cut-off table in the report', () => {
  const opts = {
    raceName: 'Columns',
    rules: DEFAULT_AMENITY_RULES,
    overrides: {},
    raceDate: '2026-09-18',
  };
  const section = (reportHtml: string) => {
    const start = reportHtml.indexOf('<h2>Cut-off times</h2>');
    return reportHtml.slice(start, reportHtml.indexOf('</table>', start));
  };

  it('carries the columns the screen has, including the two it was missing', () => {
    // A report sent on instead of a screenshot used to drop the only two figures that
    // say whether a cut-off is generous or a gate.
    const html = section(buildReportHtml(result, opts));
    for (const label of ['Slowest arrival', 'Proposed cut-off', 'Margin', 'Provided COT', 'Stops', 'Effort needed']) {
      expect(html).toContain(label);
    }
  });

  it('leaves out a column that was unticked', () => {
    const html = section(
      buildReportHtml(result, {
        ...opts,
        cutoffColumns: { ...ALL_CUTOFF_COLUMNS, margin: false, stops: false },
      })
    );
    expect(html).not.toContain('Margin');
    expect(html).not.toContain('Stops');
    expect(html).toContain('Effort needed');
    expect(html).toContain('Provided COT');
  });

  it('keeps every row the same width as its header', () => {
    // A dropped cell shifts every column after it, which is the way a table like this
    // goes wrong without looking wrong.
    const html = section(
      buildReportHtml(result, {
        ...opts,
        cutoffColumns: { ...ALL_CUTOFF_COLUMNS, proposed: false, effort: false },
      })
    );
    const headers = (html.match(/<th[ >]/g) ?? []).length;
    expect(headers).toBe(7);
    for (const row of html.split('<tr').slice(2)) {
      expect((row.match(/<td[ >]/g) ?? []).length).toBe(headers);
    }
  });

  it('still prints the three columns that name the row', () => {
    // Station, distance and km are what a row is; there is no report without them.
    const html = section(
      buildReportHtml(result, {
        ...opts,
        cutoffColumns: {
          slowestArrival: false, proposed: false, margin: false,
          providedCot: false, stops: false, effort: false,
        },
      })
    );
    expect(html).toContain('Station');
    expect(html).toContain('Distance');
    expect((html.match(/<th[ >]/g) ?? []).length).toBe(3);
  });
});
