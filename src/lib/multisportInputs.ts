import { modelPacePercentiles, DEFAULT_START_SPREAD_MINUTES, type PaceBand } from './paceModel';
import type { DistanceInput } from './pipeline';
import type { RunnerSample } from './results';
import type { Course } from './snap';
import { isRoutedLeg, type LegKind, type MultisportLeg, type MultisportPlan, type MultisportRace } from './multisport';
import type { MultisportAthleteSample, MultisportProfile } from './multisportResults';

export type { MultisportAthleteSample, MultisportProfile };

/**
 * Turns a multisport plan into the per-leg inputs the pipeline already understands.
 *
 * The whole design rests on one property of `projectSampleArrivals`: an athlete's
 * arrival is `start + their own offset + their own pace × km`, and nothing inspects that
 * offset. Everything an athlete did before a leg — swim, T1, bike, T2 — is just time
 * spent before they reached its first metre, so it folds into the offset and the leg
 * becomes an ordinary distance with an unusually late start. No arrival maths changes.
 */

export interface BuildLegInputsOptions {
  courses: Course[];
  /** Race id to the reference field driving it. Absent for a race planned from bands. */
  profileByRaceId?: Map<string, MultisportProfile>;
  /** Synthetic athletes generated per race when no reference field is mapped. */
  bandSampleSize?: number;
}

/**
 * The course name a leg is scheduled under.
 *
 * Legs get their own names rather than reusing the drawn route's, so a duathlon's two
 * laps of one loop stay separate, and so the schedule reads "IRONMAN 70.3 — Bike"
 * instead of whatever the map happened to call the line.
 */
export function legCourseName(race: MultisportRace, leg: MultisportLeg): string {
  return `${race.name} — ${leg.label}`;
}

/** How far a leg actually covers: the drawn route when there is one, else what was typed. */
function traversedKm(leg: MultisportLeg, courseByName: Map<string, Course>): number {
  if (isRoutedLeg(leg.kind) && leg.courseName) {
    const course = courseByName.get(leg.courseName);
    if (course && course.totalKm > 0) return course.totalKm;
  }
  return leg.distanceKm;
}

/**
 * Reads a duration band through the same log-space percentile curve as a pace band.
 *
 * A swim and a transition are described in minutes rather than minutes per kilometre,
 * but the shape of the distribution is the same — a long tail of slower athletes — so
 * the curve is reused rather than reimplemented. The units are minutes throughout.
 */
function durationBandAsPace(leg: MultisportLeg): PaceBand {
  const b = leg.band;
  return b.mode === 'pace'
    ? { fastestMinPerKm: b.fastestMinPerKm, typicalMinPerKm: b.typicalMinPerKm, slowestMinPerKm: b.slowestMinPerKm }
    : { fastestMinPerKm: b.fastestMinutes, typicalMinPerKm: b.typicalMinutes, slowestMinPerKm: b.slowestMinutes };
}

/**
 * Invents a field from the race's pace bands, in the same shape a results file produces.
 *
 * This exists because the band path has no per-athlete start offset — it only spreads
 * the field across the corral by percentile — so a run leg could never be made to start
 * six hours after the gun. Generating athletes instead lets every multisport race take
 * the samples path, which does carry an offset. With nothing in front of it a leg comes
 * out exactly as the band model would have produced on its own.
 */
export function synthesizeAthletesFromBands(
  race: MultisportRace,
  courseByName: Map<string, Course>,
  sampleSize: number
): MultisportAthleteSample[] {
  const spreadMinutes = race.startSpreadMinutes ?? DEFAULT_START_SPREAD_MINUTES;
  const quantiles = Array.from({ length: sampleSize }, (_, i) => ((i + 0.5) / sampleSize) * 100);

  const perLeg = race.legs.map((leg) => {
    const km = traversedKm(leg, courseByName);
    const modelled = modelPacePercentiles(durationBandAsPace(leg), quantiles);
    return modelled.map(({ paceMinPerKm }) =>
      leg.band.mode === 'pace' ? paceMinPerKm * km * 60 : paceMinPerKm * 60
    );
  });

  return quantiles.map((percentile, i) => ({
    raceOffsetSeconds: (Math.min(100, Math.max(0, percentile)) / 100) * spreadMinutes * 60,
    legSeconds: perLeg.map((durations) => durations[i]),
  }));
}

/**
 * Rescales a reference field's leg durations onto the race being planned.
 *
 * A 70.3's bike split does not transfer to an 80 km course unchanged, so each leg is
 * scaled by how much further or shorter it now is. Transitions do not scale — racking a
 * bike takes as long whatever the course measures.
 */
function scaledDurations(
  athlete: MultisportAthleteSample,
  race: MultisportRace,
  profile: MultisportProfile,
  courseByName: Map<string, Course>
): number[] {
  return race.legs.map((leg, j) => {
    const seconds = athlete.legSeconds[j] ?? 0;
    if (leg.kind === 'transition') return seconds;
    const sourceKm = profile.legs[j]?.distanceKm ?? 0;
    if (!(sourceKm > 0)) return seconds;
    return seconds * (traversedKm(leg, courseByName) / sourceKm);
  });
}

