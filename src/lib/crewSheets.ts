import type { PipelineResult } from './pipeline';
import { eventDayOffset, formatEventClock } from './time';
import { firstLeadOfSex, leadsForStation } from './leadMarkers';
import { buildStationTraffic, courseTotal } from './stationTraffic';
import { TRAFFIC_BANDS, buildStationTrafficSvg, trafficSvgWidth } from './stationTrafficSvg';
import { splitStartFinish, trafficStationName, type TrafficStation } from './startFinish';

/** Translates a string, or hands it back unchanged. Supplied by the app's language. */
export type Translate = (english: string) => string;

export interface CrewSheetOptions {
  raceName: string;
  /**
   * The event's first date, so a shift that runs into the next day says so. A sheet
   * reading "06:31 – 06:49" is either eighteen minutes of work or a day and eighteen
   * minutes of it, and the crew holding it at four in the morning cannot tell.
   */
  raceDate?: string;
  /** The app's current language, so the crew reads the sheet in their own. */
  t?: Translate;
  /** Stations to print, by schedule name. Defaults to all of them. */
  only?: string[];
}

/**
 * The page, in millimetres, inside 10mm margins on A4 landscape.
 *
 * The chart is sized from what the rest of the sheet leaves rather than given a fixed
 * height, so a station with one distance and a station with four both fill their page
 * instead of trailing off into white paper.
 */
const PAGE_W_MM = 277;
const PAGE_H_MM = 190;
/**
 * Held back from the page height. Sized to the paper it will land on, a sheet computed
 * to exactly 190mm has no room for a substituted font, a printer's own margin or a
 * rounded millimetre — and one millimetre over turns every station into two pages.
 */
const SAFETY_MM = 8;
/** Measured from the rendered sheet: heading, facts, key, footer and the table's rows. */
const CHROME_MM = 34;
const TABLE_ROW_MM = 4.7;
const BAR_MAX = 46;
/** Shortest the bars may be drawn before the figures stop sitting clear of them. */
const MIN_PLOT = 150;
/** CSS pixels per millimetre at 96dpi, which is what a max-width has to be given in. */
const PX_PER_MM = 96 / 25.4;

/** Ink for paper. Crew sheets are printed, so they are always dark on white. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const INK = { label: '#16221f', axis: '#5c6b68', base: '#b9c4c1' };

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bare clock, for the column heads where the day is carried by the row instead. */
const hm = (seconds: number) => formatEventClock(seconds).replace(/^D\+\d+ /, '');

/**
 * One A4 landscape page per station: the traffic that station will see, and nothing
 * else.
 *
 * A crew chief is handed their own page and stands at their own point with it. The plan
 * they were cut from runs to six sections and dozens of pages, and finding one station
 * in it at 04:00 with a head torch is not a thing anyone should have to do. Landscape
 * because the day runs sideways: the widest station on a real map works twenty-seven
 * quarter-hours, which lands at nineteen pixels a bar across an A4 width — comfortable
 * with its figure above it, and about half that in portrait.
 *
 * Printed from the browser, which also produces the PDF if one is wanted. No library
 * writes the PDF here: the page description is the artefact, and every printer and every
 * phone already knows how to open it.
 */
