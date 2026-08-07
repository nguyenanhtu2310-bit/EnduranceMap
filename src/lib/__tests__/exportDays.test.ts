import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { buildReportHtml } from '../report';
import { buildReportSheets } from '../workbook';
import { buildCrewSheetsHtml } from '../crewSheets';
import { DEFAULT_AMENITY_RULES } from '../amenities';

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>RACE ROUTE</name>
<Placemark><name>long</name><LineString><coordinates>
103.84,22.00,0 103.84,22.20,0 103.84,22.40,0 103.84,22.60,0 103.84,22.90,0
</coordinates></LineString></Placemark></Folder>
<Folder><name>CP</name>
<Placemark><name>CP1</name><Point><coordinates>103.84,22.60,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

const result = runPipeline(KML, [{
  courseName: 'long', startTimeClock: '08:00', startDayOffset: 0,
  startSpreadMinutes: 5, runnerCount: 200,
  fastestMinPerKm: 6, typicalMinPerKm: 14, slowestMinPerKm: 22,
}], { stationFolders: ['CP'] });

const RACE_DATE = '2026-09-25'; // a Friday

describe('a race that runs past midnight', () => {
  it('spans days at all, so the rest of this file is testing something', () => {
    expect(result.stations[0].schedule.closeSeconds).toBeGreaterThan(86400);
  });

  it('names the day in the report', () => {
    const html = buildReportHtml(result, {
      raceName: 'Test', raceDate: RACE_DATE, rules: DEFAULT_AMENITY_RULES, overrides: {},
    });
    expect(html).toMatch(/Sat \d\d:\d\d/);
  });

  it('names the day in the crew sheets', () => {
    const html = buildCrewSheetsHtml(result, { raceName: 'Test', raceDate: RACE_DATE });
    expect(html).toMatch(/Sat \d\d:\d\d/);
  });

  it('names the day in the spreadsheet', () => {
    const sheets = buildReportSheets(result, {
      raceName: 'Test', raceDate: RACE_DATE, rules: DEFAULT_AMENITY_RULES, overrides: {},
    });
    const flat = JSON.stringify(sheets);
    expect(flat).toMatch(/Sat \d\d:\d\d/);
  });

  it('counts the day when no date was given, rather than hiding it', () => {
    const html = buildReportHtml(result, {
      raceName: 'Test', rules: DEFAULT_AMENITY_RULES, overrides: {},
    });
    expect(html).toMatch(/D\+1 \d\d:\d\d/);
  });

  it('leaves a same-day race reading exactly as it did', () => {
    const short = runPipeline(KML, [{
      courseName: 'long', startTimeClock: '08:00', startSpreadMinutes: 0, runnerCount: 50,
      fastestMinPerKm: 4, typicalMinPerKm: 5, slowestMinPerKm: 6,
    }], { stationFolders: ['CP'] });
    expect(short.stations[0].schedule.closeSeconds).toBeLessThan(86400);
    const html = buildReportHtml(short, {
      raceName: 'Test', raceDate: RACE_DATE, rules: DEFAULT_AMENITY_RULES, overrides: {},
    });
    expect(html).not.toMatch(/D\+\d/);
  });
});

describe('every export agrees about days', () => {
  const sheets = buildReportSheets(result, {
    raceName: 'Test', raceDate: RACE_DATE, rules: DEFAULT_AMENITY_RULES, overrides: {},
  });
  const crew = buildCrewSheetsHtml(result, { raceName: 'Test', raceDate: RACE_DATE });

  it('labels the crew sheet’s columns, not just rules them off', () => {
    // The sheet marked where the day turned with a border and never said which day it
    // turned into. A crew chief holding one page has no other sheet to check against.
    expect(crew).toMatch(/<span class="col-day">(Fri|Sat|Sun)<\/span>/);
  });

  it('names the weekday rather than counting, once a date is known', () => {
    // Without the race date reaching it the sheet reads "D+1", which is the same fact in
    // the one form nobody standing on a course at four in the morning wants it in.
    expect(crew).toMatch(/(Fri|Sat|Sun)/);
    expect(crew).not.toMatch(/D\+\d/);
  });

  it('dates the lead-athlete time in the spreadsheet too', () => {
    // Every other time in the workbook carried its day; this was the one cell left
    // printing a bare clock, while the HTML report beside it named the day.
    const flat = sheets.flatMap((sheet) => sheet.rows.flat()).map(String);
    const leadLike = flat.filter((cell) => /^\d{2}:\d{2}$/.test(cell));
    expect(leadLike).toEqual([]);
  });

  it('puts a day on something in all three exports', () => {
    const report = buildReportHtml(result, {
      raceName: 'Test', raceDate: RACE_DATE, rules: DEFAULT_AMENITY_RULES, overrides: {},
    });
    const workbookText = sheets.flatMap((s) => s.rows.flat()).map(String).join(' ');
    for (const output of [report, crew, workbookText]) {
      expect(output).toMatch(/(Fri|Sat|Sun)\s\d{2}:\d{2}/);
    }
  });
});
