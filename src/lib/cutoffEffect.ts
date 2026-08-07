/**
 * What a cut-off does, rather than what one could be.
 *
 * The tool proposes cut-offs from the modelled tail, which is the right thing to offer a
 * race that has not set any. Against a card that has, it is the wrong question: a
 * cut-off is not a prediction anybody got wrong, it is a decision about who stops here.
 *
 * Measured against a real published card, the proposal missed the director's own times by
 * hours in both directions — and every one of those gaps turned out to be a choice rather
 * than an error. The 100 km's intermediate cut-offs sit tighter than its own finish, so a
 * runner pacing to use all 28 hours is eliminated at CP2. The 50 km's are looser, because
 * they are the 70 km's cut-offs unchanged and the shorter race, starting two and a half
 * hours later over three-quarters the ground, inherits them with slack. Neither is
 * visible from a proposal. Both are visible from this.
 */

export interface CutoffEffect {
  /** Runners the cut-off leaves behind, of those modelled or counted at this crossing. */
  caught: number;
  fieldSize: number;
  /** Share of the field caught, 0 to 1. */
  share: number;
  /**
   * How much faster than an even effort to the finish a runner must be to clear it.
   * Positive means the cut-off is tighter than the finish; negative means it has slack.
   */
  demandedSpeedUp: number | null;
  /** Seconds between this cut-off and the last modelled or recorded arrival. */
  marginSeconds: number | null;
}

export interface CutoffContext {
  /** Every arrival at this crossing, modelled or recorded. */
  arrivalsSeconds: number[];
  cutoffSeconds: number;
  /** When this distance started, so an elapsed share can be worked out. */
  startSeconds: number;
  /** Where on the course this crossing is, as a share of the whole effort, 0 to 1. */
  effortFraction: number;
  /** The whole distance's finish limit, in seconds from its own gun. */
  finishLimitSeconds: number | null;
}

/**
 * Reads one cut-off against the field that has to clear it.
 *
 * The speed-up figure is the one worth reading twice. A cut-off placed halfway through
 * the effort of a race and half way through its time asks nothing extra; the same
 * cut-off at half the effort and 40% of the time asks a runner to be a quarter faster
 * there than they can afford to be overall, and then bank it.
 */
export function cutoffEffect(context: CutoffContext): CutoffEffect {
  const { arrivalsSeconds, cutoffSeconds, startSeconds, effortFraction, finishLimitSeconds } =
    context;

  const fieldSize = arrivalsSeconds.length;
  const caught = arrivalsSeconds.filter((seconds) => seconds > cutoffSeconds).length;
  const last = fieldSize > 0 ? Math.max(...arrivalsSeconds) : null;

  let demandedSpeedUp: number | null = null;
  if (finishLimitSeconds && finishLimitSeconds > 0 && effortFraction > 0 && effortFraction <= 1) {
    const allowed = cutoffSeconds - startSeconds;
    if (allowed > 0) {
      // Time a runner using the whole finish limit at an even effort would have taken.
      const evenEffort = finishLimitSeconds * effortFraction;
      demandedSpeedUp = evenEffort / allowed - 1;
    }
  }

  return {
    caught,
    fieldSize,
    share: fieldSize > 0 ? caught / fieldSize : 0,
    demandedSpeedUp,
    marginSeconds: last === null ? null : cutoffSeconds - last,
  };
}

/** A cut-off asking for more than this much extra speed is worth a second look. */
export const TIGHT_SPEED_UP = 0.1;

/**
 * What a cut-off is doing, in a word.
 *
 * The two figures beside it are honest and were not readable: "+11%" tells an organiser
 * nothing about whether they have set a generous gate or an aggressive one, and that is
 * the only question anybody asks of a cut-off. A word answers it, and the figures stay
 * underneath for whoever wants to check the word.
 *
 * The bands are set around an even effort, not around a target attrition. A cut-off that
 * asks exactly what the finish limit asks is "even" — it eliminates whoever is already
 * off the pace and nobody else, which is what most checkpoints on most cards are for. The
 * ones worth naming are the ones that do something else on purpose: bought time before a
 * climb, or a gate placed to clear a mountain before dark.
 */
export type CutoffIntent = 'slack' | 'even' | 'pushing' | 'hard';

export function cutoffIntent(effect: CutoffEffect): CutoffIntent | null {
  const demanded = effect.demandedSpeedUp;
  if (demanded === null) return null;
  if (demanded < -0.05) return 'slack';
  if (demanded <= 0.03) return 'even';
  if (demanded <= TIGHT_SPEED_UP) return 'pushing';
  return 'hard';
}

