/**
 * All tunable thresholds for the CP operations calculator, in one place so the
 * (future) UI can expose them as user-adjustable settings instead of buried
 * magic numbers.
 */

export interface PaceBounds {
  minMinPerKm: number;
  maxMinPerKm: number;
}

/** Plausible pace range used to sanity-check CSV split-to-checkpoint matching. */
export const DEFAULT_PACE_BOUNDS: PaceBounds = {
  minMinPerKm: 2.5,
  maxMinPerKm: 20,
};

/** Perpendicular offset (km) from a course line beyond which a snap looks suspicious. */
export const DEFAULT_SNAP_OFFSET_WARNING_KM = 0.08;

/** Perpendicular offset (km) beyond which a placemark is considered not on that course at all. */
export const DEFAULT_MAX_MATCH_OFFSET_KM = 2;

/** Perpendicular offset (km) within which a course counts as passing a placemark. */
export const DEFAULT_CROSSING_MAX_OFFSET_KM = 0.05;

/** Minimum gap (km) along a course between two positions for them to count as separate passes. */
export const DEFAULT_CROSSING_MIN_SEPARATION_KM = 1;

/** Tolerance (km) for matching a course's measured length to a race distance named in a label. */
export const DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM = 2;

/**
 * How near a cut-off's labelled km must be to a course pass for that cut-off to govern
 * it. On an out-and-back a station is crossed twice, and a cut-off written for the
 * return leg must not also bind the outbound one hours earlier.
 */
export const DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM = 2;

/** Divergence (km) between a placemark's computed position and its parsed name label that triggers a mismatch flag. */
export const DEFAULT_LABEL_MISMATCH_THRESHOLD_KM = 0.3;

/** Distance (km) within which two separately-drawn placemarks are treated as the same physical station. */
export const DEFAULT_COINCIDENT_STATION_TOLERANCE_KM = 0.03;

/**
 * Gap (km) along a course below which two snaps from different members of one station
 * are treated as the same pass rather than two separate crossings.
 */
export const DEFAULT_DUPLICATE_PASS_TOLERANCE_KM = 0.3;

/** Minutes before the modeled P1 arrival that a station should open. */
export const DEFAULT_SETUP_BUFFER_MINUTES = 60;

/** Minutes after the modeled P99 arrival that a station should stay open, absent an official cutoff. */
export const DEFAULT_TEARDOWN_BUFFER_MINUTES = 30;

/** Bin width (minutes) for crossing-time histograms. */
export const DEFAULT_HISTOGRAM_BIN_MINUTES = 15;

/**
 * Margin added to the slowest modelled arrival when proposing a cut-off. A cut-off set
 * exactly on the tail of the field would turn every modelling error into a runner pulled
 * off the course, so the proposal sits behind it.
 */
export const DEFAULT_CUTOFF_GRACE_MINUTES = 5;

/**
 * Proposed cut-offs are rounded up to this many minutes. Crews and runners work from
 * round times, not 08:37, and rounding up never makes a cut-off tighter than the
 * calculation intended.
 *
 * Five, not fifteen: rounding up to the quarter hour adds up to fifteen minutes on top
 * of the grace, so a point could be held nearly twenty minutes past the last runner the
 * model puts through it. A five-minute mark reads just as cleanly off a schedule and
 * keeps the whole margin inside MAX_CUTOFF_MARGIN_MINUTES.
 */
export const DEFAULT_CUTOFF_ROUNDING_MINUTES = 5;

/**
 * The furthest a proposal may sit past the slowest modelled arrival, whatever the grace
 * and rounding would otherwise produce. Beyond this a marshal is standing at a point the
 * model says the last runner has already left.
 *
 * A grace set larger than this wins: the operator asking for thirty minutes has said
 * what they want, and the cap exists to stop rounding inflating a margin nobody chose.
 */
export const MAX_CUTOFF_MARGIN_MINUTES = 15;

/** Fallback step when the cap bites and the usual rounding overshoots it. */
export const CUTOFF_CAP_STEP_MINUTES = 5;

export interface ActivityThresholds {
  mediumRunnersPerHour: number;
  highRunnersPerHour: number;
}

/** Peak runners-per-hour thresholds for the Low / Medium / High activity tag. */
export const DEFAULT_ACTIVITY_THRESHOLDS: ActivityThresholds = {
  mediumRunnersPerHour: 60,
  highRunnersPerHour: 150,
};

/** Standard percentile set requested for arrival-time distributions. */
export const DEFAULT_PERCENTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99];
