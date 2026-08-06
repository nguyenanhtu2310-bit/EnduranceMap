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
