import type { PipelineStation } from './pipeline';
import type { StackedBin } from './schedule';

/**
 * One station's traffic, prepared once for both the screen and the report.
 *
 * The two draw it differently — React against a string of SVG — but they must agree on
 * which windows are shown, which distances appear and how tall a bar is, or a crew
 * briefed off the printout would be working from a different chart to the one the
 * operator approved.
 */
export interface StationTrafficView {
  /** Only the windows this point is working, trimmed from the shared race-wide grid. */
  active: StackedBin[];
  /** Only the distances that actually pass here, in the overview's column order. */
  present: { name: string; index: number }[];
  /** Tallest single bar, which the bars are scaled against. */
  max: number;
  /** The busiest window itself — a crew needs the hour, not just the number. */
  busiestBin: StackedBin;
  /** Everyone through this point across its working day. */
  total: number;
}

export function buildStationTraffic(
  station: PipelineStation,
  courseOrder: string[]
): StationTrafficView | null {
  const bins = station.distribution;
  const first = bins.findIndex((b) => b.total > 0);
  if (first < 0) return null;

  // The shared grid spans the whole race and most points are idle for the greater part
  // of it; a crew wants their own morning, not everyone else's.
  const last = bins.length - 1 - [...bins].reverse().findIndex((b) => b.total > 0);
  const active = bins.slice(first, last + 1);

  // An empty column would say a race comes through here when it does not.
  const present = courseOrder
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => active.some((b) => (b.byCourse[index] ?? 0) > 0));

  return {
    active,
    present,
    max: Math.max(1, ...active.map((b) => Math.max(...b.byCourse))),
    busiestBin: active.reduce((busiest, bin) => (bin.total > busiest.total ? bin : busiest), active[0]),
    total: active.reduce((sum, bin) => sum + bin.total, 0),
  };
}

/** Total through this point on one distance, across its working window. */
export function courseTotal(view: StationTrafficView, courseIndex: number): number {
  return view.active.reduce((sum, bin) => sum + (bin.byCourse[courseIndex] ?? 0), 0);
}
