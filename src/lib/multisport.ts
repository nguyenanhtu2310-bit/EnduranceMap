import type { Course } from './snap';

/**
 * A multisport race is a sequence of legs rather than a single course. Everything in
 * this module describes that sequence and works out how it lines up with what was drawn
 * on the map; turning it into something the pipeline can schedule is `multisportInputs`.
 */

export type LegKind = 'swim' | 'bike' | 'run' | 'transition';

export type MultisportTemplateKey = 'triathlon' | 'duathlon' | 'aquathlon';

/**
 * Legs that run along a drawn route are described by pace, because a position on that
 * route is a distance. Transitions have no route at all, and a swim is timed rather than
 * staffed, so both are described by how long they take.
 */
export type LegBand =
  | { mode: 'pace'; fastestMinPerKm: number; typicalMinPerKm: number; slowestMinPerKm: number }
  | { mode: 'duration'; fastestMinutes: number; typicalMinutes: number; slowestMinutes: number };

export interface MultisportLeg {
  /** Stable across renaming and reordering, so edits and bindings survive both. */
  id: string;
  kind: LegKind;
  /** Shown to the operator: "Swim", "T1", "Bike", "Run 2". */
  label: string;
  /** Planned distance. Zero for transitions. Prefilled from the route when one is drawn. */
  distanceKm: number;
  /** The drawn LineString this leg follows. Bike and run always; swim only when drawn. */
  courseName?: string;
  /** Set once the operator picks a route by hand, so re-detection leaves it alone. */
  courseIsManual?: boolean;
  band: LegBand;
}

export interface MultisportRace {
  id: string;
  name: string;
  template: MultisportTemplateKey;
  /** Gun time for the whole race — the swim start. */
  startTimeClock: string;
  startSpreadMinutes: number;
  /** Kept as a string so the field can be cleared while typing, as elsewhere in the app. */
  runnerCountText: string;
  /** The organizer's finish cut-off, which governs the last leg only. */
  organizerCutoffClock?: string;
  legs: MultisportLeg[];
}

/** One map can carry several races — a 70.3 and a 140.6 sharing most of their route. */
export interface MultisportPlan {
  races: MultisportRace[];
}

export interface PlanProblem {
  raceId: string;
  legId?: string;
  message: string;
}

/** Legs a runner covers on foot or wheels, as opposed to the ones that are only timed. */
export function isRoutedLeg(kind: LegKind): boolean {
  return kind === 'bike' || kind === 'run';
}

/*
 * Templates are the shape of a race, not its size: the operator sets the distances. The
 * bands are a plausible mid-pack field so the form is usable before anything is typed,
 * and the finishing times they imply are deliberately unremarkable.
 */
const PACE = (fastest: number, typical: number, slowest: number): LegBand => ({
  mode: 'pace',
  fastestMinPerKm: fastest,
  typicalMinPerKm: typical,
  slowestMinPerKm: slowest,
});

const MINUTES = (fastest: number, typical: number, slowest: number): LegBand => ({
  mode: 'duration',
  fastestMinutes: fastest,
  typicalMinutes: typical,
  slowestMinutes: slowest,
});

interface TemplateLeg {
  kind: LegKind;
  label: string;
  distanceKm: number;
  band: LegBand;
}

export const MULTISPORT_TEMPLATES: Record<
  MultisportTemplateKey,
  { label: string; legs: TemplateLeg[] }
> = {
  triathlon: {
    label: 'Triathlon',
    legs: [
      { kind: 'swim', label: 'Swim', distanceKm: 1.9, band: MINUTES(28, 38, 55) },
      { kind: 'transition', label: 'T1', distanceKm: 0, band: MINUTES(3, 6, 12) },
      { kind: 'bike', label: 'Bike', distanceKm: 90, band: PACE(1.58, 2.0, 2.73) },
      { kind: 'transition', label: 'T2', distanceKm: 0, band: MINUTES(2, 4, 9) },
      { kind: 'run', label: 'Run', distanceKm: 21.1, band: PACE(4.1, 6.2, 9.4) },
    ],
  },
  duathlon: {
    label: 'Duathlon',
    legs: [
      { kind: 'run', label: 'Run 1', distanceKm: 10, band: PACE(4.0, 6.0, 9.0) },
      { kind: 'transition', label: 'T1', distanceKm: 0, band: MINUTES(1, 2, 5) },
      { kind: 'bike', label: 'Bike', distanceKm: 40, band: PACE(1.58, 2.0, 2.73) },
      { kind: 'transition', label: 'T2', distanceKm: 0, band: MINUTES(1, 2, 4) },
      { kind: 'run', label: 'Run 2', distanceKm: 5, band: PACE(4.2, 6.5, 9.8) },
    ],
  },
  aquathlon: {
    label: 'Aquathlon',
    legs: [
      { kind: 'swim', label: 'Swim', distanceKm: 1, band: MINUTES(15, 22, 33) },
      { kind: 'transition', label: 'T1', distanceKm: 0, band: MINUTES(2, 4, 8) },
      { kind: 'run', label: 'Run', distanceKm: 5, band: PACE(4.0, 6.0, 9.0) },
    ],
  },
};