/** Whether a reference field describes the same sequence of sports as the race. */
function profileFits(race: MultisportRace, profile: MultisportProfile): boolean {
  return (
    profile.legs.length === race.legs.length &&
    profile.legs.every((leg, i) => leg.kind === race.legs[i].kind)
  );
}

export function buildLegDistanceInputs(
  plan: MultisportPlan,
  options: BuildLegInputsOptions
): { inputs: DistanceInput[]; warnings: string[] } {
  const courseByName = new Map(options.courses.map((c) => [c.name, c]));
  const sampleSize = options.bandSampleSize ?? 200;
  const inputs: DistanceInput[] = [];
  const warnings: string[] = [];

  for (const race of plan.races) {
    const profile = options.profileByRaceId?.get(race.id);
    const usable = profile && profileFits(race, profile) && profile.athletes.length > 0;

    if (profile && !usable) {
      warnings.push(
        `"${profile.label}" does not match the legs of ${race.name}, so its pace band is used instead.`
      );
    }

    const athletes = usable
      ? profile!.athletes
      : synthesizeAthletesFromBands(race, courseByName, sampleSize);

    // Each athlete's leg durations for THIS race, in this race's own leg order.
    const durations = athletes.map((athlete) =>
      usable ? scaledDurations(athlete, race, profile!, courseByName) : athlete.legSeconds
    );

    const lastRoutedIndex = race.legs.reduce(
      (last, leg, i) => (isRoutedLeg(leg.kind) && leg.courseName ? i : last),
      -1
    );

    race.legs.forEach((leg, k) => {
      if (!isRoutedLeg(leg.kind) || !leg.courseName) return;
      if (!courseByName.has(leg.courseName)) {
        warnings.push(`${race.name} — ${leg.label}: "${leg.courseName}" is not on this map.`);
        return;
      }

      const km = traversedKm(leg, courseByName);
      if (!(km > 0)) return;

      const samples: RunnerSample[] = athletes.map((athlete, i) => {
        const own = durations[i];
        let before = athlete.raceOffsetSeconds;
        for (let j = 0; j < k; j++) before += own[j] ?? 0;
        return { startOffsetSeconds: before, paceMinPerKm: own[k] / 60 / km };
      });

      const band = durationBandAsPace(leg);
      inputs.push({
        courseName: legCourseName(race, leg),
        sourceCourseName: leg.courseName,
        legIndex: k,
        startTimeClock: race.startTimeClock,
        startSpreadMinutes: race.startSpreadMinutes,
        runnerCount: Number(race.runnerCountText),
        fastestMinPerKm: band.fastestMinPerKm,
        typicalMinPerKm: band.typicalMinPerKm,
        slowestMinPerKm: band.slowestMinPerKm,
        // Only the last leg ends at the finish line, so only it carries the finish cut-off.
        organizerCutoffClock: k === lastRoutedIndex ? race.organizerCutoffClock?.trim() || undefined : undefined,
        samples,
      });
    });
  }

  return { inputs, warnings };
}

/**
 * The routes each leg of each race is allowed to sit on, for `restrictCoursesFor`.
 *
 * Returns undefined for a name that announces no sport, leaving the geometry to decide.
 */
export function buildCourseRestriction(
  plan: MultisportPlan,
  legOf: (placemarkName: string) => Exclude<LegKind, 'transition'> | undefined
): (placemarkName: string) => string[] | undefined {
  const byKind = new Map<LegKind, string[]>();
  for (const race of plan.races) {
    for (const leg of race.legs) {
      if (!isRoutedLeg(leg.kind) || !leg.courseName) continue;
      const list = byKind.get(leg.kind) ?? [];
      list.push(legCourseName(race, leg));
      byKind.set(leg.kind, list);
    }
  }

  return (placemarkName: string) => {
    const kind = legOf(placemarkName);
    if (!kind) return undefined;
    // A point that names a sport this race does not schedule belongs nowhere, rather
    // than falling back to whichever route happens to run nearest it.
    return byKind.get(kind) ?? [];
  };
}

/**
 * Pairs each race in a multisport file with the race in the plan it is closest to in
 * total distance.
 *
 * Matching by size order rather than by size would hand a lone 70.3 the full-distance
 * field whenever the file happened to hold both — doubling every leg time. A file
 * often carries races the plan does not, so anything that is not a near match is left
 * for the operator rather than guessed at.
 */
export function autoMapMultisport(
  profiles: MultisportProfile[],
  plan: MultisportPlan | null
): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!plan) return mapping;

  const totalOf = (legs: { distanceKm: number }[]) => legs.reduce((sum, l) => sum + l.distanceKm, 0);
  const taken = new Set<string>();

  for (const race of plan.races) {
    const target = totalOf(race.legs);
    if (!(target > 0)) continue;

    let best: MultisportProfile | undefined;
    let bestDelta = Infinity;
    for (const profile of profiles) {
      if (taken.has(profile.key)) continue;
      const delta = Math.abs(totalOf(profile.legs) - target);
      if (delta < bestDelta) {
        best = profile;
        bestDelta = delta;
      }
    }

    // A quarter is loose enough for a course that measures differently from its name,
    // and tight enough never to pair a half distance with a full one.
    if (best && bestDelta <= target * 0.25) {
      mapping[best.key] = race.id;
      taken.add(best.key);
    }
  }
  return mapping;
}
