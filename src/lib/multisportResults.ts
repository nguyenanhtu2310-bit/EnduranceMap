import { findColumn, parseCsv } from './csv';
import { EXCLUDED_STATUSES } from './results';
import {
  isPlausibleLegDistance,
  measureDistanceKm,
  tidyKm,
  type BareUnit,
  type DistanceSource,
} from './distances';
import { parseClockTimeToSeconds } from './time';
import { parseElapsedToSeconds } from './results';
import type { LegKind } from './multisport';

/**
 * Reads a multisport timing export into per-leg reference fields.
 *
 * A multisport export looks nothing like the single-sport one `results.ts` handles. It
 * carries no contest column at all — a full and a half distance sit in the same file,
 * told apart only by how deep their splits run — and each athlete has a time per leg
 * rather than one finish time.
 *
 * Nothing here reads a name, an email, a birthdate, a club or a comment. The types have
 * nowhere to put them, which is the point: these profiles are written into saved race
 * files and exported reports, so a participant list must not be able to reach them even
 * by accident.
 */

/** One athlete, reduced to a rolling-start offset and per-leg durations. */
export interface MultisportAthleteSample {
  /** Own start minus the first start of their own race, so a rolling start survives. */
  raceOffsetSeconds: number;
  /** Seconds spent on each leg, index-aligned to the profile's legs. */
  legSeconds: number[];
}

export interface ProfileLeg {
  kind: LegKind;
  label: string;
  /** Distance this leg covered in the reference race; 0 for transitions. */
  distanceKm: number;
}

export interface MultisportProfile {
  /** Identifies the race within the file, and keys the mapping onto a planned race. */
  key: string;
  /** Where the leg distances came from, so the operator can judge whether to trust them. */
  distanceSource: DistanceSource;
  label: string;
  legs: ProfileLeg[];
  athletes: MultisportAthleteSample[];
  /** Rows classified into this race — every starter it can account for. */
  rows: number;
  /** How many of those had a complete, ordered set of leg boundaries. */
  usable: number;
  /** How many athletes reached each boundary. The gaps are where the race lost people. */
  attrition: { label: string; reached: number }[];
  warnings: string[];
}

export interface MultisportParseResult {
  profiles: MultisportProfile[];
  warnings: string[];
}

export interface MultisportParseOptions {
  /** Overrides the inferred leg distances, keyed by profile key. */
  legDistanceOverrides?: Record<string, number[]>;
  /**
   * The file's own name. Operators name exports after the race — "Sprint results.csv",
   * "IM70.3 Danang.csv" — which is a statement of the distances that no amount of
   * reading the times can better.
   */
  fileName?: string;
}

interface StandardRace {
  label: string;
  swimKm: number;
  bikeKm: number;
  runKm: number;
  /** How the race is written in a file name. */
  namedBy: RegExp;
}

/*
 * The four standard multisport distances, longest first. A timing file records where the
 * split mats were, not how long the race was — a full distance's deepest bike mat sits at
 * 155 km of 180 — so mats alone can only rule out races too short to hold them.
 */
const STANDARD_RACES: StandardRace[] = [
  /*
   * The distance is bounded against digits rather than word characters: a word boundary
   * would not match "IM140.6", where the brand runs straight into the number.
   *
   * "Full" and "half" have to be qualified. An aquathlon series calls its longest race
   * "Full Aqua Warriors" and means 3 km of swimming and 15 km of running; reading that
   * as an Ironman gave it a 42 km run, which is the sort of wrong that looks right.
   */
  { label: 'Full distance', swimKm: 3.8, bikeKm: 180.2, runKm: 42.2, namedBy: /(?<!\d)140\.?6(?!\d)|\bfull\s+(?:distance|iron\s?man)\b/i },
  { label: 'Half distance', swimKm: 1.9, bikeKm: 90.1, runKm: 21.1, namedBy: /(?<!\d)70\.?3(?!\d)|\bhalf\s+(?:distance|iron\s?man)\b/i },
  // "5150" is the brand name for the Olympic distance: 51.50 km of racing all told.
  { label: 'Olympic', swimKm: 1.5, bikeKm: 40, runKm: 10, namedBy: /\bolympic\b|\b5150\b/i },
  { label: 'Sprint', swimKm: 0.75, bikeKm: 20, runKm: 5, namedBy: /\bsprint\b/i },
];