export function instantiateTemplate(
  template: MultisportTemplateKey,
  raceId: string,
  name?: string
): MultisportRace {
  const spec = MULTISPORT_TEMPLATES[template];
  return {
    id: raceId,
    name: name?.trim() || spec.label,
    template,
    startTimeClock: '05:30',
    startSpreadMinutes: 20,
    runnerCountText: '500',
    legs: spec.legs.map((leg, i) => ({
      id: `${raceId}-leg-${i}`,
      kind: leg.kind,
      label: leg.label,
      distanceKm: leg.distanceKm,
      band: { ...leg.band },
    })),
  };
}

/* ---------------------------------------------------------------- detection ---- */

const SPORT_WORDS: { kind: Exclude<LegKind, 'transition'>; re: RegExp }[] = [
  { kind: 'swim', re: /\bswim(?:ming)?\b/i },
  { kind: 'bike', re: /\b(?:bike|biking|cycle|cycling|ride|velo|vélo)\b/i },
  { kind: 'run', re: /\brun(?:ning)?\b/i },
];

/** The sport a name announces, or undefined when it names none. */
function sportIn(text: string): Exclude<LegKind, 'transition'> | undefined {
  const lower = text.toLowerCase();
  // Order decides names that mention two sports — "Swim to run transition" is swim.
  // A compound like "swimrun" matches neither, since both words need their boundaries.
  for (const { kind, re } of SPORT_WORDS) if (re.test(lower)) return kind;
  return undefined;
}

export interface LegBinding {
  /** Which race the route belongs to, normalized so "(70.3)" and "(IM70.3)" agree. */
  raceKey: string;
  /** The race as the map writes it — "Olympic", "70.3" — for naming the race. */
  raceLabel: string;
  kind: Exclude<LegKind, 'transition'>;
  /** 1 or 2 when the name distinguishes a duathlon's two run legs. */
  ordinal?: number;
}

/**
 * Reads a drawn route's name as "this is the bike leg of the 70.3".
 *
 * Real maps write the sport first and the race in brackets — "Bike Course (IM70.3)" —
 * and are not consistent about the brackets: the same map had "(70.3)" on the swim. The
 * race key is therefore normalized rather than compared as written, so all three legs of
 * one race group together.
 */