/** What each verdict means, for the tooltip that has to carry it. */
export const INTENT_MEANING: Record<CutoffIntent, string> = {
  slack:
    'Looser than the finish limit — a runner on target for the finish clears this with time in hand. Usually a checkpoint that inherited a longer race’s cut-off.',
  even: 'Asks the same pace as the finish limit. It stops whoever is already behind and nobody else.',
  pushing:
    'Tighter than the finish limit — a runner must bank a little time here to make the finish.',
  hard: 'Much tighter than the finish limit. Deliberate: it clears the course before something — a climb, the dark, the heat.',
};

/** A cut-off leaving behind more than this share of the field is worth a second look. */
export const HEAVY_SHARE = 0.1;

interface EffectSource {
  stations: {
    schedule: {
      name: string;
      crossings: {
        courseName: string;
        kmFromStart: number;
        arrivalPercentiles: { percentile: number; seconds: number }[];
        runnerArrivalsSeconds?: number[];
        isCounted?: boolean;
      }[];
    };
  }[];
  distanceInputs: { courseName: string; startTimeClock: string; startDayOffset?: number }[];
  cutoffTable: {
    stationName: string;
    courseName: string;
    kmFromStart: number;
    mapSeconds?: number;
    suggestedSeconds: number;
  }[];
}

/** Identifies one cut-off row against the crossing it came from. */
export function cutoffKey(stationName: string, courseName: string, kmFromStart: number): string {
  return `${stationName}|${courseName}|${kmFromStart.toFixed(2)}`;
}

/**
 * Reads every provided cut-off on a card against the field that has to clear it.
 *
 * Effort is taken from the field rather than from the ground: the share of its own
 * median finishing time the median runner has used by this point. That needs no
 * elevation model and is truer than one — it is how the course actually spent them,
 * including the parts a profile cannot see.
 */
export function cutoffEffects(
  result: EffectSource,
  secondsFrom: (clock: string, day?: number) => number | null
): Map<string, CutoffEffect> {
  const startByCourse = new Map<string, number>();
  for (const input of result.distanceInputs) {
    const start = secondsFrom(input.startTimeClock, input.startDayOffset);
    if (start !== null) startByCourse.set(input.courseName, start);
  }

  // The median runner's elapsed time at each crossing, and at the furthest one, which is
  // the finish for every course that has one.
  const medianAt = new Map<string, number>();
  const furthestKm = new Map<string, number>();
  for (const station of result.stations) {
    for (const crossing of station.schedule.crossings) {
      const p50 =
        crossing.arrivalPercentiles.find((p) => p.percentile === 50) ??
        crossing.arrivalPercentiles[Math.floor(crossing.arrivalPercentiles.length / 2)];
      if (!p50) continue;
      medianAt.set(cutoffKey(station.schedule.name, crossing.courseName, crossing.kmFromStart), p50.seconds);
      if (crossing.kmFromStart > (furthestKm.get(crossing.courseName) ?? -1)) {
        furthestKm.set(crossing.courseName, crossing.kmFromStart);
      }
    }
  }

  const medianFinish = new Map<string, number>();
  for (const station of result.stations) {
    for (const crossing of station.schedule.crossings) {
      if (crossing.kmFromStart !== furthestKm.get(crossing.courseName)) continue;
      const p50 =
        crossing.arrivalPercentiles.find((p) => p.percentile === 50) ??
        crossing.arrivalPercentiles[Math.floor(crossing.arrivalPercentiles.length / 2)];
      if (p50) medianFinish.set(crossing.courseName, p50.seconds);
    }
  }

  const arrivalsAt = new Map<string, number[]>();
  for (const station of result.stations) {
    for (const crossing of station.schedule.crossings) {
      if (!crossing.runnerArrivalsSeconds) continue;
      arrivalsAt.set(
        cutoffKey(station.schedule.name, crossing.courseName, crossing.kmFromStart),
        crossing.runnerArrivalsSeconds
      );
    }
  }

  const effects = new Map<string, CutoffEffect>();
  for (const row of result.cutoffTable) {
    if (row.mapSeconds === undefined) continue;
    const key = cutoffKey(row.stationName, row.courseName, row.kmFromStart);
    const start = startByCourse.get(row.courseName);
    const here = medianAt.get(key);
    const finish = medianFinish.get(row.courseName);
    if (start === undefined) continue;

    const effortFraction =
      here !== undefined && finish !== undefined && finish > start ? (here - start) / (finish - start) : 0;

    effects.set(
      key,
      cutoffEffect({
        arrivalsSeconds: arrivalsAt.get(key) ?? [],
        cutoffSeconds: row.mapSeconds,
        startSeconds: start,
        effortFraction,
        finishLimitSeconds: finish !== undefined ? finish - start : null,
      })
    );
  }

  return effects;
}
