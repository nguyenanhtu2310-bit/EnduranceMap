/**
 * Elevation, and how much of it to believe.
 *
 * Total climb is the one number every trail race publishes and the one number nobody can
 * reproduce. Measured against a single 70 km track, summing every rise gives 4,416 m;
 * ignoring rises under ten metres gives 3,460 m. Same file, same mountain, 28% apart.
 * Neither is wrong: at two metres between points, sensor noise invents hundreds of metres
 * of climbing, and every threshold trades that noise against real terrain.
 *
 * So the threshold is not a constant here. It is chosen from the file, because files
 * differ: a track straight off a Garmin arrives noisy and needs smoothing, while the same
 * course exported by a timing provider arrives already de-noised and must be left alone —
 * smoothing it twice quietly deletes real climbing.
 */

export interface ProfilePoint {
  cumulativeKm: number;
  ele: number;
}

/**
 * How the elevation in a file behaves, which decides how much smoothing it needs.
 *
 * `raw` is a sensor recording, straight off a device: consecutive readings disagree about
 * which way the ground is going roughly half the time, because most of what they are
 * measuring is noise. `smoothed` has already been filtered by whatever wrote the file,
 * and reverses direction only rarely. The gap between the two is not subtle — real files
 * measured for this land at 0.6% and 8.6% — so a single boundary separates them safely.
 */
export type ElevationCharacter = 'raw' | 'smoothed' | 'unknown';

/** Above this share of direction reversals, the signal is mostly noise. */
const RAW_FLIP_RATE = 0.05;
/** Fewest steps that make a flip rate worth trusting. */
const MIN_STEPS_FOR_CHARACTER = 200;

/** Smoothing applied to a raw sensor recording, in metres. */
export const RAW_THRESHOLD_M = 3;

export interface ElevationCharacterResult {
  character: ElevationCharacter;
  /** Share of elevation steps that reverse the previous step's direction, 0 to 1. */
  flipRate: number;
  /** Metres of movement to ignore when totalling, chosen from the character. */
  thresholdMetres: number;
}

/**
 * Works out whether a profile is a raw recording or something already filtered.
 *
 * Flat steps are excluded before the comparison: a quantised sensor repeats its last
 * reading often, and counting those as "no reversal" would make every file look smooth.
 */
export function elevationCharacter(elevations: number[]): ElevationCharacterResult {
  const steps: number[] = [];
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta !== 0) steps.push(delta);
  }

  if (steps.length < MIN_STEPS_FOR_CHARACTER) {
    return { character: 'unknown', flipRate: 0, thresholdMetres: RAW_THRESHOLD_M };
  }

  let flips = 0;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] * steps[i - 1] < 0) flips++;
  }
  const flipRate = flips / (steps.length - 1);
  const character: ElevationCharacter = flipRate >= RAW_FLIP_RATE ? 'raw' : 'smoothed';

  return {
    character,
    flipRate,
    // A file that arrives filtered is totalled as it stands. Applying a threshold on top
    // would smooth it twice and understate the climbing.
    thresholdMetres: character === 'raw' ? RAW_THRESHOLD_M : 0,
  };
}

export interface ElevationTotals {
  gainMetres: number;
  lossMetres: number;
  minMetres: number;
  maxMetres: number;
  /** The threshold these totals were computed at, so a published figure can be compared. */
  thresholdMetres: number;
}

/**
 * Total climb and descent, ignoring movements smaller than the threshold.
 *
 * Compares each reading against the last one that counted rather than against its
 * immediate neighbour, so a long steady climb is not broken up by the threshold into
 * pieces that each fall under it.
 *
 * Raising the threshold lowers the total, but not strictly: each threshold leaves its own
 * residual wherever the reference last reset, so two neighbouring thresholds can differ
 * by about one threshold's worth in either direction. On real profiles that is around a
 * percent, against a trend of tens of percent, so it is left rather than papered over —
 * but it is the reason a total is only meaningful alongside the threshold that produced it.
 */
export function elevationTotals(elevations: number[], thresholdMetres: number): ElevationTotals {
  if (elevations.length === 0) {
    return { gainMetres: 0, lossMetres: 0, minMetres: 0, maxMetres: 0, thresholdMetres };
  }

  let gain = 0;
  let loss = 0;
  let reference = elevations[0];
  let min = elevations[0];
  let max = elevations[0];

  for (const value of elevations) {
    if (value < min) min = value;
    if (value > max) max = value;

    const delta = value - reference;
    if (Math.abs(delta) >= thresholdMetres) {
      if (delta > 0) gain += delta;
      else loss -= delta;
      reference = value;
    }
  }

  return { gainMetres: gain, lossMetres: loss, minMetres: min, maxMetres: max, thresholdMetres };
}