export function detectLegBinding(courseName: string): LegBinding | null {
  const kind = sportIn(courseName);
  if (!kind) return null;

  const lower = courseName.toLowerCase();
  const ordinalMatch = lower.match(/\b(?:run|bike|swim)\s*([12])\b/) ?? lower.match(/\b(first|second)\b/);
  const ordinal = ordinalMatch
    ? ordinalMatch[1] === 'first'
      ? 1
      : ordinalMatch[1] === 'second'
        ? 2
        : Number(ordinalMatch[1])
    : undefined;

  const withoutSport = courseName
    .replace(SPORT_WORDS.find((s) => s.kind === kind)!.re, ' ')
    .replace(/\b(?:course|route|leg)\b/gi, ' ')
    // A bracketed distance describes THIS leg, not the race: "Swim Olympic (1,5km)" and
    // "Run Olympic (10km)" are two legs of one race, and keeping the brackets in the key
    // would file them as two races that never pair up. The unit is what distinguishes
    // them from a bracketed race name — "(70.3)" is which race, "(750m)" is how far.
    .replace(/\(\s*\d+[.,]?\d*\s*(?:km|m|mi|miles?|k)\s*\)/gi, ' ')
    .replace(/\bironman\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const raceKey = withoutSport
    .toLowerCase()
    // "IM70.3" is the brand plus the distance; the brand is noise for grouping.
    .replace(/\bim(?=[\s\d.])/g, ' ')
    .replace(/\b[12]\b/g, ' ')
    .replace(/[^a-z0-9.]/g, '');

  return { raceKey, raceLabel: withoutSport.replace(/^[-–—\s]+|[-–—\s]+$/g, ''), kind, ordinal };
}

/**
 * The leg a point belongs to, read from the start of its name.
 *
 * Around transition the bike and run routes run side by side — on a real 70.3 map a run
 * turnaround sat one metre from the run line and one metre from the bike line — so the
 * geometry cannot decide and the name has to. Only the leading word counts: a mention of
 * a sport further into a name is usually describing where something is, not what it is
 * part of.
 */
export function detectPlacemarkLeg(name: string): Exclude<LegKind, 'transition'> | undefined {
  const leading = name.trim().toLowerCase().replace(/^[^a-z]+/, '');
  for (const { kind, re } of SPORT_WORDS) {
    const m = leading.match(re);
    if (m && m.index === 0) return kind;
  }
  return undefined;
}

/**
 * Fills in each leg's route from what the map actually contains.
 *
 * Bindings the operator set by hand are left alone as long as the route still exists;
 * ones pointing at a route that has gone are cleared rather than left dangling, since a
 * leg bound to nothing is a visible problem and a leg bound to a missing name is not.
 */
export function autoBindCourses(plan: MultisportPlan, courses: Course[]): MultisportPlan {
  const known = new Set(courses.map((c) => c.name));
  const detected = courses
    .map((course) => ({ course, binding: detectLegBinding(course.name) }))
    .filter((d): d is { course: Course; binding: LegBinding } => d.binding !== null);

  return {
    races: plan.races.map((race) => {
      const claimed = new Set<string>();
      for (const leg of race.legs) {
        if (leg.courseIsManual && leg.courseName && known.has(leg.courseName)) claimed.add(leg.courseName);
      }

      // Race keys are matched loosely: one plan usually describes one race, and forcing
      // the operator's race name to match the map's bracketed key would bind nothing.
      const legs = race.legs.map((leg, index) => {
        if (leg.kind === 'transition') return leg.courseName ? { ...leg, courseName: undefined } : leg;
        if (leg.courseIsManual && leg.courseName && known.has(leg.courseName)) return leg;

        const ordinal = ordinalOf(race, index);
        const match =
          detected.find(
            (d) => d.binding.kind === leg.kind && d.binding.ordinal === ordinal && !claimed.has(d.course.name)
          ) ??
          detected.find((d) => d.binding.kind === leg.kind && !claimed.has(d.course.name)) ??
          // A duathlon usually draws its one run loop once and runs it twice, so falling
          // back to an already-claimed route of the same sport binds the second lap.
          detected.find((d) => d.binding.kind === leg.kind);

        if (!match) {
          return leg.courseName && !known.has(leg.courseName) ? { ...leg, courseName: undefined } : leg;
        }

        claimed.add(match.course.name);
        return {
          ...leg,
          courseName: match.course.name,
          // A drawn route measures the distance better than anyone types it.
          distanceKm: Number(match.course.totalKm.toFixed(2)),
        };
      });

      return { ...race, legs };
    }),
  };
}

/** Which of a race's same-sport legs this one is, 1-based, or undefined when it is the only one. */
function ordinalOf(race: MultisportRace, index: number): number | undefined {
  const kind = race.legs[index].kind;
  const sameKind = race.legs.map((l, i) => ({ l, i })).filter((e) => e.l.kind === kind);
  if (sameKind.length < 2) return undefined;
  return sameKind.findIndex((e) => e.i === index) + 1;
}

/* --------------------------------------------------------------- validation ---- */

const CLOCK_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Everything that would make a plan produce a schedule nobody should trust. Returned as
 * a list rather than a boolean so the form can say which leg is wrong.
 */
export function validatePlan(plan: MultisportPlan, courses: Course[]): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const known = new Set(courses.map((c) => c.name));
  const boundBy = new Map<string, { label: string; kind: LegKind }>();

  if (plan.races.length === 0) {
    return [{ raceId: '', message: 'Add a race before calculating.' }];
  }

  for (const race of plan.races) {
    const where = race.name || 'This race';

    if (!CLOCK_RE.test(race.startTimeClock.trim())) {
      problems.push({ raceId: race.id, message: `${where}: start time must be HH:MM.` });
    }

    const runners = Number(race.runnerCountText);
    if (!Number.isFinite(runners) || runners <= 0) {
      problems.push({ raceId: race.id, message: `${where}: enter how many athletes start.` });
    }

    if (race.organizerCutoffClock?.trim() && !CLOCK_RE.test(race.organizerCutoffClock.trim())) {
      problems.push({ raceId: race.id, message: `${where}: finish cut-off must be HH:MM.` });
    }

    for (const leg of race.legs) {
      const label = `${where} — ${leg.label}`;

      if (leg.kind !== 'transition' && !(leg.distanceKm > 0)) {
        problems.push({ raceId: race.id, legId: leg.id, message: `${label}: distance must be above zero.` });
      }

      if (isRoutedLeg(leg.kind)) {
        if (!leg.courseName) {
          problems.push({ raceId: race.id, legId: leg.id, message: `${label}: choose the route it follows.` });
        } else if (!known.has(leg.courseName)) {
          problems.push({
            raceId: race.id,
            legId: leg.id,
            message: `${label}: "${leg.courseName}" is not on this map.`,
          });
        } else {
          // A duathlon runs the same loop twice, so two legs sharing a route is normal
          // as long as they are the same sport — each still gets its own crossings. Two
          // different sports on one line is a mis-binding.
          const already = boundBy.get(leg.courseName);
          if (already && already.kind !== leg.kind) {
            problems.push({
              raceId: race.id,
              legId: leg.id,
              message: `${label}: "${leg.courseName}" is already the ${already.label} route.`,
            });
          } else if (!already) {
            boundBy.set(leg.courseName, { label, kind: leg.kind });
          }
        }
      }

      const b = leg.band;
      const [fastest, typical, slowest] =
        b.mode === 'pace'
          ? [b.fastestMinPerKm, b.typicalMinPerKm, b.slowestMinPerKm]
          : [b.fastestMinutes, b.typicalMinutes, b.slowestMinutes];

      if (![fastest, typical, slowest].every((v) => Number.isFinite(v) && v > 0)) {
        problems.push({ raceId: race.id, legId: leg.id, message: `${label}: times must be above zero.` });
      } else if (!(fastest <= typical && typical <= slowest)) {
        problems.push({
          raceId: race.id,
          legId: leg.id,
          message: `${label}: fastest, typical and slowest must be in order.`,
        });
      }
    }
  }

  return problems;
}

