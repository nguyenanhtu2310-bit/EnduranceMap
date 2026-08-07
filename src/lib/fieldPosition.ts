import { DEFAULT_PERCENTILES } from './config';
import { modelPacePercentiles, type PaceBand, type StartField } from './paceModel';
import type { RunnerSample } from './results';
import { eventSecondsFrom } from './time';
import { spineKmOf, type SpineMapping } from './spine';

/**
 * One runner reduced to the two numbers that place them: when they crossed the start,
 * and how fast they have been going since.
 */
export interface RunnerPace {
  startOffsetSeconds: number;
  paceMinPerKm: number;
}

export interface FieldInput extends PaceBand, StartField {
  courseName: string;
  courseKm: number;
  samples?: RunnerSample[];
}

/**
 * The field of one distance, as paces.
 *
 * A real field where one has been loaded — every finisher replayed with their own offset
 * and their own pace — and the three-point band only where none has. Measured against a
 * 9,600-entrant road race the band put the 25th percentile a full minute per km too
 * fast, so the band is what the tool uses when it has nothing better, not what it
 * prefers.
 */
export function runnerPaces(input: FieldInput, sampleSize = 200): RunnerPace[] {
  const count = Math.max(0, Math.round(input.runnerCount));
  if (count === 0) return [];

  if (input.samples && input.samples.length > 0) {
    const source = input.samples;
    return Array.from({ length: count }, (_, i) => source[Math.floor((i * source.length) / count)]);
  }

  const quantiles =
    sampleSize > 0
      ? Array.from({ length: sampleSize }, (_, i) => ((i + 0.5) / sampleSize) * 100)
      : DEFAULT_PERCENTILES;
  const modelled = modelPacePercentiles(input, quantiles);
  const spreadMinutes = input.startSpreadMinutes ?? 0;

  return Array.from({ length: count }, (_, i) => {
    const point = modelled[Math.floor((i * modelled.length) / count)];
    // Corrals are seeded by expected finish, so the quicker runners leave first.
    return {
      startOffsetSeconds: (point.percentile / 100) * spreadMinutes * 60,
      paceMinPerKm: point.paceMinPerKm,
    };
  });
}

/**
 * How far along their own course a runner is at a moment, or null when they are not on
 * it — still waiting for their gun, or already finished.
 *
 * Between two mats this is interpolation and nothing more: the count on a leg is exact,
 * because a chip read at one end and not the other puts a runner unambiguously between
 * them, but where on the leg they are is a straight line drawn through terrain that is
 * not straight.
 */
export function positionAt(
  seconds: number,
  startSeconds: number,
  runner: RunnerPace,
  courseKm: number
): number | null {
  const state = runnerStateAt(seconds, startSeconds, runner, courseKm);
  return state.km;
}

/** Waiting for their own gun, out on the course, or already home. */
export type RunnerState = 'waiting' | 'racing' | 'finished';

/**
 * Which of the three a runner is in at a moment, and how far along if they are racing.
 *
 * Told apart because they are three different answers to "where is everybody" and the
 * position alone cannot distinguish them: a runner with no kilometre is either still in
 * the pen or already showered, and a director planning a sweep, a bag drop and a finish
 * line needs to know which. Counting both as "not on course" was the same mistake as
 * counting an unmarked row as day one.
 */
export function runnerStateAt(
  seconds: number,
  startSeconds: number,
  runner: RunnerPace,
  courseKm: number
): { state: RunnerState; km: number | null } {
  const elapsed = seconds - startSeconds - runner.startOffsetSeconds;
  if (elapsed <= 0) return { state: 'waiting', km: null };
  // A pace of zero is a runner the model cannot place. They are not home, so they wait.
  if (runner.paceMinPerKm <= 0) return { state: 'waiting', km: null };
  const km = elapsed / (runner.paceMinPerKm * 60);
  if (km > courseKm) return { state: 'finished', km: null };
  return { state: 'racing', km };
}

