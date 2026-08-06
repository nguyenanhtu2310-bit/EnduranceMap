import { isEndZoneStop, type PipelineResult, type PipelineStation } from './pipeline';
import {
  formatDuration,
  formatEventClock,
  parseClockTimeToSeconds,
  secondsToClockTime,
  windowSeconds,
} from './time';
import {
  DEFAULT_AMENITIES,
  resolveAmenities,
  totalAmenities,
  type Amenity,
  type AmenityRules,
  type AmenitySet,
} from './amenities';
import {
  assignLeadLanes,
  firstLeadOfSex,
  leadsForStation,
  sexGlyph,
  sexLabel,
} from './leadMarkers';
import { peakRunnersPerWindow } from './schedule';
import { buildStationTraffic, courseTotal } from './stationTraffic';
import { buildStationTrafficSvg } from './stationTrafficSvg';
import { splitStartFinish, trafficStationName, type TrafficStation } from './startFinish';
import { SPORTSTATS_LOGO_DATA_URI } from '../assets/sportstatsLogo';

/** Which parts of the plan to print. An organiser rarely needs all of it at once. */
export interface ReportSections {
  schedule: boolean;
  perDistance: boolean;
  splits: boolean;
  distribution: boolean;
  /** One chart per station, with every figure printed — the sheet a crew is handed. */
  stationTraffic: boolean;
  cutoffs: boolean;
}

export const REPORT_SECTIONS: { key: keyof ReportSections; label: string; hint: string }[] = [
  { key: 'schedule', label: 'Station operating schedule', hint: 'Open and close times per position' },
  { key: 'perDistance', label: 'Course amenities', hint: 'Stops, gaps and amenities per race' },
  { key: 'splits', label: 'Split calculation', hint: 'Every point by distance, with km on each route' },
  { key: 'distribution', label: 'Crossing time distribution', hint: 'Peak window and load per station' },
  {
    key: 'stationTraffic',
    label: 'Traffic at each station',
    hint: 'A chart and table per station, for the crew working it — long',
  },
  { key: 'cutoffs', label: 'Cut-off times', hint: 'Proposed cut-offs against modelled arrivals' },
];

export const ALL_REPORT_SECTIONS: ReportSections = {
  schedule: true,
  perDistance: true,
  splits: true,
  distribution: true,
  // Off by default: a hundred-station map turns this into a hundred charts, which is a
  // briefing pack rather than a plan. Ticked when the crew sheets are being produced.
  stationTraffic: false,
  cutoffs: true,
};

