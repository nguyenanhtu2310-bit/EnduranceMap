/**
 * What a cut-off does, rather than what one could be.
 *
 * The tool proposes cut-offs from the modelled tail, which is the right thing to offer a
 * race that has not set any. Against a card that has, it is the wrong question: a
 * cut-off is not a prediction anybody got wrong, it is a decision about who stops here.
 *
 * Measured against a real published card, the proposal missed the director's own times by
 * up to two and a half hours — and every one of those gaps turned out to be a choice
 * rather than an error. The 100 km's intermediate cut-offs sit tighter than its own
 * finish, so a runner pacing to use all 28 hours is eliminated at CP2. The 50 km's are
 * looser, because they are the 70 km's cut-offs and the shorter race inherits them with
 * slack. Neither is visible from a proposal. Both are visible from this.
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

/** A cut-off leaving behind more than this share of the field is worth a second look. */
export const HEAVY_SHARE = 0.1;