/**
 * Skip fragments that name the race being planned.
 *
 * A festival map carries a sprint and a kids race alongside the 70.3, so seeding those
 * into the skip list is right — until the sprint IS the race being planned, at which
 * point the same seed quietly deletes its checkpoints. Matching is on the fragment
 * appearing in the race name, the same way the skip itself matches placemark names.
 */
export function skipsNamingOwnRace(skipNames: string, plan: MultisportPlan | null): string[] {
  const fragments = skipNames
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const names = (plan?.races ?? []).map((r) => r.name.toLowerCase());
  return fragments.filter((fragment) => names.some((name) => name.includes(fragment)));
}

/** Routes on the map that no leg claims — usually another event sharing the file. */
export function unboundCourses(plan: MultisportPlan, courses: Course[]): string[] {
  const bound = new Set(
    plan.races.flatMap((r) => r.legs.map((l) => l.courseName).filter((n): n is string => !!n))
  );
  return courses.map((c) => c.name).filter((name) => !bound.has(name));
}

/**
 * Builds a plan from what the map holds, one race per race the map describes.
 *
 * A map is usually a whole event, not one race: an aquathlon morning draws an Olympic,
 * a Sprint, a Junior and a Kids course side by side. Creating a single race and leaving
 * the operator to add three more by hand — rebinding each one — is the wrong default.
 *
 * Where the routes name no sport at all, each is treated as its own race, which is the
 * case that matters most: a map holding only run courses is not proof the event has no
 * swim, it is proof nobody drew the swim.
 */
export function planFromCourses(
  template: MultisportTemplateKey,
  courses: Course[]
): MultisportPlan {
  const detected = courses
    .map((course) => ({ course, binding: detectLegBinding(course.name) }))
    .filter((d): d is { course: Course; binding: LegBinding } => d.binding !== null);

  if (detected.length > 0) {
    const keys: string[] = [];
    for (const { binding } of detected) if (!keys.includes(binding.raceKey)) keys.push(binding.raceKey);

    return {
      races: keys.map((key, i) => {
        const mine = detected.filter((d) => d.binding.raceKey === key);
        const label = mine.find((d) => d.binding.raceLabel)?.binding.raceLabel;
        const race = instantiateTemplate(template, `ms-${i + 1}`, label);
        return autoBindCourses({ races: [race] }, mine.map((d) => d.course)).races[0];
      }),
    };
  }

  // Nothing names a sport. One routed leg means each course is a race of its own — four
  // run courses are four aquathlons — while two routed legs cannot be split that way.
  const routed = MULTISPORT_TEMPLATES[template].legs.filter((l) => isRoutedLeg(l.kind));
  if (courses.length > 1 && routed.length === 1) {
    return {
      races: courses.map((course, i) => {
        const race = instantiateTemplate(template, `ms-${i + 1}`, course.name);
        // Bound here rather than by detection, which has no sport word to work from.
        return {
          ...race,
          legs: race.legs.map((leg) =>
            isRoutedLeg(leg.kind)
              ? { ...leg, courseName: course.name, distanceKm: Number(course.totalKm.toFixed(2)) }
              : leg
          ),
        };
      }),
    };
  }

  return autoBindCourses({ races: [instantiateTemplate(template, 'ms-1')] }, courses);
}
