import { summarizeProfile, type ContestProfile } from './results';

/**
 * A race made directly from a contest in a results file.
 *
 * A results export routinely holds contests the map does not: a 5K Family run on the
 * same roads as the 5K, an elite wave, a relay. They have runners, they need a crew, and
 * building each one by hand — add a distance, rename it, retype three paces, set the
 * field size — is ten minutes of copying figures that are already on screen.
 *
 * The route is the part that cannot be invented. Every row is reconciled against the
 * courses the files describe and a row running nothing is dropped on the next pass, so a
 * contest becomes a race only where some route is plausibly the one it ran.
 */

/**
 * How far a contest's measured distance may sit from a route's before they are not the
 * same ground.
 *
 * Wider than the 8% used to decide whether two *files* describe one contest, because
 * these two numbers are measured by different means: the route by GPS along the line, the
 * contest by dividing recorded times by recorded paces. On real files that second figure
 * lands within a few percent, but it inherits every rounding in the pace column.
 */
export const ROUTE_TOLERANCE = 0.15;

export interface ContestRaceSeed {
  /** What the new row is called — the contest's own name, made unique if it collides. */
  courseName: string;
  /** The route it runs. Never blank: a row with no route does not survive reconciliation. */
  sourceCourseName: string;
  measuredKm: number;
  runnerCountText: string;
  /**
   * How long the field took to clear the start, measured from the file rather than
   * guessed. A contest that went off in waves says so here in its own recorded offsets,
   * which is the one figure a default of ten minutes is always wrong about.
   */
  startSpreadMinutes: number;
  fastestMinPerKm: number;
  typicalMinPerKm: number;
  slowestMinPerKm: number;
}

interface RouteChoice {
  name: string;
  totalKm: number;
}

/**
 * The route a contest most likely ran: nearest by length, within tolerance.
 *
 * Nearest and not merely first, because a card with a 5 km and a 10 km would otherwise
 * hand a 5K Family the 10 km course on the strength of it being listed sooner. Returns
 * null rather than the least-bad option — a race pinned to the wrong route reports a
 * field arriving at checkpoints it never passes, which is worse than being asked to
 * choose.
 */
export function routeForContest(
  distanceKm: number,
  routes: RouteChoice[]
): RouteChoice | null {
  if (!(distanceKm > 0) || routes.length === 0) return null;

  let best: RouteChoice | null = null;
  let bestGap = Infinity;
  for (const route of routes) {
    if (!(route.totalKm > 0)) continue;
    const gap = Math.abs(route.totalKm - distanceKm) / Math.max(route.totalKm, distanceKm);
    if (gap < bestGap) {
      bestGap = gap;
      best = route;
    }
  }
  return best !== null && bestGap <= ROUTE_TOLERANCE ? best : null;
}

/** A name no existing row is using, so a second "5K Family" cannot shadow the first. */
function uniqueName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Builds the race row for a contest, or null where no route fits it.
 *
 * The field size is the finishers rather than the entrants, because that is the field
 * the paces describe — a contest with 400 entered and 320 home is modelled from 320
 * runners, and using the larger number would put eighty people on the course who left no
 * trace of how fast they were.
 */
export function seedRaceFromContest(
  profile: ContestProfile,
  routes: RouteChoice[],
  takenNames: Iterable<string> = []
): ContestRaceSeed | null {
  const route = routeForContest(profile.distanceKm, routes);
  if (!route) return null;

  const summary = summarizeProfile(profile);
  if (!summary) return null;

  return {
    courseName: uniqueName(profile.contest, new Set(takenNames)),
    sourceCourseName: route.name,
    measuredKm: route.totalKm,
    runnerCountText: String(profile.finishers),
    // The 99th percentile rather than the maximum: one runner who crossed the mat an hour
    // late is a timing artefact, not the shape of the start.
    startSpreadMinutes: Math.max(0, Math.round(summary.startSpreadSeconds.p99 / 60)),
    fastestMinPerKm: Number(summary.pace.p1.toFixed(2)),
    typicalMinPerKm: Number(summary.pace.p50.toFixed(2)),
    slowestMinPerKm: Number(summary.pace.p99.toFixed(2)),
  };
}
