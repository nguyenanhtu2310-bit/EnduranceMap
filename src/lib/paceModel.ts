import { parseClockTimeToSeconds, secondsToClockTime } from './time';
import { DEFAULT_PERCENTILES } from './config';
import type { PercentileResult } from './percentiles';

export interface PaceBand {
  fastestMinPerKm: number;
  typicalMinPerKm: number;
  slowestMinPerKm: number;
}

export interface StartField {
  /** Wave/gun start time, "HH:MM" or "HH:MM:SS". */
  startTimeClock: string;
  runnerCount: number;
  /**
   * Minutes over which the field actually crosses the start line. A mass-participation
   * race releases in corrals, so the last runner may cross several minutes after the
   * gun. Modelling a zero spread piles the whole field into one instant and makes every
   * station near the start read as impossibly busy.
   */
  startSpreadMinutes?: number;
}

export const DEFAULT_START_SPREAD_MINUTES = 10;

/**
 * Seconds after the gun at which a runner at a given pace percentile crosses the start
 * line. Corrals are seeded by expected finish time, so faster runners start earlier.
 */
function startOffsetSeconds(percentile: number, spreadMinutes: number): number {
  return (Math.min(100, Math.max(0, percentile)) / 100) * spreadMinutes * 60;
}

/**
 * Models a pace percentile curve from three anchor points (P1 = fastest, P50 = typical,
 * P99 = slowest), interpolating in log-pace space between them. Mass-participation race
 * finishing-time distributions are right-skewed — a long tail of much slower runners —
 * which log-space interpolation between a fast anchor and a slow anchor approximates
 * reasonably without requiring a full parametric fit.
 */
export function modelPacePercentiles(
  band: PaceBand,
  percentiles: number[] = DEFAULT_PERCENTILES
): { percentile: number; paceMinPerKm: number }[] {
  const anchors = [
    { p: 1, logPace: Math.log(band.fastestMinPerKm) },
    { p: 50, logPace: Math.log(band.typicalMinPerKm) },
    { p: 99, logPace: Math.log(band.slowestMinPerKm) },
  ];

  return percentiles.map((p) => {
    let logPace: number;
    if (p <= anchors[0].p) {
      logPace = anchors[0].logPace;
    } else if (p >= anchors[2].p) {
      logPace = anchors[2].logPace;
    } else if (p <= anchors[1].p) {
      const t = (p - anchors[0].p) / (anchors[1].p - anchors[0].p);
      logPace = anchors[0].logPace + t * (anchors[1].logPace - anchors[0].logPace);
    } else {
      const t = (p - anchors[1].p) / (anchors[2].p - anchors[1].p);
      logPace = anchors[1].logPace + t * (anchors[2].logPace - anchors[1].logPace);
    }
    return { percentile: p, paceMinPerKm: Math.exp(logPace) };
  });
}

/** Derives clock-time arrival percentiles at a given km mark from a manual pace band, when no results CSV exists yet. */
export function arrivalPercentilesFromPaceBand(
  band: PaceBand,
  start: StartField,
  kmFromStart: number,
  percentiles: number[] = DEFAULT_PERCENTILES
): PercentileResult[] {
  const startSeconds = parseClockTimeToSeconds(start.startTimeClock);
  if (startSeconds === null) throw new Error(`Invalid start time: "${start.startTimeClock}"`);
  const spreadMinutes = start.startSpreadMinutes ?? DEFAULT_START_SPREAD_MINUTES;

  return modelPacePercentiles(band, percentiles).map(({ percentile, paceMinPerKm }) => {
    const seconds =
      startSeconds + startOffsetSeconds(percentile, spreadMinutes) + paceMinPerKm * kmFromStart * 60;
    return { percentile, seconds, clockTime: secondsToClockTime(seconds) };
  });
}

/**
 * Generates synthetic per-runner arrival timestamps from the pace-band model, so the
 * same histogram/activity-level code that operates on real CSV arrivals can also drive
 * the UI when only manual pace-band input is available.
 */
export function samplePaceModelArrivals(
  band: PaceBand,
  start: StartField,
  kmFromStart: number,
  sampleSize = 200
): number[] {
  if (start.runnerCount <= 0 || sampleSize <= 0) return [];

  const quantiles = Array.from({ length: sampleSize }, (_, i) => ((i + 0.5) / sampleSize) * 100);
  const modeled = arrivalPercentilesFromPaceBand(band, start, kmFromStart, quantiles);
  const runnersPerSample = start.runnerCount / sampleSize;

  const samples: number[] = [];
  for (const point of modeled) {
    const repeats = Math.max(1, Math.round(runnersPerSample));
    for (let i = 0; i < repeats; i++) samples.push(point.seconds);
  }
  return samples;
}