export interface ReportOptions {
  raceName: string;
  /**
   * 'light' is the printable document; 'dark' is the same report in the brand's own
   * theme, with the distribution chart drawn in the dark palette. Both print light —
   * paper is paper whatever the screen looked like.
   */
  theme?: 'light' | 'dark';
  /** Operator notes per station (staff, decoder serial), keyed by map name. */
  notes?: Record<string, string>;
  /** Defaults to every section when omitted. */
  sections?: ReportSections;
  rules: AmenityRules;
  /** The amenity columns as the operator named them; defaults to the shipped list. */
  amenities?: Amenity[];
  overrides: Record<string, Partial<AmenitySet>>;
  /** Name of the source map, recorded so a printed sheet can be traced back. */
  sourceFileName?: string;
  resultsFileName?: string;
  /**
   * The event's first date, so a time on another day is named rather than left to be
   * guessed. A report of a 49-hour race otherwise prints every clock as though the whole
   * thing happened between one midnight and the next.
   */
  raceDate?: string;
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

/** Categorical slots validated against each surface — same sets the app charts use. */
const LIGHT_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const DARK_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#5ed350', '#9085e9', '#e66767'];

/**
 * The crossing-time distribution as a static SVG: one row per station on a shared
 * clock, arrivals stacked by distance. Each row is scaled to its own peak — on a
 * multi-distance race the late stations see a fraction of the start-line field, and a
 * shared scale would flatten exactly the rows a reader opens the chart to see. The
 * table beneath carries the absolute numbers.
 */
function buildDistributionSvg(result: PipelineResult, series: string[], ink: { label: string; axis: string; grid: string; base: string; peak: string }, stations: TrafficStation[]): string {
  const binCount = stations[0]?.distribution.length ?? 0;
  if (binCount === 0) return '';

  const ROW_BODY = 40;
  const AXIS_H = 26;
  const LABEL_W = 190;
  const PLOT_W = Math.max(560, Math.min(860, binCount * 8));
  const width = LABEL_W + PLOT_W + 12;
  const span = result.timeRangeSeconds.end - result.timeRangeSeconds.start || 1;
  const binW = PLOT_W / binCount;
  const barW = Math.max(1, binW - 2);
  const x = (sec: number) => LABEL_W + ((sec - result.timeRangeSeconds.start) / span) * PLOT_W;

  // Lead markers are laid out exactly as on screen, so the printed chart and the one it
  // was made from carry the same marks in the same places. Paper cannot be stretched to
  // pull crowded glyphs apart, so the lanes matter more here than they do live.
  const GLYPH = 11;
  const LANE_STEP = 11;
  const BAND_PAD = 8;
  const rowLeads = stations.map((s) => leadsForStation(s));
  const rowLanes = rowLeads.map((leads) => assignLeadLanes(leads.map((l) => x(l.seconds)), GLYPH + 1));
  const hasLeads = rowLeads.some((leads) => leads.length > 0);
  const laneCount = Math.max(1, ...rowLanes.map((lanes) => Math.max(0, ...lanes) + 1));
  const band = hasLeads ? BAND_PAD + laneCount * LANE_STEP : 0;
  const ROW_H = ROW_BODY + band;
  const height = stations.length * ROW_H + AXIS_H;

  const parts: string[] = [];
  const firstHour = Math.ceil(result.timeRangeSeconds.start / 3600) * 3600;
  for (let t = firstHour; t <= result.timeRangeSeconds.end; t += 3600) {
    parts.push(`<line x1="${x(t).toFixed(1)}" y1="0" x2="${x(t).toFixed(1)}" y2="${height - AXIS_H}" stroke="${ink.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${x(t).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="${ink.axis}" font-size="11">${secondsToClockTime(t).slice(0, 5)}</text>`);
  }

  stations.forEach((station, row) => {
    const top = row * ROW_H;
    const baseline = top + ROW_H - 6;
    const usable = ROW_BODY - 14;
    const rowMax = Math.max(1, ...station.distribution.map((b) => b.total));
    const rowLabel = trafficStationName(station);
    const label = rowLabel.length > 28 ? `${rowLabel.slice(0, 27)}…` : rowLabel;

    parts.push(`<text x="0" y="${top + ROW_H / 2 + 4}" fill="${ink.label}" font-size="12" font-weight="500">${esc(label)}</text>`);
    parts.push(`<line x1="${LABEL_W}" y1="${baseline}" x2="${LABEL_W + PLOT_W}" y2="${baseline}" stroke="${ink.base}" stroke-width="1"/>`);

    station.distribution.forEach((bin, i) => {
      if (bin.total === 0) return;
      const bx = LABEL_W + i * binW;
      let cursor = baseline;
      bin.byCourse.forEach((count, courseIndex) => {
        if (count === 0) return;
        const h = (count / rowMax) * usable;
        cursor -= h;
        parts.push(`<rect x="${bx.toFixed(1)}" y="${cursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h - (h >= 6 ? 2 : 0), 0.5).toFixed(1)}" fill="${series[courseIndex % series.length]}"/>`);
      });
      if (i === station.peakBinIndex) {
        parts.push(`<rect x="${(bx - 1.5).toFixed(1)}" y="${(baseline - (bin.total / rowMax) * usable - 5).toFixed(1)}" width="${(barW + 3).toFixed(1)}" height="3" fill="${ink.peak}"/>`);
      }
    });

    // The head of the field: one mark per distance per sex, in that distance's colour.
    rowLeads[row].forEach((lead, i) => {
      const lx = x(lead.seconds);
      if (lx < LABEL_W || lx > LABEL_W + PLOT_W) return;
      const colour = series[Math.max(0, result.courseOrder.indexOf(lead.courseName)) % series.length];
      const gy = top + BAND_PAD / 2 + rowLanes[row][i] * LANE_STEP + GLYPH / 2;
      const title = `${sexLabel(lead.sex)} — ${esc(lead.courseName)}, ${secondsToClockTime(
        lead.seconds
      ).slice(0, 5)} at ${lead.kmFromStart.toFixed(1)} km`;
      parts.push(
        `<line x1="${lx.toFixed(1)}" y1="${(gy + GLYPH / 2).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${baseline}" stroke="${colour}" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.75"/>` +
          `<text x="${lx.toFixed(1)}" y="${gy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${colour}" font-size="${GLYPH}"><title>${title}</title>${sexGlyph(lead.sex)}</text>`
      );
    });
  });

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Runner arrivals over time at each station" style="max-width:${width}px">${parts.join('')}</svg>`;
}


/**
 * Renders the whole plan as one self-contained HTML file — no scripts, no external
 * styles, no fonts to fetch. An organiser can open it offline, print it, or forward it
 * without needing this tool, which is the point: the schedule has to survive leaving
 * the browser it was calculated in.
 */
export function buildReportHtml(result: PipelineResult, options: ReportOptions): string {
  const { raceName, rules, overrides, amenities = DEFAULT_AMENITIES } = options;
  const dark = options.theme === 'dark';
  const notes = options.notes ?? {};
  const sections = options.sections ?? ALL_REPORT_SECTIONS;
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  /** A moment with the day it falls on, for a race that does not fit inside one. */
  const day = (seconds: number) => formatEventClock(seconds, options.raceDate);

  const courses = [...result.courses]
    .filter((c) => result.courseOrder.includes(c.name))
    // Legs are raced in order; separate distances read best longest first.
    .sort((a, b) =>
      result.legOrdered
        ? result.courseOrder.indexOf(a.name) - result.courseOrder.indexOf(b.name)
        : b.totalKm - a.totalKm
    );

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
        }${notes[station.mapName] ? `<div class="sub note">${esc(notes[station.mapName])}</div>` : ''}</td>
        <td class="sub">${crossings}</td>
        <td class="num">${day(station.schedule.openSeconds)}</td>
        <td class="num">${day(station.schedule.closeSeconds)}</td>
        <td class="num">${(() => {
          const seconds = windowSeconds(station.schedule.openClockTime, station.schedule.closeClockTime);
          return seconds && seconds > 0 ? formatDuration(seconds) : '–';
        })()}</td>
        <td class="num">${(() => {
          const bin = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
          return bin
            ? `${day(bin.binStartSeconds)}–${secondsToClockTime(bin.binEndSeconds).slice(0, 5)}`
            : '–';
        })()}</td>
        <td class="num">${peakRunnersPerWindow(station.schedule.peakRunnersPerHour, result.binMinutes).toLocaleString()}</td>
        <td><span class="tag ${station.schedule.activityLevel}">${station.schedule.activityLevel}</span></td>
        ${station.schedule.cutoffExceeded ? '<td class="risk">Over cut-off</td>' : '<td></td>'}
      </tr>`;
    })
    .join('');

  const perDistance = !sections.perDistance ? '' : courses
    .map((course) => {
      const stops = buildRun(result, course.name);
      if (stops.length === 0) return '';

      const onCourse = (stop: Stop) =>
        !isEndZoneStop(stop.station.mapName, stop.kmFromStart, course.totalKm);
      const courseStops = stops.filter(onCourse);

      const sets = stops.map((s) =>
        resolveAmenities(s.station.schedule.activityLevel, rules, overrides[s.station.mapName], amenities)
      );
      // Counts describe what a runner meets between the lines, so start and finish
      // furniture is listed but never counted.
      const totals = totalAmenities(
        courseStops.map((s) =>
          resolveAmenities(s.station.schedule.activityLevel, rules, overrides[s.station.mapName], amenities)
        ),
        amenities
      );
      const longest = Math.max(0, ...stops.map((s) => s.gapKm));

      const rows = stops
        .map((stop, i) => {
          const set = sets[i];
          const cells = amenities.map(
            (a) => `<td class="mid">${set[a.key] ? a.icon : ''}</td>`
          ).join('');
          return `<tr${onCourse(stop) ? '' : ' class="end-zone"'}>
            <td class="num sub">${onCourse(stop) ? courseStops.indexOf(stop) + 1 : '—'}</td>
            <td>${esc(stop.station.schedule.name)}${
              stop.passCount > 1 ? `<div class="sub">pass ${stop.passIndex + 1} of ${stop.passCount}</div>` : ''
            }${notes[stop.station.mapName] ? `<div class="sub note">${esc(notes[stop.station.mapName])}</div>` : ''}</td>
            <td class="num">${stop.kmFromStart.toFixed(1)}</td>
            <td class="num${stop.gapKm === longest && longest > 0 ? ' risk' : ''}">${stop.gapKm.toFixed(1)}</td>
            <td class="num">${day(stop.station.schedule.openSeconds)}</td>
            <td class="num">${day(stop.station.schedule.closeSeconds)}</td>
            <td class="num">${stop.officialCutoffClock ? hm(stop.officialCutoffClock) : '–'}</td>
            <td><span class="tag ${stop.station.schedule.activityLevel}">${
              stop.station.schedule.activityLevel
            }</span></td>
            ${cells}
          </tr>`;
        })
        .join('');

      const totalCells = amenities.map((a) => `<td class="mid"><strong>${totals[a.key]}</strong></td>`).join('');

      return `<h2>${esc(course.name)} — ${course.totalKm.toFixed(1)} km</h2>
        <p class="note">${courseStops.length} stops on course, longest gap ${longest.toFixed(1)} km. Start and finish furniture is greyed and not counted.</p>
        <table>
          <thead><tr>
            <th></th><th>Point</th><th class="num">At km</th><th class="num">Gap</th>
            <th class="num">Open</th><th class="num">Close</th><th class="num">Cut-off</th>
            <th>Activity</th>
            ${amenities.map((a) => `<th class="mid">${esc(a.label)}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}
            <tr class="total"><td></td><td><strong>Total</strong></td>
            <td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td></td>
            ${totalCells}</tr>
          </tbody>
        </table>`;
    })
    .join('');

