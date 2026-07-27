import type { PipelineResult, PipelineStation } from './pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from './time';
import { AMENITIES, resolveAmenities, totalAmenities, type AmenityRules, type AmenitySet } from './amenities';

/** Which parts of the plan to print. An organiser rarely needs all of it at once. */
export interface ReportSections {
  schedule: boolean;
  perDistance: boolean;
  cutoffs: boolean;
}

export const REPORT_SECTIONS: { key: keyof ReportSections; label: string; hint: string }[] = [
  { key: 'schedule', label: 'Station operating schedule', hint: 'Open and close times per position' },
  { key: 'perDistance', label: 'What each distance runs through', hint: 'Stops, gaps and amenities per race' },
  { key: 'cutoffs', label: 'Cut-off times', hint: 'Official cut-offs against modelled arrivals' },
];

export const ALL_REPORT_SECTIONS: ReportSections = { schedule: true, perDistance: true, cutoffs: true };

export interface ReportOptions {
  raceName: string;
  /** Defaults to every section when omitted. */
  sections?: ReportSections;
  rules: AmenityRules;
  overrides: Record<string, Partial<AmenitySet>>;
  /** Name of the source map, recorded so a printed sheet can be traced back. */
  sourceFileName?: string;
  resultsFileName?: string;
}

function hm(clock: string): string {
  const seconds = parseClockTimeToSeconds(clock);
  return seconds === null ? clock : secondsToClockTime(seconds).slice(0, 5);
}

/** Escapes text for HTML. Race and place names carry quotes and ampersands. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Stop {
  station: PipelineStation;
  kmFromStart: number;
  passIndex: number;
  passCount: number;
  gapKm: number;
  officialCutoffClock?: string;
}

function buildRun(result: PipelineResult, courseName: string): Stop[] {
  const stops: Stop[] = [];
  for (const station of result.stations) {
    for (const crossing of station.crossings) {
      if (crossing.courseName !== courseName) continue;
      stops.push({
        station,
        kmFromStart: crossing.kmFromStart,
        passIndex: crossing.passIndex,
        passCount: crossing.passCount,
        gapKm: 0,
        officialCutoffClock: crossing.officialCutoffClock,
      });
    }
  }
  stops.sort((a, b) => a.kmFromStart - b.kmFromStart);
  let previous = 0;
  for (const stop of stops) {
    stop.gapKm = stop.kmFromStart - previous;
    previous = stop.kmFromStart;
  }
  return stops;
}

/**
 * Renders the whole plan as one self-contained HTML file — no scripts, no external
 * styles, no fonts to fetch. An organiser can open it offline, print it, or forward it
 * without needing this tool, which is the point: the schedule has to survive leaving
 * the browser it was calculated in.
 */