/*
 * Series whose names mean whatever the organizer decided.
 *
 * A recurring aquathlon client runs Kids, Junior, Sprint, Olympic, Full and Ultra, and
 * by "Full" means 3 km of swimming and 15 km of running. Only Sprint and Olympic happen
 * to match the triathlon distances of the same name; the rest mean nothing standard, and
 * two of them read as an Ironman if taken at face value. Checked before the standard
 * distances, so a series that has said what it means is believed over a convention it
 * never followed.
 */
const NAMED_SERIES: StandardRace[] = [
  { label: 'Ultra Aqua', swimKm: 5, bikeKm: 0, runKm: 21, namedBy: /\bultra\s+aqua\b/i },
  { label: 'Full Aqua', swimKm: 3, bikeKm: 0, runKm: 15, namedBy: /\bfull\s+aqua\b/i },
  { label: 'Olympic Aqua', swimKm: 1.5, bikeKm: 0, runKm: 10, namedBy: /\bolympic\s+aqua\b/i },
  { label: 'Sprint Aqua', swimKm: 0.75, bikeKm: 0, runKm: 5, namedBy: /\bsprint\s+aqua\b/i },
  { label: 'Junior Aqua', swimKm: 0.3, bikeKm: 0, runKm: 2, namedBy: /\bjunior\s+aqua\b/i },
  { label: 'Kids Aqua', swimKm: 0.15, bikeKm: 0, runKm: 1, namedBy: /\bkids?\s+aqua\b/i },
];

/**
 * The race a piece of text announces, if it names exactly one.
 *
 * Used on a contest name and on a file name alike: "Sprint", "Olympic", "IM70.3" and
 * "140.6" are statements of the leg distances that no amount of reading the times can
 * better. A name mentioning two settles nothing — "IM70.3 and 140.6 results".
 */
export function detectRaceFromName(text: string | undefined): StandardRace | undefined {
  if (!text) return undefined;

  // A series that states its own distances outranks any convention.
  const series = NAMED_SERIES.find((race) => race.namedBy.test(text));
  if (series) return series;

  const named = STANDARD_RACES.filter((race) => race.namedBy.test(text));
  return named.length === 1 ? named[0] : undefined;
}

/** @deprecated Use {@link detectRaceFromName}. */
export const detectRaceFromFileName = detectRaceFromName;

/** A "20K_TD" / "5.9K_TD" intermediate split column. */
const SPLIT_COLUMN = /^(\d+(?:\.\d+)?)K_TD$/i;

/**
 * Longest a race is allowed to take before its times are read as corrupt rather than
 * slow. Even a full-distance race closes inside seventeen hours, so a day is generous —
 * but it is what stops a mistyped time of day being quietly rescued as a midnight
 * rollover and turned into a sixteen-hour bike leg.
 */
const MAX_RACE_SECONDS = 86400;

/**
 * How far the legs may fall from the stated finishing time before it is worth saying so.
 * Leg times are rounded to the second, so a well-mapped export lands within a few.
 */
const FINISH_SUM_TOLERANCE_SECONDS = 90;

/**
 * Which parser a results file needs.
 *
 * A transition column decides it. Nothing in a running race has a T1, so its presence is
 * conclusive however the rest of the file is laid out — and a multisport export naming
 * its contests is still a multisport export. Reading one as a running race leaves it
 * trying to work out a pace per kilometre for "Sprint".
 */
export function detectResultsFormat(text: string): 'single' | 'multisport' {
  // Parsed rather than split by hand: a file may be double-quote-encoded, in which case
  // splitting the raw header line on commas leaves every name wrapped in quotes and a
  // transition column stops being recognisable.
  const head = parseCsv(text.split(/\r?\n/).slice(0, 3).join('\n'));
  const headers = head.length > 0 ? Object.keys(head[0]) : [];

  return findColumn(headers, 'T1', 'T1_TD', 'Transition 1') ? 'multisport' : 'single';
}

