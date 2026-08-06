import { eventSecondsFrom, secondsToClockTime } from './time';
import { DEFAULT_PERCENTILES } from './config';
import { computeArrivalPercentiles, type PercentileResult } from './percentiles';
import type { RunnerSample } from './results';

export interface PaceBand {
  fastestMinPerKm: number;
  typicalMinPerKm: number;
  slowestMinPerKm: number;
}

export interface StartField {
  /** Wave/gun start time, "HH:MM" or "HH:MM:SS". */
  startTimeClock: string;
  /**
   * Which day of the event this distance starts on, counted from the first. Stated
   * rather than inferred: one real card starts its 100 miles on the Friday and every
   * other distance on the Saturday, and no clock time can tell those apart.
   */
  startDayOffset?: number;
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
  const startSeconds = eventSecondsFrom(start.startTimeClock, start.startDayOffset);
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

/*
 * ---------------------------------------------------------------------------
 * Empirical model — used when a past race's results have been loaded.
 *
 * A real field is not a smooth interpolation between a fast, a typical and a slow
 * runner: measured against a 9,600-entrant road race, the three-anchor model above put
 * the 25th percentile of the 10K a full minute per km too fast. When real results are
 * available each finisher is replayed instead, carrying their own start offset and
 * their own pace, which also preserves the fact that quicker runners start nearer the
 * front.
 * ---------------------------------------------------------------------------
 */

/**
 * Projects the loaded field onto a planned race: every sampled runner starts at the new
 * gun time plus the offset they had last time, then runs their own pace to `kmFromStart`.
 * Scaled to `runnerCount` by walking the distribution evenly, so a bigger or smaller
 * entry list keeps the same shape.
 */
export function projectSampleArrivals(
  samples: RunnerSample[],
  start: StartField,
  kmFromStart: number
): number[] {
  const startSeconds = eventSecondsFrom(start.startTimeClock, start.startDayOffset);
  if (startSeconds === null) throw new Error(`Invalid start time: "${start.startTimeClock}"`);
  if (samples.length === 0 || start.runnerCount <= 0) return [];

  const count = Math.round(start.runnerCount);
  const arrivals: number[] = new Array(count);

  for (let i = 0; i < count; i++) {
    // Even walk across the reference field rather than random draws, so the same inputs
    // always produce the same schedule.
    const source = samples[Math.floor((i * samples.length) / count)];
    arrivals[i] = startSeconds + source.startOffsetSeconds + source.paceMinPerKm * kmFromStart * 60;
  }

  return arrivals;
}

/** Arrival-time percentiles at a km mark, taken from the projected real field. */
export function arrivalPercentilesFromSamples(
  samples: RunnerSample[],
  start: StartField,
  kmFromStart: number,
  percentiles: number[] = DEFAULT_PERCENTILES
): PercentileResult[] {
  return computeArrivalPercentiles(projectSampleArrivals(samples, start, kmFromStart), percentiles);
}
