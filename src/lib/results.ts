import { findColumn, parseCsv } from './csv';
import {
  PACE_COLUMN_NAMES,
  measureFromCandidates,
  tidyKm,
  type DistanceSource,
} from './distances';

/**
 * One finisher, reduced to the two things that decide when they reach a checkpoint:
 * how long after the gun they crossed the start, and how fast they then ran.
 */
export interface RunnerSample {
  startOffsetSeconds: number;
  /**
   * Their finishing time. Kept alongside the pace because pace is a derived figure that
   * depends on a distance the file does not always state: a contest whose distance the
   * operator has to type in has no pace until they do, and re-deriving from the time is
   * both possible and exact, where rescaling an existing pace compounds its rounding
   * every time the distance is corrected.
   */
  finishSeconds: number;
  /** Zero until the contest's distance is known. */
  paceMinPerKm: number;
}

export type Sex = 'M' | 'F';

/**
 * The winner of a sex within a contest, kept as a modelling input rather than a result:
 * their own start offset and pace, so the point they reach any kilometre can be worked
 * out the same way every other arrival is. Deliberately nameless — the schedule needs
 * when the lead athlete arrives, not who they were.
 */
export interface LeadAthlete {
  sex: Sex;
  startOffsetSeconds: number;
  paceMinPerKm: number;
  /** Their finishing time, so the marker can say what effort it represents. */
  finishSeconds: number;
}

/**
 * No human runs a kilometre this fast over a race distance — the road 10 km record is
 * about 2.64 min/km. A leader below it is a mistimed chip or an athlete recorded against
 * the wrong contest, and unlike a stray value in the bulk of the field it would be shown
 * on its own as the moment to have the tape up. The next fastest is used instead.
 */
export const FASTEST_CREDIBLE_MIN_PER_KM = 2.5;

/** Column headers timing systems use for the athlete's sex. */
export const SEX_COLUMN_NAMES = ['Gender', 'Sex', 'GenderMF', 'M/F', 'Div', 'Division'];

/**
 * Reads the sex from whatever the export calls it. Division codes are accepted because
 * an Ironman export often has no plain gender column but does have "F30-34" — the sex
 * is the first character, and the age band is none of the schedule's business.
 */
export function normalizeSex(value: string): Sex | null {
  const text = value.trim().toUpperCase();
  if (!text) return null;
  if (/^(M|MALE|MEN|MAN|BOY|BOYS)$/.test(text)) return 'M';
  if (/^(F|W|FEMALE|WOMEN|WOMAN|GIRL|GIRLS)$/.test(text)) return 'F';
  const division = text.match(/^([MF])\s*\d/);
  return division ? (division[1] as Sex) : null;
}

export interface ContestProfile {
  contest: string;
  /**
   * How far this contest actually was. Measured from the file's own pace column where it
   * has one, because the name is not evidence — a trail race sold as "Ultra 70km"
   * measured 66.02 km and its "5KM" measured 5.58.
   */
  distanceKm: number;
  /** Where that distance came from, so the operator can judge whether to trust it. */
  distanceSource: DistanceSource;
  /** One line explaining the source, shown beside the contest. */
  distanceNote: string;
  entrants: number;
  finishers: number;
  /** Finishers whose start time was also recorded, so their offset is real. */
  withStartTime: number;
  samples: RunnerSample[];
  /**
   * The fastest man and fastest woman, where the file says who is which. Empty when the
   * export carries no gender column — the field is still modelled, only the lead
   * markers are missing.
   */
  leaders: LeadAthlete[];
  warnings: string[];
}

export interface ResultsParseResult {
  profiles: ContestProfile[];
  warnings: string[];
}

/** Statuses that mean the runner did not produce a usable finish. */
export const EXCLUDED_STATUSES = new Set(['dns', 'dnf', 'dsq', 'ooc']);

/**
 * Official distances for the contest names timing exports normally use. Anything
 * unrecognised is reported so the operator can set the distance themselves rather than
 * having a number invented for them.
 */
const KNOWN_DISTANCES: { pattern: RegExp; km: number }[] = [
  { pattern: /^(full\s*)?marathon$|^42/i, km: 42.195 },
  { pattern: /^half(\s*marathon)?$|^21/i, km: 21.0975 },
  { pattern: /^(\d+(?:\.\d+)?)\s*k(m)?$/i, km: NaN }, // resolved from the captured number
];

