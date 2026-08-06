import { parseClockTimeToSeconds, secondsToClockTime } from './time';
import type { PercentileResult } from './percentiles';
import {
  CUTOFF_CAP_STEP_MINUTES,
  DEFAULT_ACTIVITY_THRESHOLDS,
  DEFAULT_CUTOFF_GRACE_MINUTES,
  DEFAULT_CUTOFF_ROUNDING_MINUTES,
  MAX_CUTOFF_MARGIN_MINUTES,
  DEFAULT_HISTOGRAM_BIN_MINUTES,
  DEFAULT_SETUP_BUFFER_MINUTES,
  DEFAULT_TEARDOWN_BUFFER_MINUTES,
  type ActivityThresholds,
} from './config';

export interface HistogramBin {
  binStartSeconds: number;
  binEndSeconds: number;
  count: number;
}

/** Bins a set of arrival timestamps (seconds since midnight) into fixed-width windows. */
export function buildArrivalHistogram(arrivalSeconds: number[], binMinutes = DEFAULT_HISTOGRAM_BIN_MINUTES): HistogramBin[] {
  if (arrivalSeconds.length === 0) return [];

  const binSeconds = binMinutes * 60;
  const sorted = [...arrivalSeconds].sort((a, b) => a - b);
  const minTime = Math.floor(sorted[0] / binSeconds) * binSeconds;
  const maxTime = Math.ceil(sorted[sorted.length - 1] / binSeconds) * binSeconds;

  const bins: HistogramBin[] = [];
  for (let t = minTime; t < maxTime; t += binSeconds) {
    bins.push({ binStartSeconds: t, binEndSeconds: t + binSeconds, count: 0 });
  }
  // Guard against a single-instant arrival set producing zero bins.
  if (bins.length === 0) bins.push({ binStartSeconds: minTime, binEndSeconds: minTime + binSeconds, count: 0 });

  for (const arrival of sorted) {
    const idx = Math.min(bins.length - 1, Math.floor((arrival - minTime) / binSeconds));
    bins[idx].count += 1;
  }

  return bins;
}

export interface StackedBin {
  binStartSeconds: number;
  binEndSeconds: number;
  total: number;
  /** Per-course counts, in the order the courses were supplied. */
  byCourse: number[];
}

/**
 * Bins arrivals per course onto a shared grid, so several stations can be drawn
 * against one common time axis and compared directly.
 */
export function buildStackedHistogram(
  arrivalsByCourse: number[][],
  binMinutes: number,
  rangeStartSeconds: number,
  rangeEndSeconds: number
): StackedBin[] {
  const binSeconds = binMinutes * 60;
  if (binSeconds <= 0 || rangeEndSeconds <= rangeStartSeconds) return [];

  const start = Math.floor(rangeStartSeconds / binSeconds) * binSeconds;
  const end = Math.ceil(rangeEndSeconds / binSeconds) * binSeconds;
  const binCount = Math.max(1, Math.round((end - start) / binSeconds));

  const bins: StackedBin[] = Array.from({ length: binCount }, (_, i) => ({
    binStartSeconds: start + i * binSeconds,
    binEndSeconds: start + (i + 1) * binSeconds,
    total: 0,
    byCourse: arrivalsByCourse.map(() => 0),
  }));

  arrivalsByCourse.forEach((arrivals, courseIndex) => {
    for (const arrival of arrivals) {
      if (!Number.isFinite(arrival)) continue;
      const index = Math.floor((arrival - start) / binSeconds);
      if (index < 0 || index >= bins.length) continue;
      bins[index].byCourse[courseIndex] += 1;
      bins[index].total += 1;
    }
  });

  return bins;
}

export function peakRunnersPerHour(bins: HistogramBin[], binMinutes = DEFAULT_HISTOGRAM_BIN_MINUTES): number {
  if (bins.length === 0) return 0;
  const peakCount = Math.max(...bins.map((b) => b.count));
  return peakCount * (60 / binMinutes);
}

/**
 * The peak as the number actually counted: runners through in the busiest window.
 *
 * The hourly rate is this same figure scaled up, and scaling it up is what made it
 * misleading. A start-line surge of 322 in a quarter of an hour reads as 1,288 an hour —
 * an hour that never happens, over a field that does not contain that many people. What
 * a marshal is staffing for is the 322.
 *
 * The rate is kept for classifying activity, where being independent of the bin width is
 * exactly what is wanted, and it round-trips back to the count without loss.
 */
export function peakRunnersPerWindow(
  peakPerHour: number,
  binMinutes = DEFAULT_HISTOGRAM_BIN_MINUTES
): number {
  return Math.round((peakPerHour * binMinutes) / 60);
}

export type ActivityLevel = 'Low' | 'Medium' | 'High';

