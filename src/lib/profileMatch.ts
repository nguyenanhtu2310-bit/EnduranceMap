/**
 * Which elevation profile belongs to which course.
 *
 * Sounds like a lookup and is not. Profiles are keyed by the name written inside the GPX
 * track, and courses are keyed by whatever the plan calls them, and the two agree only by
 * habit. Three ways they come apart, all seen on real files:
 *
 *   - a distance renamed in the race card — "21km Day 1" running the "21km" route, which
 *     is the whole point of being able to rename one;
 *   - a track named "VMM25_50K_FINAL_v3" for a course the map calls "50km";
 *   - the same name spelled differently on either side — "100 Miles" and "100miles".
 *
 * When it fails it fails quietly and asymmetrically: the file list still shows the route,
 * because it reads the profiles directly, while every view that goes through a course
 * name simply omits it. A six-distance race offers three, and nothing says why.
 */

/** Case, spacing and punctuation are not part of a name for matching purposes. */
function flatten(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ProfileMatchOptions {
  /**
   * The route a course actually runs, where it has been renamed away from it. Keyed by
   * the course's own name.
   */
  routeOf?: Map<string, string>;
}

/**
 * Pairs each course with its profile, by name and then by every near-miss worth trying.
 *
 * Returns a map keyed by *course* name, so callers that already look profiles up that way
 * need no other change. Exact names win; a renamed distance falls back to the route it
 * runs; failing both, names are compared with their spacing and punctuation removed.
 * Nothing is matched on length or position — two courses of the same distance are a
 * normal thing for a race to have, and guessing between them would be worse than a gap.
 */
export function matchProfiles<T>(
  courseNames: string[],
  profiles: Map<string, T>,
  options: ProfileMatchOptions = {}
): Map<string, T> {
  const flattened = new Map<string, T>();
  // First writer wins, so an exact duplicate under a different spelling cannot displace
  // the profile a course already matched cleanly.
  for (const [name, profile] of profiles) {
    const key = flatten(name);
    if (!flattened.has(key)) flattened.set(key, profile);
  }

  const out = new Map<string, T>();
  for (const courseName of courseNames) {
    const route = options.routeOf?.get(courseName);
    const hit =
      profiles.get(courseName) ??
      (route ? profiles.get(route) : undefined) ??
      flattened.get(flatten(courseName)) ??
      (route ? flattened.get(flatten(route)) : undefined);
    if (hit !== undefined) out.set(courseName, hit);
  }
  return out;
}

/**
 * Courses left without a profile, so the gap can be reported rather than just shown.
 *
 * A course with no elevation is a legitimate state — the operator may simply not have
 * dropped that route file — and it is also what a failed match looks like. The two are
 * told apart by whether any profiles were loaded at all, which is the caller's to judge;
 * this just names who is missing.
 */
export function coursesWithoutProfile<T>(
  courseNames: string[],
  matched: Map<string, T>
): string[] {
  return courseNames.filter((name) => !matched.has(name));
}