export function inferContestDistanceKm(contest: string): number | undefined {
  const name = contest.trim();

  const km = name.match(/^(\d+(?:\.\d+)?)\s*k(m)?$/i);
  if (km) return parseFloat(km[1]);

  for (const { pattern, km: value } of KNOWN_DISTANCES) {
    if (Number.isFinite(value) && pattern.test(name)) return value;
  }

  const embedded = name.match(/(\d+(?:\.\d+)?)\s*k(m)?\b/i);
  return embedded ? parseFloat(embedded[1]) : undefined;
}

/**
 * Parses an elapsed duration such as "2:25:44" or "10:15" into seconds. Unlike a clock
 * time this has no 24-hour ceiling — an ultra finisher legitimately runs past it.
 */
export function parseElapsedToSeconds(value: string): number | null {
  const text = value.trim();
  // Some timing systems write the seconds to hundredths ("2:31:30.52"). The fraction is
  // below the resolution of anything scheduled from it, so it is dropped — the way the
  // official time is taken — rather than treated as a malformed time. Rejecting it lost
  // every finisher in the file, leaving the contest with no field at all.
  if (!/^\d{1,3}(:\d{1,2}){1,2}([.,]\d+)?$/.test(text)) return null;

  const parts = text.replace(/[.,]\d+$/, '').split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return null;

  // "H:MM:SS" or "MM:SS".
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

/** Parses a time-of-day column into seconds since midnight. */
function parseTodSeconds(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

export interface ResultsParseOptions {
  /** Override the distance inferred from a contest name. */
  distanceOverrides?: Record<string, number>;
}

/**
 * Turns a finish-line results export into a per-contest profile of real runners.
 *
 * Pace comes from chip time where available (gun time otherwise), measured over the
 * contest's own distance. Start offsets are taken relative to the first starter in that
 * contest, so the observed corral spread carries over to a future race with a different
 * gun time.
 */
/**
 * How far a contest was, best evidence first.
 *
 * Measuring beats naming because names are wrong in a systematic direction: a race is
 * sold on a round number, so "Ultra 70km" is 66 km and "5KM" is 5.58. Where the file
 * states a pace the distance is arithmetic; where it does not, the name is all there is
 * and the operator is told so rather than left to assume the number was checked.
 */
function resolveContestDistance(
  contest: string,
  rows: Record<string, string>[],
  columns: { paceCol?: string; chipCol?: string; gunCol?: string; override?: number }
): { km: number | undefined; source: DistanceSource; note: string } {
  const { paceCol, chipCol, gunCol, override } = columns;

  if (override && override > 0) {
    return { km: override, source: 'operator', note: '' };
  }

  if (paceCol) {
    const candidates = [
      { label: 'chip time', column: chipCol },
      { label: 'gun time', column: gunCol },
    ]
      .filter((c): c is { label: string; column: string } => !!c.column)
      .map((c) => ({
        label: c.label,
        pairs: rows.map((row) => ({
          seconds: parseElapsedToSeconds(row[c.column] ?? '') ?? 0,
          rate: row[paceCol],
        })),
      }));

    const best = measureFromCandidates(candidates);
    if (best?.measurement.consistent) {
      const km = tidyKm(best.measurement.km);
      const named = inferContestDistanceKm(contest);
      // Worth saying out loud when the name and the ground disagree, since the schedule
      // will not match the number on the race entry page.
      const disagrees = named && Math.abs(named - km) / km > 0.02;
      return {
        km,
        source: 'measured',
        note: disagrees
          ? `"${contest}" measures ${km} km from its own pace column, not the ${named} km its name suggests.`
          : '',
      };
    }
    if (best && !best.measurement.consistent) {
      return {
        km: inferContestDistanceKm(contest),
        source: 'name',
        note:
          `"${contest}" holds more than one distance — its athletes' paces imply anywhere from ` +
          `${tidyKm(best.measurement.km * (1 - best.measurement.spread / 2))} to ` +
          `${tidyKm(best.measurement.km * (1 + best.measurement.spread / 2))} km. ` +
          `Split it by category, or set the distance by hand.`,
      };
    }
  }

  const named = inferContestDistanceKm(contest);
  if (named && named > 0) {
    return {
      km: named,
      source: 'name',
      note: `"${contest}" has no pace column, so its distance is read from its name — check it.`,
    };
  }

  return { km: undefined, source: 'unknown', note: '' };
}

export function parseResultsCsv(text: string, options: ResultsParseOptions = {}): ResultsParseResult {
  const rows = parseCsv(text);
  const warnings: string[] = [];

  if (rows.length === 0) return { profiles: [], warnings: ['The results file has no rows.'] };

  const headers = Object.keys(rows[0]);
  const contestCol = findColumn(headers, 'Contest', 'Race', 'Event', 'Category', 'Distance');
  const statusCol = findColumn(headers, 'Status');
  const startCol = findColumn(headers, 'startTOD', 'StartTOD', 'Start');
  const chipCol = findColumn(headers, 'ChipTime', 'Chip', 'NetTime', 'Net');
  const gunCol = findColumn(headers, 'GunTime', 'Gun', 'Time');
  const finishCol = findColumn(headers, 'finishTOD', 'FinishTOD', 'Finish');
  const sexCol = findColumn(headers, ...SEX_COLUMN_NAMES);

  if (!contestCol) {
    return {
      profiles: [],
      warnings: [
        `No contest column found. Expected one of Contest / Race / Event / Category, but the file has: ${headers.join(', ')}.`,
      ],
    };
  }
  if (!chipCol && !gunCol && !(startCol && finishCol)) {
    return {
      profiles: [],
      warnings: [
        'No finishing time found. Expected a ChipTime or GunTime column, or both startTOD and finishTOD.',
      ],
    };
  }
  if (!chipCol && gunCol) {
    warnings.push('No chip time in this file — gun time used instead, which runs slightly long for later starters.');
  }

  const byContest = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const contest = (row[contestCol] ?? '').trim();
    if (!contest) continue;
    if (!byContest.has(contest)) byContest.set(contest, []);
    byContest.get(contest)!.push(row);
  }

  const profiles: ContestProfile[] = [];

  const paceCol = findColumn(headers, ...PACE_COLUMN_NAMES);

  for (const [contest, contestRows] of byContest) {
    const profileWarnings: string[] = [];
    const resolved = resolveContestDistance(contest, contestRows, {
      paceCol,
      chipCol,
      gunCol,
      override: options.distanceOverrides?.[contest],
    });
    const distanceKm = resolved.km;

    if (resolved.note) profileWarnings.push(resolved.note);
    if (!distanceKm || distanceKm <= 0) {
      profileWarnings.push(
        `Could not work out how far "${contest}" was — set the distance before using this contest.`
      );
    }

    // Start offsets are relative to the first starter of this contest.
    const startTimes = contestRows
      .map((r) => (startCol ? parseTodSeconds(r[startCol] ?? '') : null))
      .filter((s): s is number => s !== null);
    const firstStart = startTimes.length > 0 ? Math.min(...startTimes) : null;

    const samples: RunnerSample[] = [];
    const leaders = new Map<Sex, LeadAthlete>();
    let implausibleLeaders = 0;
    let finishers = 0;
    let withStartTime = 0;

    for (const row of contestRows) {
      const status = (statusCol ? row[statusCol] ?? '' : '').trim().toLowerCase();
      if (EXCLUDED_STATUSES.has(status)) continue;

      let elapsed = chipCol ? parseElapsedToSeconds(row[chipCol] ?? '') : null;
      if (elapsed === null && gunCol) elapsed = parseElapsedToSeconds(row[gunCol] ?? '');

      if (elapsed === null && startCol && finishCol) {
        const s = parseTodSeconds(row[startCol] ?? '');
        const f = parseTodSeconds(row[finishCol] ?? '');
        if (s !== null && f !== null) elapsed = f >= s ? f - s : f + 86400 - s;
      }

      if (elapsed === null || elapsed <= 0) continue;
      finishers += 1;

      const ownStart = startCol ? parseTodSeconds(row[startCol] ?? '') : null;
      const startOffsetSeconds = ownStart !== null && firstStart !== null ? ownStart - firstStart : 0;
      if (ownStart !== null) withStartTime += 1;

      // Kept even when the file never said how far this contest was. The field is real
      // whether or not its distance is known, and holding the times means typing the
      // distance in afterwards is enough to model it — which is the entire purpose of
      // the box the operator is offered.
      const known = (distanceKm ?? 0) > 0;
      const paceMinPerKm = known ? elapsed / 60 / (distanceKm as number) : 0;
      samples.push({ startOffsetSeconds, finishSeconds: elapsed, paceMinPerKm });

      // The winner of each sex, by finishing time. Their own offset and pace are kept so
      // the marker moves down the course the way that athlete actually did.
      const sex = sexCol ? normalizeSex(row[sexCol] ?? '') : null;
      if (sex && elapsed < (leaders.get(sex)?.finishSeconds ?? Infinity)) {
        if (known && paceMinPerKm < FASTEST_CREDIBLE_MIN_PER_KM) implausibleLeaders += 1;
        else leaders.set(sex, { sex, startOffsetSeconds, paceMinPerKm, finishSeconds: elapsed });
      }
    }

    if (implausibleLeaders > 0) {
      profileWarnings.push(
        `${implausibleLeaders} finisher(s) in "${contest}" are timed faster than any human runs — they are left out of the First Male / Female markers.`
      );
    }

    if (samples.length > 0 && withStartTime < samples.length) {
      profileWarnings.push(
        `${samples.length - withStartTime} of ${samples.length} finishers have no start time — they are modelled as starting on the gun.`
      );
    }

    profiles.push({
      contest,
      distanceKm: distanceKm ?? 0,
      distanceSource: resolved.source,
      distanceNote: resolved.note,
      entrants: contestRows.length,
      finishers,
      withStartTime,
      samples,
      // Men first, so the two markers keep a stable order on every chart.
      leaders: (['M', 'F'] as Sex[]).map((s) => leaders.get(s)).filter((l): l is LeadAthlete => !!l),
      warnings: profileWarnings,
    });
  }

  profiles.sort((a, b) => b.distanceKm - a.distanceKm || a.contest.localeCompare(b.contest));

  return { profiles, warnings };
}

/** Percentile of a sorted numeric array, linearly interpolated. */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Summary figures for showing an operator what a loaded profile actually contains. */
export function summarizeProfile(profile: ContestProfile): {
  pace: { p1: number; p50: number; p99: number };
  startSpreadSeconds: { p50: number; p99: number; max: number };
} | null {
  if (profile.samples.length === 0) return null;

  const paces = profile.samples.map((s) => s.paceMinPerKm).sort((a, b) => a - b);
  const offsets = profile.samples.map((s) => s.startOffsetSeconds).sort((a, b) => a - b);

  return {
    pace: { p1: percentileOf(paces, 1), p50: percentileOf(paces, 50), p99: percentileOf(paces, 99) },
    startSpreadSeconds: {
      p50: percentileOf(offsets, 50),
      p99: percentileOf(offsets, 99),
      max: offsets[offsets.length - 1],
    },
  };
}

/**
 * Restates a contest at a distance the operator has corrected.
 *
 * Pace was worked out by dividing each finishing time by the distance, so it scales
 * inversely with it — no re-reading of the file is needed, and the result is identical
 * to what parsing with that distance would have produced.
 */
/**
 * Sets how far a contest was, and re-derives every pace from the finishing times.
 *
 * Deliberately re-derived rather than rescaled. Rescaling needs a distance to scale from,
 * which the one case this exists for — a contest the file could not measure — does not
 * have; and correcting the distance twice would compound the rounding of the first
 * correction into the second.
 */
export function withContestDistance(profile: ContestProfile, km: number): ContestProfile {
  if (!(km > 0)) return profile;
  const paceOf = (finishSeconds: number) => finishSeconds / 60 / km;
  return {
    ...profile,
    distanceKm: km,
    distanceSource: 'operator',
    distanceNote: '',
    warnings: profile.warnings.filter((w) => !w.startsWith('Could not work out how far')),
    samples: profile.samples.map((sample) => ({
      ...sample,
      paceMinPerKm: paceOf(sample.finishSeconds),
    })),
    leaders: profile.leaders.map((leader) => ({
      ...leader,
      paceMinPerKm: paceOf(leader.finishSeconds),
    })),
  };
}
