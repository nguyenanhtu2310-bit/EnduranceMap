import type { PipelineResult, PipelineStation } from './pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from './time';
import { AMENITIES, resolveAmenities, totalAmenities, type AmenityRules, type AmenitySet } from './amenities';
import { SPORTSTATS_LOGO_DATA_URI } from '../assets/sportstatsLogo';

/** Which parts of the plan to print. An organiser rarely needs all of it at once. */
export interface ReportSections {
  schedule: boolean;
  perDistance: boolean;
  splits: boolean;
  distribution: boolean;
  cutoffs: boolean;
}

export const REPORT_SECTIONS: { key: keyof ReportSections; label: string; hint: string }[] = [
  { key: 'schedule', label: 'Station operating schedule', hint: 'Open and close times per position' },
  { key: 'perDistance', label: 'Course amenities', hint: 'Stops, gaps and amenities per race' },
  { key: 'splits', label: 'Split calculation', hint: 'Every point by distance, with km on each route' },
  { key: 'distribution', label: 'Crossing time distribution', hint: 'Peak window and load per station' },
  { key: 'cutoffs', label: 'Cut-off times', hint: 'Proposed cut-offs against modelled arrivals' },
];

export const ALL_REPORT_SECTIONS: ReportSections = {
  schedule: true,
  perDistance: true,
  splits: true,
  distribution: true,
  cutoffs: true,
};

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
        <td class="num">${row.modeledLastArrivalClockTime.slice(0, 5)}</td>
        <td class="num"><strong>${hm(row.suggestedClockTime)}</strong></td>
        <td class="num${row.mapIsTighter ? ' risk' : ''}">${row.mapClockTime ? hm(row.mapClockTime) : '–'}</td>
      </tr>`
    )
    .join('');

  const splitTable = !sections.splits
    ? ''
    : (() => {
        const head = courses.map((c) => `<th class="num">${esc(c.name)}</th>`).join('');
        const body = result.stations
          .map((station) => {
            const cells = courses
              .map((course) => {
                const passes = station.crossings
                  .filter((c) => c.courseName === course.name)
                  .map((c) => `${c.kmFromStart.toFixed(1)}k`);
                return `<td class="num">${passes.length ? passes.join(' / ') : '–'}</td>`;
              })
              .join('');
            return `<tr><td>${esc(station.schedule.name)}</td><td class="num">${hm(
              station.schedule.openClockTime
            )}–${hm(station.schedule.closeClockTime)}</td>${cells}</tr>`;
          })
          .join('');
        return `<h2>Split calculation</h2>
        <p class="note">Kilometres are measured along each distance's own route, so one point reads differently per race.</p>
        <table><thead><tr><th>Timing point</th><th class="num">Operating</th>${head}</tr></thead>
        <tbody>${body}</tbody></table>`;
      })();

  const distributionTable = !sections.distribution
    ? ''
    : (() => {
        const body = result.stations
          .map((station) => {
            const peak = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
            const window = peak
              ? `${secondsToClockTime(peak.binStartSeconds).slice(0, 5)}–${secondsToClockTime(
                  peak.binEndSeconds
                ).slice(0, 5)}`
              : '–';
            return `<tr>
              <td>${esc(station.schedule.name)}</td>
              <td class="num">${window}</td>
              <td class="num">${peak ? peak.total.toLocaleString() : '–'}</td>
              <td class="num">${Math.round(station.schedule.peakRunnersPerHour).toLocaleString()}</td>
              <td><span class="tag ${station.schedule.activityLevel}">${station.schedule.activityLevel}</span></td>
            </tr>`;
          })
          .join('');
        return `<h2>Crossing time distribution</h2>
        <p class="note">The busiest ${result.binMinutes}-minute window at each position, and the rate it implies.</p>
        <table><thead><tr>
          <th>Station</th><th class="num">Peak window</th><th class="num">Runners in window</th>
          <th class="num">Rate /hr</th><th>Activity</th>
        </tr></thead><tbody>${body}</tbody></table>`;
      })();

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
  /* EnduranceMap brand — dark ground on screen, per design-tokens.json. A report is
     also a printed document, so the print rules below drop to ink-on-paper rather than
     flooding a page with the brand ground. */
  :root {
    --bg: #16221f;
    --surface: #223532;
    --text: #f3f8ff;
    --accent: #07bc02;
    --divider: rgba(243, 248, 255, 0.16);
    --muted: rgba(243, 248, 255, 0.58);
    --faint: rgba(243, 248, 255, 0.40);
    --danger: #ff8a80;
    --warn: #f0b46a;
    --ok: #5ed350;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    font: 400 13px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text); background: var(--bg);
    margin: 0; padding: 40px 32px; -webkit-font-smoothing: antialiased;
  }
  .masthead { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
  .masthead svg { color: var(--accent); flex: none; }
  .wordmark { font-weight: 500; font-size: 15px; letter-spacing: -0.01em; }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 500; letter-spacing: -0.02em; }
  h2 {
    font-size: 15px; margin: 30px 0 6px; font-weight: 500; letter-spacing: -0.01em;
    padding-top: 14px; border-top: 1px solid var(--divider);
  }
  .meta, .note { color: var(--muted); font-size: 12px; margin: 0 0 4px; }
  .kicker {
    display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 6px;
  }
  table {
    width: 100%; border-collapse: collapse; margin: 10px 0 22px; font-size: 12px;
    background: var(--surface); border-radius: 8px; overflow: hidden;
  }
  th, td { border-bottom: 1px solid var(--divider); padding: 6px 8px; text-align: left; vertical-align: middle; }
  th {
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--faint);
    font-weight: 500; white-space: nowrap;
  }
  tbody tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mid, th.mid { text-align: center; }
  .sub { color: var(--faint); font-size: 11px; }
  .risk { color: var(--danger); font-weight: 500; }
  .total td { background: rgba(243, 248, 255, 0.05); font-weight: 500; }
  .tag { font-size: 11px; font-weight: 500; }
  .tag.High { color: var(--danger); } .tag.Medium { color: var(--warn); } .tag.Low { color: var(--ok); }
  footer {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--divider);
    color: var(--faint); font-size: 11px;
  }
  .powered {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-bottom: 12px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  }
  .powered .chip {
    background: #eef4f3; border-radius: 4px; padding: 4px 10px; display: inline-flex; align-items: center;
  }
  .powered img { height: 16px; display: block; }
  .disclaimer { text-align: center; }

  @media print {
    :root {
      --bg: #ffffff; --surface: #ffffff; --text: #16221f;
      --divider: #d9e0de; --muted: #5c6b68; --faint: #5c6b68;
      --danger: #b42318; --warn: #b54708; --ok: #067647;
      color-scheme: light;
    }
    body { padding: 0; }
    table { border: 1px solid var(--divider); }
    th, td { border: 1px solid var(--divider); }
    .total td { background: #f2f6f5; }
    h2 { page-break-after: avoid; }
    tr { page-break-inside: avoid; }
    footer { page-break-inside: avoid; }
  }
</style></head>
<body>
  <div class="masthead">
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128 16a88.1 88.1 0 0 0-88 88c0 75.3 80 132.17 83.41 134.55a8 8 0 0 0 9.18 0C136 236.17 216 179.3 216 104a88.1 88.1 0 0 0-88-88Zm0 56a32 32 0 1 1-32 32 32 32 0 0 1 32-32Z"/></svg>
    <span class="wordmark">EnduranceMap</span>
  </div>
  <span class="kicker">Checkpoint operations plan</span>
  <h1>${esc(raceName)}</h1>
  <p class="meta">Generated ${esc(generated)}</p>
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

  ${splitTable}

  ${distributionTable}

  ${
    cutoffRows
      ? `<h2>Cut-off times</h2>
  <table>
    <thead><tr>
      <th>Station</th><th>Distance</th><th class="num">Km</th>
      <th class="num">Slowest arrival</th><th class="num">Proposed cut-off</th><th class="num">On map</th>
    </tr></thead>
    <tbody>${cutoffRows}</tbody>
  </table>`
      : ''
  }

  <footer>
    <div class="powered">
      <span>Powered by</span>
      <span class="chip"><img src="${SPORTSTATS_LOGO_DATA_URI}" alt="Sportstats"></span>
    </div>
    <p class="disclaimer">
      Open and close times are modelled from the pace data named above; they are a plan, not a measurement.
    </p>
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