export function buildReportHtml(result: PipelineResult, options: ReportOptions): string {
  const { raceName, rules, overrides } = options;
  const sections = options.sections ?? ALL_REPORT_SECTIONS;
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  const courses = [...result.courses]
    .filter((c) => result.courseOrder.includes(c.name))
    .sort((a, b) => b.totalKm - a.totalKm);

  const scheduleRows = !sections.schedule ? '' : result.stations
    .map((station) => {
      const crossings = station.crossings
        .map((c) => `${esc(c.courseName)} ${c.kmFromStart.toFixed(1)}km`)
        .join('<br>');
      return `<tr>
        <td><strong>${esc(station.schedule.name)}</strong>${
          station.sourceNames.join(', ') !== station.schedule.name
            ? `<div class="sub">${esc(station.sourceNames.join(', '))}</div>`
            : ''
        }</td>
        <td class="sub">${crossings}</td>
        <td class="num">${hm(station.schedule.openClockTime)}</td>
        <td class="num">${hm(station.schedule.closeClockTime)}</td>
        <td class="num">${Math.round(station.schedule.peakRunnersPerHour).toLocaleString()}</td>
        <td><span class="tag ${station.schedule.activityLevel}">${station.schedule.activityLevel}</span></td>
        ${station.schedule.cutoffExceeded ? '<td class="risk">Over cut-off</td>' : '<td></td>'}
      </tr>`;
    })
    .join('');

  const perDistance = !sections.perDistance ? '' : courses
    .map((course) => {
      const stops = buildRun(result, course.name);
      if (stops.length === 0) return '';

      const sets = stops.map((s) =>
        resolveAmenities(s.station.schedule.activityLevel, rules, overrides[s.station.mapName])
      );
      const totals = totalAmenities(sets);
      const longest = Math.max(0, ...stops.map((s) => s.gapKm));

      const rows = stops
        .map((stop, i) => {
          const set = sets[i];
          const cells = AMENITIES.map(
            (a) => `<td class="mid">${set[a.key] ? a.icon : ''}</td>`
          ).join('');
          return `<tr>
            <td class="num sub">${i + 1}</td>
            <td>${esc(stop.station.schedule.name)}${
              stop.passCount > 1 ? `<div class="sub">pass ${stop.passIndex + 1} of ${stop.passCount}</div>` : ''
            }</td>
            <td class="num">${stop.kmFromStart.toFixed(1)}</td>
            <td class="num${stop.gapKm === longest && longest > 0 ? ' risk' : ''}">${stop.gapKm.toFixed(1)}</td>
            <td class="num">${hm(stop.station.schedule.openClockTime)}</td>
            <td class="num">${hm(stop.station.schedule.closeClockTime)}</td>
            <td class="num">${stop.officialCutoffClock ? hm(stop.officialCutoffClock) : '–'}</td>
            ${cells}
          </tr>`;
        })
        .join('');

      const totalCells = AMENITIES.map((a) => `<td class="mid"><strong>${totals[a.key]}</strong></td>`).join('');

      return `<h2>${esc(course.name)} — ${course.totalKm.toFixed(1)} km</h2>
        <p class="note">${stops.length} stops, longest gap ${longest.toFixed(1)} km.</p>
        <table>
          <thead><tr>
            <th></th><th>Point</th><th class="num">At km</th><th class="num">Gap</th>
            <th class="num">Open</th><th class="num">Close</th><th class="num">Cut-off</th>
            ${AMENITIES.map((a) => `<th class="mid">${esc(a.label)}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}
            <tr class="total"><td></td><td><strong>Total</strong></td>
            <td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>
            ${totalCells}</tr>
          </tbody>
        </table>`;
    })
    .join('');

  const cutoffRows = !sections.cutoffs ? '' : result.cutoffTable
    .map(
      (row) => `<tr>
        <td>${esc(row.stationName)}</td>
        <td>${esc(row.courseName)}</td>
        <td class="num">${row.kmFromStart.toFixed(1)}</td>
        <td class="num">${hm(row.cutoffClockTime)}</td>
        <td class="num">${row.modeledLastArrivalClockTime.slice(0, 5)}</td>
        <td class="${row.exceeded ? 'risk' : ''}">${row.exceeded ? 'Over cut-off' : 'Clears'}</td>
      </tr>`
    )
    .join('');

  const sources = [
    options.sourceFileName ? `Course map: ${esc(options.sourceFileName)}` : '',
    options.resultsFileName ? `Pace from: ${esc(options.resultsFileName)}` : 'Pace from entered bands',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(raceName)} — CP operations</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16221f; background: #fff;
         margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; }
  h2 { font-size: 15px; margin: 28px 0 6px; font-weight: 600; }
  .meta, .note { color: #5c6b68; font-size: 12px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; font-size: 12px; }
  th, td { border: 1px solid #d9e0de; padding: 5px 7px; text-align: left; vertical-align: middle; }
  th { background: #f2f6f5; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5c6b68;
       font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mid, th.mid { text-align: center; }
  .sub { color: #5c6b68; font-size: 11px; }
  .risk { color: #b42318; font-weight: 600; }
  .total td { background: #f2f6f5; }
  .tag { font-size: 11px; font-weight: 600; }
  .tag.High { color: #b42318; } .tag.Medium { color: #b54708; } .tag.Low { color: #067647; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #d9e0de; color: #5c6b68; font-size: 11px; }
  @media print {
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style></head>
<body>
  <h1>${esc(raceName)}</h1>
  <p class="meta">Checkpoint operations plan &middot; generated ${esc(generated)}</p>
  <p class="meta">${sources}</p>

  ${
    scheduleRows
      ? `<h2>Station operating schedule</h2>
  <table>
    <thead><tr>
      <th>Station</th><th>Crossings</th><th class="num">Open</th><th class="num">Close</th>
      <th class="num">Peak /hr</th><th>Activity</th><th></th>
    </tr></thead>
    <tbody>${scheduleRows}</tbody>
  </table>`
      : ''
  }

  ${perDistance}

  ${
    cutoffRows
      ? `<h2>Cut-off times</h2>
  <table>
    <thead><tr>
      <th>Station</th><th>Distance</th><th class="num">Km</th><th class="num">Cut-off</th>
      <th class="num">Modeled last arrival</th><th>Status</th>
    </tr></thead>
    <tbody>${cutoffRows}</tbody>
  </table>`
      : ''
  }

  <footer>
    Open and close times are modelled from the pace data named above; they are a plan, not a measurement.
    Generated by EnduranceMap &middot; Powered by Sportstats.
  </footer>
</body></html>`;
}

/** Triggers a download of the report without touching a server. */
export function downloadReport(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