/** Time-of-day column marking the moment an athlete actually started. */
function findStartColumn(headers: string[]): string | undefined {
  return findColumn(headers, 'Start_TD', 'SwimStart TOD', 'SwimStartToD', 'StartTOD', 'Start');
}

interface Boundary {
  column: string;
  /** The leg that ENDS at this boundary; absent on the start. */
  leg?: { kind: LegKind; label: string };
}

interface LegColumn {
  kind: LegKind;
  label: string;
  column: string;
}

/**
 * How a file states its leg times.
 *
 * Exports differ wildly in what else they carry — times of day, combined
 * "elapsed(time of day)" cells, per-leg pace columns — but a column holding each leg's
 * own duration is near universal, and is read directly rather than reconstructed by
 * subtracting one time of day from another.
 */
type Shape =
  | { mode: 'elapsed'; legs: LegColumn[]; startColumn?: string }
  | { mode: 'boundaries'; boundaries: Boundary[] };

/**
 * Legs stated as their own durations: "Swim", "T1", "Bike", "T2", "Run".
 *
 * The columns have to carry data, not merely exist. Exports that record times of day
 * often also carry empty duration columns, and reading those would leave every athlete
 * looking like they never finished a leg.
 */
function readElapsedShape(headers: string[], rows: Record<string, string>[]): Shape | null {
  const swim = findColumn(headers, 'Swim');
  const t1 = findColumn(headers, 'T1', 'Transition 1');
  const bike = findColumn(headers, 'Bike');
  const t2 = findColumn(headers, 'T2', 'Transition 2');
  const run = findColumn(headers, 'Run');
  if (!run || (!swim && !bike)) return null;

  const legs: LegColumn[] = [];
  if (swim) legs.push({ kind: 'swim', label: 'Swim', column: swim });
  if (t1) legs.push({ kind: 'transition', label: 'T1', column: t1 });
  if (bike) legs.push({ kind: 'bike', label: 'Bike', column: bike });
  if (t2) legs.push({ kind: 'transition', label: 'T2', column: t2 });
  legs.push({ kind: 'run', label: 'Run', column: run });

  /*
   * Only the raced legs have to be readable. A transition is often written as a bare "0"
   * or left blank when the timing system did not record one, and requiring it made the
   * whole file unreadable — the columns were there, so nothing else was tried, and the
   * parser reported that it could find no legs at all.
   */
  const raced = legs.filter((leg) => leg.kind !== 'transition');
  const anyComplete = rows.some((row) =>
    raced.every((leg) => parseElapsedToSeconds(row[leg.column] ?? '') !== null)
  );
  if (!anyComplete) return null;

  return { mode: 'elapsed', legs, startColumn: findStartColumn(headers) };
}

/**
 * Works out the sequence of legs from the columns present, preferring the durations a
 * file states outright over reconstructing them from times of day.
 *
 * In the boundary form the run has no column of its own — it ends at the finish — which
 * falls out naturally from describing legs by the boundary that closes them.
 */
function readShape(headers: string[], rows: Record<string, string>[]): Shape | null {
  const elapsed = readElapsedShape(headers, rows);
  if (elapsed) return elapsed;

  const start = findStartColumn(headers);
  const finish = findColumn(headers, 'Finish_TD');
  if (!start || !finish) return null;

  const swim = findColumn(headers, 'Swim_TD');
  const t1 = findColumn(headers, 'T1_TD');
  const bike = findColumn(headers, 'Bike_TD');
  const t2 = findColumn(headers, 'T2_TD');

  const boundaries: Boundary[] = [{ column: start }];
  if (swim) boundaries.push({ column: swim, leg: { kind: 'swim', label: 'Swim' } });
  if (t1) boundaries.push({ column: t1, leg: { kind: 'transition', label: 'T1' } });
  if (bike) boundaries.push({ column: bike, leg: { kind: 'bike', label: 'Bike' } });
  if (t2) boundaries.push({ column: t2, leg: { kind: 'transition', label: 'T2' } });
  boundaries.push({ column: finish, leg: { kind: 'run', label: 'Run' } });

  if (!swim && !bike) return null;
  return { mode: 'boundaries', boundaries };
}