export function classifyActivityLevel(
  peakPerHour: number,
  thresholds: ActivityThresholds = DEFAULT_ACTIVITY_THRESHOLDS
): ActivityLevel {
  if (peakPerHour >= thresholds.highRunnersPerHour) return 'High';
  if (peakPerHour >= thresholds.mediumRunnersPerHour) return 'Medium';
  return 'Low';
}

export interface DistanceCrossing {
  courseName: string;
  kmFromStart: number;
  /** Sorted ascending by percentile. */
  arrivalPercentiles: PercentileResult[];
  /** Raw (from CSV) or modeled (from pace bands) per-runner arrival timestamps, for the histogram. */
  runnerArrivalsSeconds?: number[];
  /** Official cutoff clock time for this distance at this station, if provided. */
  officialCutoffClock?: string;
  /**
   * That cut-off as seconds from the event's first midnight, where the day it falls on is
   * known. A clock time alone cannot be compared against an ultra's arrivals: a 49-hour
   * race closing at 09:00 closes two days after it started, and parsing "09:00" puts it
   * on the morning of the first.
   */
  officialCutoffSeconds?: number;
}

export interface CutoffDetail {
  courseName: string;
  cutoffClock: string;
  modeledLastArrivalClock: string;
}

export interface StationSchedule {
  name: string;
  crossings: DistanceCrossing[];
  openClockTime: string;
  closeClockTime: string;
  /**
   * The same two moments as seconds from the event's first midnight, so a display can
   * name the day. An ultra's station opens on one day and closes on another, and the
   * clock strings alone cannot tell an eighteen-minute shift from a twenty-four-hour one.
   */
  openSeconds: number;
  closeSeconds: number;
  activityLevel: ActivityLevel;
  peakRunnersPerHour: number;
  histogram: HistogramBin[];
  cutoffExceeded: boolean;
  cutoffDetails: CutoffDetail[];
}

export interface ScheduleOptions {
  setupBufferMinutes?: number;
  teardownBufferMinutes?: number;
  binMinutes?: number;
  activityThresholds?: ActivityThresholds;
}

/**
 * Builds a single station's operating schedule from its crossing(s) of one or more
 * distances. When a station serves multiple distances (a shared checkpoint), the open
 * time is the earliest any distance needs it and the close time is the LATEST closing
 * time across all distances that pass through — per-distance close time is its official
 * cutoff if provided, else P99 plus the teardown buffer.
 */
export function buildStationSchedule(
  name: string,
  crossings: DistanceCrossing[],
  options: ScheduleOptions = {}
): StationSchedule {
  if (crossings.length === 0) {
    throw new Error(`Cannot build a schedule for "${name}" with no distance crossings.`);
  }

  const setupBufferMin = options.setupBufferMinutes ?? DEFAULT_SETUP_BUFFER_MINUTES;
  const teardownBufferMin = options.teardownBufferMinutes ?? DEFAULT_TEARDOWN_BUFFER_MINUTES;
  const binMinutes = options.binMinutes ?? DEFAULT_HISTOGRAM_BIN_MINUTES;
  const activityThresholds = options.activityThresholds ?? DEFAULT_ACTIVITY_THRESHOLDS;

  const openCandidates: number[] = [];
  const closeCandidates: number[] = [];
  const cutoffDetails: CutoffDetail[] = [];
  const allArrivals: number[] = [];

  for (const crossing of crossings) {
    const percentiles = crossing.arrivalPercentiles;
    const p1 = percentiles.find((p) => p.percentile === 1) ?? percentiles[0];
    const p99 = percentiles.find((p) => p.percentile === 99) ?? percentiles[percentiles.length - 1];

    if (p1) openCandidates.push(p1.seconds - setupBufferMin * 60);

    let closeSeconds = p99 ? p99.seconds + teardownBufferMin * 60 : undefined;

    if (crossing.officialCutoffClock) {
      const cutoffSeconds =
        crossing.officialCutoffSeconds ?? parseClockTimeToSeconds(crossing.officialCutoffClock);
      if (cutoffSeconds !== null) {
        closeSeconds = cutoffSeconds;
        if (p99 && p99.seconds > cutoffSeconds) {
          cutoffDetails.push({
            courseName: crossing.courseName,
            cutoffClock: crossing.officialCutoffClock,
            modeledLastArrivalClock: p99.clockTime,
          });
        }
      }
    }

    if (closeSeconds !== undefined) closeCandidates.push(closeSeconds);
    if (crossing.runnerArrivalsSeconds) allArrivals.push(...crossing.runnerArrivalsSeconds);
  }

  const openSeconds = Math.min(...openCandidates);
  const closeSeconds = Math.max(...closeCandidates);

  const histogram = buildArrivalHistogram(allArrivals, binMinutes);
  const peakPerHour = peakRunnersPerHour(histogram, binMinutes);

  return {
    name,
    crossings,
    openClockTime: secondsToClockTime(openSeconds),
    closeClockTime: secondsToClockTime(closeSeconds),
    openSeconds,
    closeSeconds,
    activityLevel: classifyActivityLevel(peakPerHour, activityThresholds),
    peakRunnersPerHour: peakPerHour,
    histogram,
    cutoffExceeded: cutoffDetails.length > 0,
    cutoffDetails,
  };
}