export function buildCrewSheetsHtml(result: PipelineResult, options: CrewSheetOptions): string {
  const t = options.t ?? ((english: string) => english);
  const wanted = options.only ? new Set(options.only) : null;

  // A start line and a finish line get a page each: different crews, different hours.
  const stations = splitStartFinish(result).filter(
    (s) => !wanted || wanted.has(s.name) || wanted.has(trafficStationName(s, t))
  );
  const pages = stations
    .map((station) => sheet(station, result, t, options.raceName, options.raceDate))
    .filter(Boolean);
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(options.raceName)} — ${esc(t('Traffic at each station'))}</title>
<style>
  /* One station, one page, laid out for the paper it is going onto. */
  @page { size: A4 landscape; margin: 10mm; }

  :root { --ink: #16221f; --muted: #5c6b68; --line: #d4dcda; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--ink);
    background: #fff;
    font: 400 12px/1.45 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sheet {
    /* The usable box inside A4 landscape margins, so the screen preview is the page. */
    width: 277mm;
    min-height: 190mm;
    margin: 0 auto 8mm;
    padding: 0;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
  }
  .sheet:last-child { page-break-after: auto; break-after: auto; margin-bottom: 0; }

  .sheet-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 2px solid var(--ink);
    padding-bottom: 5px;
  }
  .sheet-head h1 { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; }
  .sheet-head .race { font-size: 12px; color: var(--muted); text-align: right; white-space: nowrap; }

  .facts { display: flex; gap: 26px; margin: 9px 0 4px; font-size: 12.5px; }
  .facts div { white-space: nowrap; }
  .facts dt { display: inline; color: var(--muted); margin-right: 5px; }
  .facts dd { display: inline; margin: 0; font-weight: 600; }

  .key { display: flex; gap: 16px; margin: 4px 0 2px; font-size: 11px; color: var(--muted); }
  .key span { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }

  .plot { flex: 1 1 auto; display: flex; align-items: flex-end; min-height: 0; }
  .plot svg { width: 100%; height: auto; }

  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
  th, td { padding: 2.5px 4px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  thead th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  tbody tr:last-child td { border-bottom: none; font-weight: 700; border-top: 1.5px solid var(--ink); }

  .day-turn { border-left: 2px solid var(--ink); }

  .foot { margin-top: 5px; font-size: 9px; color: var(--muted); display: flex; justify-content: space-between; }

  @media screen {
    body { background: #eef1f0; padding: 10mm 0; }
    .sheet { background: #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.2); padding: 10mm; }
  }
</style>
</head>
<body>
${pages.join('\n')}
<!-- ${esc(generated)} -->
</body>
</html>`;
}

/** The single page for one station, or '' where nobody comes through it. */
function sheet(
  station: TrafficStation,
  result: PipelineResult,
  t: Translate,
  raceName: string,
  raceDate?: string
): string {
  const day = (seconds: number) => formatEventClock(seconds, raceDate);
  const view = buildStationTraffic(station, result.courseOrder);
  if (!view) return '';

  const colour = (index: number) => SERIES[index % SERIES.length];

  const facts: string[] = [
    `<div><dt>${esc(t('Operating time'))}</dt><dd>${day(view.active[0].binStartSeconds)} – ${day(
      view.active[view.active.length - 1].binEndSeconds
    )}</dd></div>`,
    `<div><dt>${esc(t('Total visits'))}</dt><dd>${view.total.toLocaleString()}</dd></div>`,
    `<div><dt>${esc(t('Busiest'))}</dt><dd>${view.busiestBin.total.toLocaleString()} ${esc(
      t('at')
    )} ${day(view.busiestBin.binStartSeconds)} – ${hm(view.busiestBin.binEndSeconds)}</dd></div>`,
  ];

  const man = firstLeadOfSex(station, 'M');
  const woman = firstLeadOfSex(station, 'F');
  if (leadsForStation(station).length > 0) {
    const parts = [
      man ? `${esc(t('Male'))} ${day(man.seconds)}` : '',
      woman ? `${esc(t('Female'))} ${day(woman.seconds)}` : '',
    ].filter(Boolean);
    facts.push(`<div><dt>${esc(t('First through'))}</dt><dd>${parts.join(' · ')}</dd></div>`);
  }

  const key = view.present
    .map(
      ({ name, index }) =>
        `<span><i class="swatch" style="background:${colour(index)}"></i>${esc(name)}</span>`
    )
    .join('');

  // Only the columns that begin a new day are tagged, so a sheet that fits inside one
  // reads exactly as it did and a sheet that does not says where the day turned over.
  let lastDay = eventDayOffset(view.active[0].binStartSeconds);
  const head = view.active
    .map((bin) => {
      const binDay = eventDayOffset(bin.binStartSeconds);
      const turned = binDay !== lastDay;
      lastDay = binDay;
      return `<th${turned ? ' class="day-turn"' : ''}>${hm(bin.binStartSeconds)}</th>`;
    })
    .join('');
  const body = view.present
    .map(({ name, index }) => {
      const cells = view.active
        .map((bin) => `<td>${bin.byCourse[index] ? bin.byCourse[index].toLocaleString() : ''}</td>`)
        .join('');
      return `<tr><td>${esc(name)}</td>${cells}<td>${courseTotal(view, index).toLocaleString()}</td></tr>`;
    })
    .join('');
  const totals = view.active
    .map((bin) => `<td>${bin.total ? bin.total.toLocaleString() : ''}</td>`)
    .join('');

  // Fit the drawing to the space the table leaves.
  //
  // An SVG scaled to a width renders at width x (viewBox height / viewBox width), so the
  // height is chosen by choosing that ratio. A station with many windows is wide enough
  // to fill the page and take its height from the ratio. A station with five is not:
  // forcing the ratio there would squash the bars to nothing, so instead its bars keep a
  // readable height and the drawing is allowed to be narrower than the paper.
  const tableMM = TABLE_ROW_MM * (view.present.length + 2);
  const chartMM = Math.max(60, PAGE_H_MM - SAFETY_MM - CHROME_MM - tableMM);
  const vbWidth = trafficSvgWidth(view, BAR_MAX);
  const bands = TRAFFIC_BANDS.top + TRAFFIC_BANDS.axis;

  const fitted = Math.round((vbWidth * chartMM) / PAGE_W_MM) - bands;
  const plotHeight = Math.max(MIN_PLOT, fitted);
  // Where the bars had to be held at their minimum, narrow the drawing instead so the
  // rendered height still lands on the target.
  const widthMM =
    fitted >= MIN_PLOT
      ? PAGE_W_MM
      : Math.min(PAGE_W_MM, (chartMM * vbWidth) / (plotHeight + bands));

  const svg = buildStationTrafficSvg(view, SERIES, INK, {
    plotHeight,
    maxBarWidth: BAR_MAX,
    valueFontSize: 11,
    axisFontSize: 11,
    maxWidthPx: widthMM >= PAGE_W_MM ? null : Math.round(widthMM * PX_PER_MM),
  });

  return `<section class="sheet">
  <div class="sheet-head">
    <h1>${esc(trafficStationName(station, t))}</h1>
    <div class="race">${esc(raceName)}</div>
  </div>
  <dl class="facts">${facts.join('')}</dl>
  <div class="key">${key}</div>
  <div class="plot">${svg}</div>
  <table>
    <thead><tr><th>${esc(t('Distance'))}</th>${head}<th>${esc(t('Total'))}</th></tr></thead>
    <tbody>
      ${body}
      <tr><td>${esc(t('All'))}</td>${totals}<td>${view.total.toLocaleString()}</td></tr>
    </tbody>
  </table>
  <div class="foot">
    <span>${esc(station.station.sourceNames.join(', '))}</span>
    <span>${esc(t('Peak'))} /${result.binMinutes} ${esc(t('min'))}</span>
  </div>
</section>`;
}
