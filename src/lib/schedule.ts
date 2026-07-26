import { parseClockTimeToSeconds, secondsToClockTime } from './time';
import type { PercentileResult } from './percentiles';
import {
  DEFAULT_ACTIVITY_THRESHOLDS,
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

export function peakRunnersPerHour(bins: HistogramBin[], binMinutes = DEFAULT_HISTOGRAM_BIN_MINUTES): number {
  if (bins.length === 0) return 0;
  const peakCount = Math.max(...bins.map((b) => b.count));
  return peakCount * (60 / binMinutes);
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
      const cutoffSeconds = parseClockTimeToSeconds(crossing.officialCutoffClock);
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
  cutoffClockTime: string;
  modeledLastArrivalClockTime: string;
  exceeded: boolean;
}

/** Flattens every distance/station pair that carries an official cutoff into a single table for display. */
export function buildCutoffTable(stations: StationSchedule[]): CutoffTableRow[] {
  const rows: CutoffTableRow[] = [];

  for (const station of stations) {
    for (const crossing of station.crossings) {
      if (!crossing.officialCutoffClock) continue;

      const percentiles = crossing.arrivalPercentiles;
      const p99 = percentiles.find((p) => p.percentile === 99) ?? percentiles[percentiles.length - 1];
      const cutoffSeconds = parseClockTimeToSeconds(crossing.officialCutoffClock);

      rows.push({
        stationName: station.name,
        courseName: crossing.courseName,
        kmFromStart: crossing.kmFromStart,
        cutoffClockTime: crossing.officialCutoffClock,
        modeledLastArrivalClockTime: p99?.clockTime ?? 'n/a',
        exceeded: !!p99 && cutoffSeconds !== null && p99.seconds > cutoffSeconds,
      });
    }
  }

  return rows;
}