export interface CutoffTableRow {
  stationName: string;
  courseName: string;
  kmFromStart: number;
  /** Cut-off proposed by the tool, from the modelled tail plus grace, rounded up. */
  suggestedClockTime: string;
  /**
   * The same three moments as seconds from the event's first midnight, so a display can
   * name the day they fall on. A 49-hour race proposes cut-offs two days after its gun.
   */
  suggestedSeconds: number;
  mapSeconds?: number;
  modeledLastArrivalSeconds: number;
  /** Cut-off written on the source map, where the placemark carried one. */
  mapClockTime?: string;
  modeledLastArrivalClockTime: string;
  /** True when the map's cut-off falls before the proposal — the map is tighter. */
  mapIsTighter: boolean;
}

/**
 * Proposes when a position should stop runners: the slowest modelled arrival plus a
 * grace margin, rounded up. Rounding up matters — rounding to nearest could pull a
 * cut-off earlier than the calculation, which is the one direction that costs a runner
 * their race.
 *
 * The proposal is then held within `maxMarginMinutes` of that slowest arrival. Rounding
 * up is free to overshoot, and a point held open well past the last runner the model
 * puts through it is a crew kept standing for nobody. Where the cap bites, the latest
 * five-minute mark that fits is used instead; it can never land before the grace,
 * because the cap is never tighter than the grace itself.
 */
export function suggestCutoffSeconds(
  slowestArrivalSeconds: number,
  graceMinutes = DEFAULT_CUTOFF_GRACE_MINUTES,
  roundingMinutes = DEFAULT_CUTOFF_ROUNDING_MINUTES,
  maxMarginMinutes = MAX_CUTOFF_MARGIN_MINUTES
): number {
  const withGrace = slowestArrivalSeconds + graceMinutes * 60;
  const step = roundingMinutes * 60;
  const rounded = roundingMinutes > 0 ? Math.ceil(withGrace / step) * step : withGrace;

  if (maxMarginMinutes <= 0) return rounded;

  // An explicit grace beyond the cap is an instruction, not an accident of rounding.
  const ceiling = slowestArrivalSeconds + Math.max(maxMarginMinutes, graceMinutes) * 60;
  if (rounded <= ceiling) return rounded;

  const capStep = CUTOFF_CAP_STEP_MINUTES * 60;
  return Math.max(withGrace, Math.floor(ceiling / capStep) * capStep);
}

export interface CutoffTableOptions {
  graceMinutes?: number;
  roundingMinutes?: number;
  /** Furthest a proposal may sit past the slowest modelled arrival. */
  maxMarginMinutes?: number;
}

/**
 * Proposes a cut-off for every course pass, and reports any cut-off already written on
 * the map beside it. The tool's job here is to support the decision, so it computes a
 * time rather than waiting for one to be typed in; where the map already carries a
 * cut-off, the two sit side by side so a tighter one is visible.
 */
export function buildCutoffTable(
  stations: StationSchedule[],
  options: CutoffTableOptions = {}
): CutoffTableRow[] {
  const graceMinutes = options.graceMinutes ?? DEFAULT_CUTOFF_GRACE_MINUTES;
  const roundingMinutes = options.roundingMinutes ?? DEFAULT_CUTOFF_ROUNDING_MINUTES;
  const maxMarginMinutes = options.maxMarginMinutes ?? MAX_CUTOFF_MARGIN_MINUTES;
  const rows: CutoffTableRow[] = [];

  for (const station of stations) {
    for (const crossing of station.crossings) {
      const percentiles = crossing.arrivalPercentiles;
      const p99 = percentiles.find((p) => p.percentile === 99) ?? percentiles[percentiles.length - 1];
      if (!p99) continue;

      const suggestedSeconds = suggestCutoffSeconds(
        p99.seconds,
        graceMinutes,
        roundingMinutes,
        maxMarginMinutes
      );
      const mapSeconds = crossing.officialCutoffClock
        ? crossing.officialCutoffSeconds ?? parseClockTimeToSeconds(crossing.officialCutoffClock)
        : null;

      rows.push({
        stationName: station.name,
        courseName: crossing.courseName,
        kmFromStart: crossing.kmFromStart,
        suggestedClockTime: secondsToClockTime(suggestedSeconds),
        suggestedSeconds,
        mapClockTime: crossing.officialCutoffClock,
        mapSeconds: mapSeconds ?? undefined,
        modeledLastArrivalClockTime: p99.clockTime,
        modeledLastArrivalSeconds: p99.seconds,
        mapIsTighter: mapSeconds !== null && mapSeconds < suggestedSeconds,
      });
    }
  }

  return rows;
}
