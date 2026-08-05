import { secondsToClockTime } from './time';
import type { StationTrafficView } from './stationTraffic';

/** Ink a static chart is drawn with, so one builder serves a light page and a dark one. */
export interface TrafficInk {
  label: string;
  axis: string;
  base: string;
}

export interface TrafficSvgOptions {
  /** Height of the bars themselves. A crew sheet has a page to fill; a report has a column. */
  plotHeight?: number;
  /** Widest a bar may be drawn. Narrow stations would otherwise become slabs. */
  maxBarWidth?: number;
  /** Face for the figure above each bar. */
  valueFontSize?: number;
  /** Face for the clock under each group. */
  axisFontSize?: number;
  /**
   * Cap on how wide the drawing may render. A page-filling sheet passes null so a
   * short station stretches across the paper instead of huddling in the left third.
   */
  maxWidthPx?: number | null;
}

/** Bands above the bars and below them, which a caller sizing a page has to allow for. */
export const TRAFFIC_BANDS = { top: 16, axis: 20 } as const;

/**
 * How wide this station's drawing comes out, before any scaling.
 *
 * A caller fitting the chart to a page needs this to solve the other way round: the
 * rendered height is the page width times the viewBox's own ratio, so the width has to
 * be known before a plot height can be chosen.
 */
export function trafficSvgWidth(view: StationTrafficView, maxBarWidth = 30): number {
  const barW = Math.max(7, maxBarWidth - view.present.length * 4);
  const groupW = view.present.length * (barW + BAR_GAP) + GROUP_GAP;
  return LEFT_PAD + view.active.length * groupW;
}

const BAR_GAP = 2;
const GROUP_GAP = 14;
const TOP_BAND = TRAFFIC_BANDS.top;
const AXIS_BAND = TRAFFIC_BANDS.axis;
const LEFT_PAD = 4;

/**
 * One station's traffic as a static SVG: a bar per distance per window, each carrying
 * its own figure.
 *
 * Shared by the report and the printed crew sheets so the two cannot disagree about
 * what a crew is looking at — the sheet is only the same chart given a page of its own.
 * Sized by viewBox, so a caller sets the drawing's proportions and the page decides how
 * large it lands.
 */
export function buildStationTrafficSvg(
  view: StationTrafficView,
  series: string[],
  ink: TrafficInk,
  options: TrafficSvgOptions = {}
): string {
  const plotHeight = options.plotHeight ?? 170;
  const maxBarWidth = options.maxBarWidth ?? 30;
  const valueFont = options.valueFontSize ?? 9;
  const axisFont = options.axisFontSize ?? 10;

  const barW = Math.max(7, maxBarWidth - view.present.length * 4);
  const groupW = view.present.length * (barW + BAR_GAP) + GROUP_GAP;
  const width = LEFT_PAD + view.active.length * groupW;
  const height = TOP_BAND + plotHeight + AXIS_BAND;
  const baseline = TOP_BAND + plotHeight;
  const cap = options.maxWidthPx === undefined ? width : options.maxWidthPx;

  const parts: string[] = [
    `<line x1="${LEFT_PAD}" y1="${baseline}" x2="${width}" y2="${baseline}" stroke="${ink.base}" stroke-width="1"/>`,
  ];

  view.active.forEach((bin, binIndex) => {
    const groupLeft = LEFT_PAD + binIndex * groupW + GROUP_GAP / 2;

    view.present.forEach(({ index }, slot) => {
      const count = bin.byCourse[index] ?? 0;
      if (count === 0) return;
      const h = (count / view.max) * plotHeight;
      const x = groupLeft + slot * (barW + BAR_GAP);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${barW}" height="${Math.max(h, 1).toFixed(1)}" fill="${series[index % series.length]}"/>` +
          `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseline - h - 4).toFixed(1)}" text-anchor="middle" fill="${ink.label}" font-size="${valueFont}">${count.toLocaleString()}</text>`
      );
    });

    parts.push(
      `<text x="${(groupLeft + (view.present.length * (barW + BAR_GAP)) / 2).toFixed(1)}" y="${baseline + 14}" text-anchor="middle" fill="${ink.axis}" font-size="${axisFont}">${secondsToClockTime(bin.binStartSeconds).slice(0, 5)}</text>`
    );
  });

  const style = cap === null ? '' : ` style="max-width:${cap}px"`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Arrivals per window"${style}>${parts.join('')}</svg>`;
}