export interface Climb {
  startKm: number;
  endKm: number;
  startEle: number;
  endEle: number;
  /** Positive for a climb, negative for a descent. */
  changeMetres: number;
  /** Rise over run as a percentage, always positive. */
  gradientPercent: number;
}

export interface ClimbOptions {
  /**
   * How far the ground must go back the other way before a climb is considered over.
   * Without it a single dip mid-ascent would split one climb into two.
   */
  prominenceMetres?: number;
  /** Climbs and descents smaller than this are not reported. */
  minChangeMetres?: number;
}

const DEFAULT_PROMINENCE_M = 25;
const DEFAULT_MIN_CHANGE_M = 150;

/**
 * Breaks a profile into the sustained climbs and descents a runner would actually name.
 *
 * A checkpoint list says where the crew stands; this says where the race is decided. On
 * one real 164 km course the segmentation put the biggest climb at km 121 — +885 m at
 * 12.7%, reached by the back of the field in darkness after 36 hours — which is not
 * visible in any checkpoint table and is exactly where the medical cover belongs.
 */
export function segmentClimbs(profile: ProfilePoint[], options: ClimbOptions = {}): Climb[] {
  const prominence = options.prominenceMetres ?? DEFAULT_PROMINENCE_M;
  const minChange = options.minChangeMetres ?? DEFAULT_MIN_CHANGE_M;
  if (profile.length < 2) return [];

  const ele = profile.map((p) => p.ele);

  // Alternating low and high points, each separated from the last by at least the
  // prominence. The direction is unknown until the ground has moved far enough to say.
  const extrema: number[] = [0];
  let direction = 0;
  let lowest = 0;
  let highest = 0;

  for (let i = 1; i < ele.length; i++) {
    if (ele[i] > ele[highest]) highest = i;
    if (ele[i] < ele[lowest]) lowest = i;

    if (direction >= 0 && ele[highest] - ele[i] >= prominence) {
      extrema.push(highest);
      direction = -1;
      lowest = i;
      highest = i;
    } else if (direction <= 0 && ele[i] - ele[lowest] >= prominence) {
      extrema.push(lowest);
      direction = 1;
      lowest = i;
      highest = i;
    }
  }
  extrema.push(direction > 0 ? highest : direction < 0 ? lowest : ele.length - 1);

  const climbs: Climb[] = [];
  for (let i = 1; i < extrema.length; i++) {
    const a = extrema[i - 1];
    const b = extrema[i];
    if (b <= a) continue;

    const change = ele[b] - ele[a];
    if (Math.abs(change) < minChange) continue;

    const runKm = profile[b].cumulativeKm - profile[a].cumulativeKm;
    climbs.push({
      startKm: profile[a].cumulativeKm,
      endKm: profile[b].cumulativeKm,
      startEle: ele[a],
      endEle: ele[b],
      changeMetres: change,
      gradientPercent: runKm > 0 ? Math.abs(change) / (runKm * 10) : 0,
    });
  }

  return climbs;
}

/**
 * Effort-adjusted distance: the flat kilometres a leg costs, rather than the map ones.
 *
 * A hundred metres of climbing costs about as much as a kilometre on the flat — the rule
 * trail runners already pace by. It exists here because the tool's road-race model, one
 * pace multiplied by distance, is not merely imprecise on a mountain but useless: on one
 * real course two consecutive legs run at paces three times apart.
 *
 * Checked against a race director's own hand-set cut-offs across a 28-hour event, this
 * lands within an hour at every checkpoint — close enough to propose times from, and the
 * residual is readable rather than random.
 */
export const METRES_CLIMB_PER_FLAT_KM = 100;

export function flatEquivalentKm(profile: ProfilePoint[]): number {
  let total = 0;
  for (let i = 1; i < profile.length; i++) {
    const run = profile[i].cumulativeKm - profile[i - 1].cumulativeKm;
    const rise = Math.max(0, profile[i].ele - profile[i - 1].ele);
    total += run + rise / METRES_CLIMB_PER_FLAT_KM;
  }
  return total;
}