/** Split columns lying between two boundaries in header order — the splits of that leg. */
function splitsBetween(headers: string[], from: string | undefined, to: string | undefined): number[] {
  if (!from || !to) return [];
  const start = headers.indexOf(from);
  const end = headers.indexOf(to);
  if (start < 0 || end < 0 || end <= start) return [];

  return headers
    .slice(start + 1, end)
    .map((h) => h.match(SPLIT_COLUMN))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]))
    .filter((km) => Number.isFinite(km));
}

/** Typical age-group bike speed and run pace, used to sanity-check an inferred distance. */
const PLAUSIBLE_BIKE_KMH = 30;
const PLAUSIBLE_RUN_MIN_PER_KM = 7;

/**
 * Works out which standard race a field belongs to.
 *
 * Bike mats rule out races too short to hold them, and physics decides between whatever
 * is left: how fast the middle of the field would have had to ride and run for each
 * candidate to be true. Reading a three-hour bike leg as 180 km means claiming 60 km/h,
 * which settles it.
 *
 * Run mats are deliberately not used as a constraint. In a real export the run columns
 * are named for the longest race's distances, and a half-distance field trips mats
 * labelled well past its own run — 31 km of a 21 km leg — so requiring the run to be
 * long enough to contain them rules out the very race the field belongs to.
 */
/**
 * How badly a race's distances fit the times recorded — zero is a field riding and
 * running at exactly the rates a mid-pack multisport field does.
 */
function misfit(race: StandardRace, medianBikeSeconds: number, medianRunSeconds: number): number {
  let score = 0;
  if (medianBikeSeconds > 0) {
    const kmh = race.bikeKm / (medianBikeSeconds / 3600);
    score += Math.abs(kmh - PLAUSIBLE_BIKE_KMH) / PLAUSIBLE_BIKE_KMH;
  }
  if (medianRunSeconds > 0) {
    const pace = medianRunSeconds / 60 / race.runKm;
    score += Math.abs(pace - PLAUSIBLE_RUN_MIN_PER_KM) / PLAUSIBLE_RUN_MIN_PER_KM;
  }
  return score;
}

function inferDistances(deepestBikeKm: number, medianBikeSeconds: number, medianRunSeconds: number) {
  const possible = STANDARD_RACES.filter((r) => r.bikeKm >= deepestBikeKm);
  const candidates = possible.length > 0 ? possible : STANDARD_RACES;
  if (medianBikeSeconds <= 0 && medianRunSeconds <= 0) return candidates[candidates.length - 1];

  let best = candidates[0];
  let bestScore = Infinity;
  for (const race of candidates) {
    const score = misfit(race, medianBikeSeconds, medianRunSeconds);
    if (score < bestScore) {
      bestScore = score;
      best = race;
    }
  }
  return best;
}

/**
 * How much better another race has to fit before a name is disbelieved.
 *
 * A file called "5150 Dapitan Sprint" held Olympic-distance racing; taking the name at
 * its word put the field on a 20 km bike at 16.6 km/h and a 5 km run at 10.8 min/km.
 * Names are still trusted by default — they are usually right, and a slow field is not
 * evidence of anything — but not once the times say something else this loudly.
 */