export interface FieldSnapshot {
  /** Runners in each spine bin, one row per course in the order given. */
  binsByCourse: number[][];
  /** Runners on ground the spine does not cover, per course. */
  offSpineByCourse: number[];
  /** On course but not yet placed on the spine plus those that were, per course. */
  onCourseByCourse: number[];
  totalOnCourse: number;
  /**
   * The whole field at this moment, split three ways.
   *
   * There is deliberately no DNF here. A runner who abandons never reaches the finish
   * file the model is built from, so the field it replays is the field that finished —
   * counting a retirement would mean inventing one. Attrition is knowable only from
   * recorded splits, and claiming it from a model would be the worst kind of confident
   * wrong number: it looks like an operational fact and is arithmetic about nobody.
   */
  waiting: number;
  onCourse: number;
  finished: number;
  fieldSize: number;
}

export interface SnapshotOptions {
  binKm?: number;
  spineKm: number;
  sampleSize?: number;
}

/**
 * Where the whole field is at one moment, counted into bins along the spine.
 *
 * Runners on ground the spine never reaches are counted separately rather than dropped
 * or guessed at, because a race whose 10 km runs its own roads still has a hundred people
 * on them and a director asking "where is everybody" deserves to be told so.
 */
export function fieldSnapshot(
  seconds: number,
  inputs: FieldInput[],
  mappings: Map<string, SpineMapping>,
  pacesByCourse: Map<string, RunnerPace[]>,
  options: SnapshotOptions
): FieldSnapshot {
  const binKm = options.binKm ?? 1;
  const binCount = Math.max(1, Math.ceil(options.spineKm / binKm));

  const binsByCourse: number[][] = [];
  const offSpineByCourse: number[] = [];
  const onCourseByCourse: number[] = [];
  let totalOnCourse = 0;
  let waiting = 0;
  let finished = 0;
  let fieldSize = 0;

  for (const input of inputs) {
    const bins = new Array<number>(binCount).fill(0);
    const startSeconds = eventSecondsFrom(input.startTimeClock, input.startDayOffset);
    const paces = pacesByCourse.get(input.courseName) ?? [];
    const mapping = mappings.get(input.courseName);
    let offSpine = 0;
    let onCourse = 0;

    fieldSize += paces.length;

    if (startSeconds !== null) {
      for (const runner of paces) {
        const { state, km } = runnerStateAt(seconds, startSeconds, runner, input.courseKm);
        if (state === 'waiting') {
          waiting += 1;
          continue;
        }
        if (state === 'finished') {
          finished += 1;
          continue;
        }
        onCourse += 1;

        const spineKm = mapping ? spineKmOf(mapping, km!) : km!;
        if (spineKm === null) {
          offSpine += 1;
          continue;
        }
        const bin = Math.min(binCount - 1, Math.max(0, Math.floor(spineKm / binKm)));
        bins[bin] += 1;
      }
    } else {
      // A distance whose gun cannot be read has not started, rather than vanishing.
      waiting += paces.length;
    }

    binsByCourse.push(bins);
    offSpineByCourse.push(offSpine);
    onCourseByCourse.push(onCourse);
    totalOnCourse += onCourse;
  }

  return {
    binsByCourse,
    offSpineByCourse,
    onCourseByCourse,
    totalOnCourse,
    waiting,
    onCourse: totalOnCourse,
    finished,
    fieldSize,
  };
}

/**
 * The window the event occupies, from the first gun to the last runner off the course.
 *
 * Taken from the field rather than from the cut-offs, so the slider covers the race that
 * was modelled rather than the one that was planned.
 */
export function fieldWindow(
  inputs: FieldInput[],
  pacesByCourse: Map<string, RunnerPace[]>
): { startSeconds: number; endSeconds: number } {
  let start = Infinity;
  let end = -Infinity;

  for (const input of inputs) {
    const startSeconds = eventSecondsFrom(input.startTimeClock, input.startDayOffset);
    const paces = pacesByCourse.get(input.courseName) ?? [];
    if (startSeconds === null || paces.length === 0) continue;

    start = Math.min(start, startSeconds);
    for (const runner of paces) {
      const finish = startSeconds + runner.startOffsetSeconds + runner.paceMinPerKm * 60 * input.courseKm;
      if (finish > end) end = finish;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return { startSeconds: 0, endSeconds: 0 };
  return { startSeconds: start, endSeconds: end };
}