  // The time a CP actually works to is the LATEST proposal across the distances through
  // it — usually the slowest arrival of the longest race. Without marking it, the sheet
  // is a wall of equal-looking times and the one that governs the position is lost.
  const finalCutoffByStation = new Map<string, number>();
  for (const row of result.cutoffTable) {
    const seconds = parseClockTimeToSeconds(row.suggestedClockTime) ?? -1;
    if (seconds > (finalCutoffByStation.get(row.stationName) ?? -1)) {
      finalCutoffByStation.set(row.stationName, seconds);
    }
  }

  /** Minutes between the modelled tail and the proposed cut-off, as on screen. */
  const marginMinutes = (suggested: string, modeled: string): number | null => {
    const a = parseClockTimeToSeconds(suggested);
    const b = parseClockTimeToSeconds(modeled);
    return a === null || b === null ? null : Math.round((a - b) / 60);
  };

  const cutoffRows = !sections.cutoffs ? '' : result.cutoffTable
    .map((row) => {
      const isFinal =
        parseClockTimeToSeconds(row.suggestedClockTime) === finalCutoffByStation.get(row.stationName);
      const margin = marginMinutes(row.suggestedClockTime, row.modeledLastArrivalClockTime);
      return `<tr${isFinal ? ' class="final-row"' : ''}>
        <td>${esc(row.stationName)}</td>
        <td>${esc(row.courseName)}</td>
        <td class="num">${row.kmFromStart.toFixed(1)}</td>
        <td class="num">${day(row.modeledLastArrivalSeconds)}</td>
        <td class="num ${isFinal ? 'cot-final' : 'cot-other'}">${
          isFinal ? '<span class="final-tag">final</span>' : ''
        }<strong>${day(row.suggestedSeconds)}</strong></td>
        <td class="num muted">${margin === null ? '–' : `+${margin} min`}</td>
        <td class="num${row.mapIsTighter ? ' risk' : ''}">${
          row.mapSeconds !== undefined ? day(row.mapSeconds) : row.mapClockTime ? hm(row.mapClockTime) : '–'
        }</td>
      </tr>`;
    })
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
            const note = notes[station.mapName] ? `<div class="sub note">${esc(notes[station.mapName])}</div>` : '';
            return `<tr><td>${esc(station.schedule.name)}${note}</td><td class="num">${day(
              station.schedule.openSeconds
            )}–${day(station.schedule.closeSeconds)}</td>${cells}</tr>`;
          })
          .join('');
        return `<h2>Split calculation</h2>
        <p class="note">Kilometres are measured along each distance's own route, so one point reads differently per race.</p>
        <table><thead><tr><th></th><th class="num">Operating</th>${head}</tr></thead>
        <tbody>${body}</tbody></table>`;
      })();

  const distributionTable = !sections.distribution
    ? ''
    : (() => {
        const entries = splitStartFinish(result);
        const anyLeads = entries.some((s) => leadsForStation(s).length > 0);
        const body = entries
          .map((station) => {
            const peak = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
            const window = peak
              ? `${day(peak.binStartSeconds)}–${secondsToClockTime(
                  peak.binEndSeconds
                ).slice(0, 5)}`
              : '–';
            const busiest = (() => {
              if (!peak) return '–';
              let best = -1;
              let bestCount = 0;
              peak.byCourse.forEach((count, i) => {
                if (count > bestCount) {
                  bestCount = count;
                  best = i;
                }
              });
              return best >= 0 ? result.courseOrder[best] : '–';
            })();
            const lead = (sex: 'M' | 'F') => {
              const first = firstLeadOfSex(station, sex);
              return first
                ? `${secondsToClockTime(first.seconds).slice(0, 5)} <span class="sub">${esc(
                    first.courseName
                  )}</span>`
                : '–';
            };
            return `<tr>
              <td>${esc(trafficStationName(station))}</td>
              <td class="num">${window}</td>
              <td class="num">${peak ? peak.total.toLocaleString() : '–'}</td>
              <td>${esc(busiest)}</td>
              <td><span class="tag ${station.station.schedule.activityLevel}">${station.station.schedule.activityLevel}</span></td>
              ${anyLeads ? `<td class="num">${lead('M')}</td><td class="num">${lead('F')}</td>` : ''}
            </tr>`;
          })
          .join('');
        const series = dark ? DARK_SERIES : LIGHT_SERIES;
        const ink = dark
          ? { label: '#f3f8ff', axis: 'rgba(243,248,255,0.4)', grid: 'rgba(243,248,255,0.1)', base: 'rgba(243,248,255,0.22)', peak: '#f3f8ff' }
          : { label: '#16221f', axis: '#7b8a87', grid: '#e5eae8', base: '#c7d0cd', peak: '#16221f' };
        const legend = courses
          .map((c, i) => `<span class="key"><span class="swatch" style="background:${series[i % series.length]}"></span>${esc(c.name)}</span>`)
          .join('');
        const svg = buildDistributionSvg(result, series, ink, entries);
        return `<h2>Crossing time distribution</h2>
        <p class="note">Runner arrivals per ${result.binMinutes} minutes on one shared clock, stacked by distance. Each row is scaled to its own peak; the table beneath carries the absolute numbers.</p>
        <div class="legend">${legend}<span class="key"><span class="swatch peak"></span>Peak window</span>${
          anyLeads ? '<span class="key">♂♀ First Male / Female, coloured by distance</span>' : ''
        }</div>
        ${svg}
        <table><thead><tr>
          <th>Station</th><th class="num">Peak window</th>
          <th class="num">Through in ${result.binMinutes} min</th><th>Busiest distance</th><th>Activity</th>
          ${anyLeads ? '<th class="num">First Male</th><th class="num">First Female</th>' : ''}
        </tr></thead><tbody>${body}</tbody></table>`;
      })();

  const stationTrafficSection = !sections.stationTraffic
    ? ''
    : (() => {
        const series = dark ? DARK_SERIES : LIGHT_SERIES;
        const ink = dark
          ? { label: '#f3f8ff', axis: 'rgba(243,248,255,0.4)', base: 'rgba(243,248,255,0.22)' }
          : { label: '#16221f', axis: '#7b8a87', base: '#c7d0cd' };

        const blocks = splitStartFinish(result)
          .map((station) => {
            const view = buildStationTraffic(station, result.courseOrder);
            if (!view) return '';

            const head = view.active
              .map((bin) => `<th class="num">${secondsToClockTime(bin.binStartSeconds).slice(0, 5)}</th>`)
              .join('');
            const body = view.present
              .map(({ name, index }) => {
                const cells = view.active
                  .map((bin) => `<td class="num">${bin.byCourse[index] ? bin.byCourse[index].toLocaleString() : ''}</td>`)
                  .join('');
                return `<tr><td><span class="swatch" style="background:${series[index % series.length]}"></span>${esc(name)}</td>${cells}<td class="num"><strong>${courseTotal(view, index).toLocaleString()}</strong></td></tr>`;
              })
              .join('');
            const totals = view.active
              .map((bin) => `<td class="num"><strong>${bin.total ? bin.total.toLocaleString() : ''}</strong></td>`)
              .join('');
            const allThrough = view.active.reduce((sum, bin) => sum + bin.total, 0);

            const man = firstLeadOfSex(station, 'M');
            const woman = firstLeadOfSex(station, 'F');
            const lead = [
              man ? `Male <span class="lead-time">${secondsToClockTime(man.seconds).slice(0, 5)}</span>` : '',
              woman ? `Female <span class="lead-time">${secondsToClockTime(woman.seconds).slice(0, 5)}</span>` : '',
            ]
              .filter(Boolean)
              .join(' &middot; ');
            const clock = (seconds: number) => secondsToClockTime(seconds).slice(0, 5);

            return `<div class="station-block">
              <h3>${esc(trafficStationName(station))}</h3>
              <dl class="traffic-facts">
                <dt>Operating time</dt><dd>${clock(view.active[0].binStartSeconds)} &ndash; ${clock(
                  view.active[view.active.length - 1].binEndSeconds
                )}</dd>
                <dt>Total visits</dt><dd>${allThrough.toLocaleString()}</dd>
                <dt>Busiest</dt><dd><strong>${view.busiestBin.total.toLocaleString()}</strong> at ${clock(
                  view.busiestBin.binStartSeconds
                )} &ndash; ${clock(view.busiestBin.binEndSeconds)}</dd>
                ${lead ? `<dt>First through</dt><dd>${lead}</dd>` : ''}
              </dl>
              ${buildStationTrafficSvg(view, series, ink)}
              <table><thead><tr><th>Distance</th>${head}<th class="num">Total</th></tr></thead>
              <tbody>${body}<tr class="total"><td><strong>All</strong></td>${totals}<td class="num"><strong>${allThrough.toLocaleString()}</strong></td></tr></tbody></table>
            </div>`;
          })
          .join('');

        return `<h2>Traffic at each station</h2>
        <p class="note">One station at a time, with every figure printed on the bar — the page a crew works from. Distances stand side by side rather than stacked, so each race can be counted on its own.</p>
        ${blocks}`;
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
  /* EnduranceMap brand. The dark variant is the same report in the app's own
     theme; the light variant is the printable document. Print always drops to
     ink-on-paper — paper is paper whatever the screen looked like. */
  :root {
    ${
      dark
        ? `--bg: #16221f; --surface: #223532; --text: #f3f8ff; --accent: #07bc02;
    --divider: rgba(243, 248, 255, 0.16); --muted: rgba(243, 248, 255, 0.58);
    --faint: rgba(243, 248, 255, 0.40); --danger: #ff8a80; --warn: #f0b46a; --ok: #5ed350;
    color-scheme: dark;`
        : `--bg: #ffffff; --surface: #f7faf9; --text: #16221f; --accent: #05864e;
    --divider: #d9e0de; --muted: #5c6b68; --faint: #7b8a87;
    --danger: #b42318; --warn: #b54708; --ok: #067647;
    color-scheme: light;`
    }
  }
  * { box-sizing: border-box; }
  body {
    font: 400 13px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text); background: var(--bg);
    margin: 0; padding: 40px 32px; -webkit-font-smoothing: antialiased;
    max-width: 1140px; margin-inline: auto;
  }
  .masthead { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
  .masthead svg { flex: none; }
  .wordmark { font-weight: 700; font-size: 20px; letter-spacing: -0.03em; }
  .wordmark-accent { color: #07bc02; }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.02em; }
  h2 {
    font-size: 15px; margin: 30px 0 6px; font-weight: 600; letter-spacing: -0.01em;
    padding-top: 14px; border-top: 1px solid var(--divider);
  }
  .meta, .note { color: var(--muted); font-size: 12px; margin: 0 0 4px; }
  .kicker {
    display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 6px; font-weight: 600;
  }
  table {
    width: 100%; border-collapse: collapse; margin: 10px 0 22px; font-size: 12px;
    border: 1px solid var(--divider);
  }
  th, td { border: 1px solid var(--divider); padding: 6px 8px; text-align: left; vertical-align: middle; }
  th {
    background: var(--surface); font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); font-weight: 600; white-space: nowrap;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mid, th.mid { text-align: center; }
  .sub { color: var(--muted); font-size: 11px; }
  .sub.note { color: var(--accent); }
  .risk { color: var(--danger); font-weight: 600; }
  .end-zone td { opacity: 0.55; }
  .cot-final { color: var(--accent); }
  .cot-other { color: var(--muted); }
  .final-row td { background: ${dark ? 'rgba(7, 188, 2, 0.07)' : '#f2faf5'}; }
  .station-block { margin: 18px 0 26px; page-break-inside: avoid; }
  .traffic-facts { display: grid; grid-template-columns: max-content 1fr; gap: 1px 14px;
    margin: 4px 0 10px; font-size: 12px; }
  .traffic-facts dt { color: var(--muted); }
  .traffic-facts dd { margin: 0; }
  .lead-time { color: ${dark ? '#39ff88' : '#0a8f3c'}; font-weight: 600; }
  .station-block h3 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
  .final-tag {
    display: inline-block; margin-right: 6px; padding: 1px 5px; border-radius: 4px;
    background: ${dark ? 'rgba(7, 188, 2, 0.16)' : '#dff2e5'};
    color: var(--accent); font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em; vertical-align: 1px;
  }
  .total td { background: var(--surface); font-weight: 600; }
  .tag { font-size: 11px; font-weight: 600; }
  .tag.High { color: var(--danger); } .tag.Medium { color: var(--warn); } .tag.Low { color: var(--ok); }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 10px 0 8px; font-size: 12px; color: var(--muted); }
  .key { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
  .swatch.peak { height: 3px; border-radius: 1px; background: var(--text); }
  footer {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--divider);
    color: var(--muted); font-size: 11px;
  }
  .powered {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-bottom: 12px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--faint);
  }
  .powered .chip {
    background: #eef4f3; border-radius: 4px; padding: 4px 10px; display: inline-flex; align-items: center;
  }
  .powered img { height: 16px; display: block; }
  .disclaimer { text-align: center; }

  @media print {
    :root {
      --bg: #ffffff; --surface: #f2f6f5; --text: #16221f; --divider: #d9e0de;
      --muted: #5c6b68; --faint: #5c6b68; --danger: #b42318; --warn: #b54708; --ok: #067647;
      color-scheme: light;
    }
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    tr { page-break-inside: avoid; }
    footer { page-break-inside: avoid; }
  }
</style></head>
<body>
  <div class="masthead">
    <svg width="30" height="30" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <path d="M44 4 C64 4 80 20 80 42 C80 62 60 76 44 84 C28 76 8 62 8 42 C8 20 24 4 44 4Z" fill="#07bc02"/>
      <path d="M18 54 L33 31 L43 45 L55 24 L70 53" stroke="#0d0f10" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="55" cy="24" r="5" fill="#eafbe6"/>
    </svg>
    <span class="wordmark">Endurance<span class="wordmark-accent">Map</span></span>
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
      <th class="num">Duration</th><th class="num">Peak window</th>
      <th class="num">Peak /${result.binMinutes} min</th><th>Activity</th><th></th>
    </tr></thead>
    <tbody>${scheduleRows}</tbody>
  </table>`
      : ''
  }

  ${perDistance}

  ${splitTable}

  ${distributionTable}

  ${stationTrafficSection}

  ${
    cutoffRows
      ? `<h2>Cut-off times</h2>
  <p class="note">The highlighted row is the final cut-off for that station — the latest across every distance through it.</p>
  <table>
    <thead><tr>
      <th>Station</th><th>Distance</th><th class="num">Km</th>
      <th class="num">Slowest arrival</th><th class="num">Proposed cut-off</th>
      <th class="num">Margin</th><th class="num">Provided COT</th>
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