const NAME_DOUBT_MARGIN = 0.35;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function parseMultisportResultsCsv(
  text: string,
  options: MultisportParseOptions = {}
): MultisportParseResult {
  const rows = parseCsv(text);
  const warnings: string[] = [];
  if (rows.length === 0) return { profiles: [], warnings: ['That file has no rows.'] };

  const headers = Object.keys(rows[0]);
  const shape = readShape(headers, rows);
  if (!shape) {
    return {
      profiles: [],
      warnings: [
        'Could not find the leg columns. A multisport export needs a time for each leg — ' +
          'either Swim, T1, Bike, T2 and Run durations, or Start_TD and Finish_TD with the ' +
          'boundaries between them.',
      ],
    };
  }

  const legs =
    shape.mode === 'elapsed'
      ? shape.legs.map((l) => ({ kind: l.kind, label: l.label }))
      : shape.boundaries.slice(1).map((b) => b.leg!);

  /**
   * The athlete's overall time, where the file states one. Never used to build the model
   * — the legs are — but it proves they were mapped right, and supplies a transition the
   * timing system did not record.
   */
  const finishColumn = findColumn(
    headers,
    'ChipTime',
    'FinishChipTime',
    'Chip Time',
    'FinishTime',
    'NetTime',
    'Finish'
  );

  /** Columns whose presence marks how far an athlete got, for the attrition ladder. */
  const reachedColumns =
    shape.mode === 'elapsed'
      ? [shape.startColumn ?? shape.legs[0].column, ...shape.legs.map((l) => l.column)]
      : shape.boundaries.map((b) => b.column);

  const startColumn = shape.mode === 'elapsed' ? shape.startColumn : shape.boundaries[0].column;

  const bikeSplits = splitsBetween(headers, findColumn(headers, 'T1_TD'), findColumn(headers, 'Bike_TD'));
  const runSplits = splitsBetween(headers, findColumn(headers, 'T2_TD'), findColumn(headers, 'Finish_TD'));

  /**
   * One athlete's seconds per leg, plus the moment they started.
   *
   * Returns null when any leg is missing — an athlete who did not finish has no pace to
   * contribute, and half a race would drag every percentile the wrong way.
   */
  function legTimes(row: Record<string, string>): { legSeconds: number[]; startSeconds: number } | null {
    const startSeconds = startColumn ? (parseClockTimeToSeconds(row[startColumn] ?? '') ?? 0) : 0;

    if (shape!.mode === 'elapsed') {
      const legSeconds: number[] = [];
      for (const leg of shape!.legs) {
        const seconds = parseElapsedToSeconds(row[leg.column] ?? '');
        if (seconds === null || seconds < 0) {
          // A transition nobody timed is worth a couple of minutes; a swim, ride or run
          // nobody timed is the athlete. One race in a real file left T1 blank for all
          // 213 of its entrants, and requiring it discarded the entire contest.
          if (leg.kind === 'transition') {
            legSeconds.push(0);
            continue;
          }
          return null;
        }
        legSeconds.push(seconds);
      }
      /*
       * A transition nobody timed still happened, and it shows up as the gap between the
       * legs and the stated finishing time. One aquathlon writes T1 as a flat zero while
       * its athletes spent a median of eight minutes there, varying from two to
       * twenty-two — real time between getting out of the water and starting to run.
       * Attributing it to the untimed transition is better than dropping it, which would
       * open every run position eight minutes early.
       *
       * Only ever added, never subtracted: a leg column holding a running total makes the
       * sum too large, and that stays a fault to report rather than something to absorb.
       */
      const total = legSeconds.reduce((sum, v) => sum + v, 0);
      if (finishColumn && total > 0) {
        const stated = parseElapsedToSeconds(row[finishColumn] ?? '');
        const untimed = shape!.legs
          .map((leg, i) => ({ leg, i }))
          .filter((e) => e.leg.kind === 'transition' && legSeconds[e.i] === 0);

        if (stated !== null && stated > total && untimed.length === 1) {
          const missing = stated - total;
          // A gap larger than the racing itself is a mapping fault, not a transition.
          if (missing < total) legSeconds[untimed[0].i] = missing;
        }
      }

      const settled = legSeconds.reduce((sum, v) => sum + v, 0);
      return settled > 0 && settled <= MAX_RACE_SECONDS ? { legSeconds, startSeconds } : null;
    }

    const times: number[] = [];
    let previous = -Infinity;
    for (const b of shape!.boundaries) {
      const seconds = parseClockTimeToSeconds(row[b.column] ?? '');
      if (seconds === null) return null;
      let value = seconds;
      // A race that starts before dawn and finishes after midnight reads as going
      // backwards; times only ever move forward, so a step back is a new day.
      while (value < previous) value += 86400;
      previous = value;
      times.push(value);
    }
    if (times[times.length - 1] - times[0] > MAX_RACE_SECONDS) return null;

    return {
      legSeconds: times.slice(1).map((t, i) => t - times[i]),
      startSeconds: times[0],
    };
  }

  /** How far into a leg this row's splits reach — what tells the races apart. */
  function deepestSplitKm(row: Record<string, string>, splits: number[]): number {
    let best = 0;
    for (const header of headers) {
      const m = header.match(SPLIT_COLUMN);
      if (!m) continue;
      const km = Number(m[1]);
      if (!splits.includes(km)) continue;
      if ((row[header] ?? '').trim()) best = Math.max(best, km);
    }
    return best;
  }

  const depthSplits = bikeSplits.length > 0 ? bikeSplits : runSplits;

  interface Entry {
    row: Record<string, string>;
    depth: number;
    /** Present only for athletes with a complete set of leg times. */
    times: { legSeconds: number[]; startSeconds: number } | null;
  }

  /*
   * A starter is anyone who left the line. Files that record a start time say so
   * directly; those that only carry durations show it by having any leg time at all,
   * which is what separates a did-not-start from a did-not-finish.
   */
  /*
   * A blank status is a clean race — timing software only writes a value when something
   * went wrong — so rows are excluded by what the status says, never by its absence.
   */
  const statusColumn = findColumn(headers, 'Status', 'StatusText');
  const isExcluded = (row: Record<string, string>) =>
    !!statusColumn && EXCLUDED_STATUSES.has((row[statusColumn] ?? '').trim().toLowerCase());

  const entries: Entry[] = [];
  for (const row of rows) {
    if (isExcluded(row)) continue;
    const started = startColumn
      ? parseClockTimeToSeconds(row[startColumn] ?? '') !== null
      : reachedColumns.some((c) => parseElapsedToSeconds(row[c] ?? '') !== null);
    if (!started) continue;
    entries.push({ row, depth: deepestSplitKm(row, depthSplits), times: legTimes(row) });
  }

  const startedRows = entries.length;
  if (!entries.some((e) => e.times)) {
    return { profiles: [], warnings: ['No athlete in that file has a complete set of leg times.'] };
  }

  /*
   * Races are separated by how deep their splits run, but not every athlete trips every
   * mat. Depths carrying only a handful of athletes are those missed reads rather than
   * a race of their own, so they are folded into the nearest real field — otherwise one
   * runner who missed a mat becomes a third race with a field of one.
   */
  const byDepth = new Map<number, Entry[]>();
  for (const entry of entries) {
    byDepth.set(entry.depth, [...(byDepth.get(entry.depth) ?? []), entry]);
  }

  const minimumField = Math.max(10, Math.round(startedRows * 0.02));
  const realDepths = [...byDepth.entries()]
    .filter(([, list]) => list.length >= minimumField)
    .map(([depth]) => depth)
    .sort((a, b) => b - a);

  const groups = new Map<number, Entry[]>();
  for (const [depth, list] of byDepth) {
    const target =
      realDepths.length === 0
        ? depth
        : realDepths.reduce((best, d) => (Math.abs(d - depth) < Math.abs(best - depth) ? d : best));
    groups.set(target, [...(groups.get(target) ?? []), ...list]);
  }

  /*
   * A contest column, where the file has one, beats every other way of telling the races
   * apart: it is the organizer saying so, rather than an inference from which mats an
   * athlete happened to trip. Split depth is the fallback for files that carry none.
   */
  /*
   * Where a file states a pace or a speed for a leg, the distance stops being a guess:
   * duration multiplied by rate is arithmetic on the organiser's own numbers, and across
   * a real export of 182 athletes the answers agreed to within a quarter of a percent.
   */
  const rateColumns: Partial<Record<LegKind, string>> = {
    swim: findColumn(headers, 'Swim pace', 'Swim Pace', 'SwimPace'),
    bike: findColumn(headers, 'Bike Speed', 'Bike speed', 'BikeSpeed', 'Bike Pace', 'Bike pace'),
    run: findColumn(headers, 'Run Pace', 'Run pace', 'RunPace'),
  };

  const contestColumn = findColumn(headers, 'Contest', 'Race', 'Event', 'Category', 'Division');
  const named: { key: string; label: string; depth: number; group: Entry[] }[] = [];

  if (contestColumn && entries.some((e) => (e.row[contestColumn] ?? '').trim())) {
    const byContest = new Map<string, Entry[]>();
    for (const entry of entries) {
      const contest = (entry.row[contestColumn] ?? '').trim();
      if (!contest) continue;
      byContest.set(contest, [...(byContest.get(contest) ?? []), entry]);
    }
    for (const [contest, group] of byContest) {
      named.push({
        key: contest,
        label: contest,
        depth: Math.max(0, ...group.map((e) => e.depth)),
        group,
      });
    }
    named.sort((a, b) => b.depth - a.depth);
  } else {
    for (const [depth, group] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      named.push({ key: `depth-${depth}`, label: '', depth, group });
    }
  }

  const ordered = named;
  const profiles: MultisportProfile[] = [];

  for (const { key, label: contestLabel, depth, group } of ordered) {
    const finishers = group.filter((e) => e.times).map((e) => e.times!);
    if (finishers.length === 0) continue;
    const legWarningsForGroup: string[] = [];

    /*
     * Legs that do not add up to the stated finishing time mean the export is mapped
     * wrongly — most likely a leg column returning cumulative time rather than that
     * segment's own. Nothing downstream would look broken; the run leg would simply be
     * three times too long and every run checkpoint would open at the wrong hour.
     */
    if (finishColumn && shape.mode === 'elapsed') {
      const gaps: number[] = [];
      for (const entry of group) {
        if (!entry.times) continue;
        const stated = parseElapsedToSeconds(entry.row[finishColumn] ?? '');
        if (stated === null || stated <= 0) continue;
        gaps.push(Math.abs(entry.times.legSeconds.reduce((sum, v) => sum + v, 0) - stated));
      }
      const typical = median(gaps);
      if (gaps.length >= 5 && typical > FINISH_SUM_TOLERANCE_SECONDS) {
        legWarningsForGroup.push(
          `Leg times do not add up to the finishing time — they are out by about ` +
            `${Math.round(typical / 60)} min for a typical athlete. Check that each leg column ` +
            `holds that segment's own duration rather than the running total.`
        );
      }
    }

    const bikeIndex = legs.findIndex((l) => l.kind === 'bike');
    const runIndex = legs.findIndex((l) => l.kind === 'run');
    const legDuration = (i: number) => (i < 0 ? [] : finishers.map((t) => t.legSeconds[i]));

    /*
     * The contest's own name is the best evidence there is. Failing that, a file named
     * for its race says the same thing — but only when the file holds one race, since
     * one name cannot describe both halves of an export carrying two. Everything else
     * falls back to what the times imply.
     */
    const medianBike = median(legDuration(bikeIndex));
    const medianRun = median(legDuration(runIndex));
    const fromTimes = inferDistances(depth, medianBike, medianRun);

    const claimed =
      detectRaceFromName(contestLabel) ??
      (ordered.length === 1 ? detectRaceFromName(options.fileName) : undefined);

    // A name is believed unless another distance fits the times markedly better.
    const nameIsDoubtful =
      !!claimed &&
      claimed !== fromTimes &&
      misfit(claimed, medianBike, medianRun) - misfit(fromTimes, medianBike, medianRun) >
        NAME_DOUBT_MARGIN;

    const fromName = nameIsDoubtful ? undefined : claimed;
    const standard = fromName ?? fromTimes;
    const legWarnings: string[] = [...legWarningsForGroup];

    // Measured first, and only fall back to the named or inferred race for legs the file
    // says nothing about.
    const measured = legs.map((leg, i) => {
      const column = rateColumns[leg.kind];
      if (!column || leg.kind === 'transition') return null;
      // A column headed "Speed" that states a bare number means km/h; a pace column
      // means minutes per kilometre. The heading is the only thing that says which.
      const bareUnit: BareUnit = /speed/i.test(column) ? 'kmh' : 'perKm';
      const result = measureDistanceKm(
        group.map((e) => ({ seconds: e.times?.legSeconds[i] ?? 0, rate: e.row[column] })),
        5,
        bareUnit
      );
      if (!result?.consistent) return null;
      const km = tidyKm(result.km);
      // Consistent but absurd means the rate was read in the wrong unit, which every
      // athlete would agree on — so the spread cannot catch it and the bounds must.
      return isPlausibleLegDistance(leg.kind, km) ? km : null;
    });

    const distances = legs.map((leg, i) =>
      measured[i] ??
      (leg.kind === 'swim'
        ? standard.swimKm
        : leg.kind === 'bike'
          ? standard.bikeKm
          : leg.kind === 'run'
            ? standard.runKm
            : 0)
    );
    const override = options.legDistanceOverrides?.[key];
    const legDistances = override && override.length === legs.length ? override : distances;
    const anyMeasured = measured.some((km) => km !== null);
    if (!override) {
      legWarnings.push(
        anyMeasured
          ? `Leg distances measured from this file's own pace columns: ${legs
              .map((leg, i) => (measured[i] !== null ? `${leg.label} ${measured[i]} km` : null))
              .filter(Boolean)
              .join(', ')}.`
          : fromName
          ? `Leg distances taken as ${standard.label} from the name.`
          : nameIsDoubtful
            ? `Named as ${claimed!.label}, but the times fit ${standard.label} — using ${standard.label}. ` +
              `Set the distances by hand if the name is right.`
            : `Leg distances read as ${standard.label} from the times — check them if that is wrong.`
      );
    }

    // Rolling starts are preserved where the file records one; where it does not, every
    // athlete is modelled as leaving at the gun, which is all the file supports.
    const firstStart = Math.min(...finishers.map((t) => t.startSeconds));
    const athletes: MultisportAthleteSample[] = finishers.map(({ legSeconds, startSeconds }) => ({
      raceOffsetSeconds: startSeconds - firstStart,
      legSeconds,
    }));

    // Counted over everyone who started this race, not just those who finished it —
    // where the ladder drops is where the race lost people, which is the whole point.
    const attrition = reachedColumns.map((column, i) => ({
      label: i === 0 ? 'Started' : `${legs[i - 1].label} done`,
      reached: group.filter((e) =>
        i === 0 && startColumn
          ? parseClockTimeToSeconds(e.row[column] ?? '') !== null
          : parseElapsedToSeconds(e.row[column] ?? '') !== null ||
            parseClockTimeToSeconds(e.row[column] ?? '') !== null
      ).length,
    }));

    profiles.push({
      key,
      distanceSource: override ? 'operator' : anyMeasured ? 'measured' : fromName ? 'name' : 'times',
      label: contestLabel || standard.label,
      legs: legs.map((leg, i) => ({ kind: leg.kind, label: leg.label, distanceKm: legDistances[i] })),
      athletes,
      rows: group.length,
      usable: athletes.length,
      attrition,
      warnings: legWarnings,
    });
  }

  const dropped = startedRows - profiles.reduce((n, p) => n + p.usable, 0);
  if (dropped > 0) {
    warnings.push(
      `${dropped} of ${startedRows} starters are missing a leg time and are left out — usually athletes who did not finish.`
    );
  }

  return { profiles, warnings };
}

/** Reference paces per leg, in whatever unit that leg is normally described by. */
export function summarizeMultisportProfile(profile: MultisportProfile) {
  return profile.legs.map((leg, i) => {
    const seconds = profile.athletes.map((a) => a.legSeconds[i]).sort((a, b) => a - b);
    const at = (p: number) => seconds[Math.min(seconds.length - 1, Math.floor((seconds.length - 1) * p))] ?? 0;
    return {
      leg,
      p1Seconds: at(0.01),
      p50Seconds: at(0.5),
      p99Seconds: at(0.99),
    };
  });
}

/**
 * Restates a race's leg distances after the operator corrects them.
 *
 * Nothing in an athlete's record depends on the distance — the legs are durations — so
 * only the stated distances change, and the pace falls out of them later.
 */
export function withLegDistances(profile: MultisportProfile, distancesKm: number[]): MultisportProfile {
  return {
    ...profile,
    distanceSource: 'operator',
    legs: profile.legs.map((leg, i) => {
      const km = distancesKm[i];
      return km !== undefined && km >= 0 ? { ...leg, distanceKm: km } : leg;
    }),
  };
}
