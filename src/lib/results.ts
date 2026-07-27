import { parseCsv } from './csv';

/**
 * One finisher, reduced to the two things that decide when they reach a checkpoint:
 * how long after the gun they crossed the start, and how fast they then ran.
 */
export interface RunnerSample {
  startOffsetSeconds: number;
  paceMinPerKm: number;
}

export interface ContestProfile {
  contest: string;
  /** Distance the pace was measured over — the reference race's official distance. */
  distanceKm: number;
  entrants: number;
  finishers: number;
  /** Finishers whose start time was also recorded, so their offset is real. */
  withStartTime: number;
  samples: RunnerSample[];
  warnings: string[];
}

export interface ResultsParseResult {
  profiles: ContestProfile[];
  warnings: string[];
}

/** Statuses that mean the runner did not produce a usable finish. */
const EXCLUDED_STATUSES = new Set(['dns', 'dnf', 'dsq', 'ooc']);

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
  if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(text)) return null;

  const parts = text.split(':').map((p) => parseInt(p, 10));
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

function findColumn(headers: string[], ...candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const hit = headers.find((h) => h.trim().toLowerCase() === candidate.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
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

  for (const [contest, contestRows] of byContest) {
    const profileWarnings: string[] = [];
    const distanceKm = options.distanceOverrides?.[contest] ?? inferContestDistanceKm(contest);

    if (!distanceKm || distanceKm <= 0) {
      profileWarnings.push(
        `Could not work out the distance of "${contest}" from its name — set it manually before using this contest.`
      );
    }

    // Start offsets are relative to the first starter of this contest.
    const startTimes = contestRows
      .map((r) => (startCol ? parseTodSeconds(r[startCol] ?? '') : null))
      .filter((s): s is number => s !== null);
    const firstStart = startTimes.length > 0 ? Math.min(...startTimes) : null;

    const samples: RunnerSample[] = [];
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

      if (!distanceKm || distanceKm <= 0) continue;

      const ownStart = startCol ? parseTodSeconds(row[startCol] ?? '') : null;
      const startOffsetSeconds = ownStart !== null && firstStart !== null ? ownStart - firstStart : 0;
      if (ownStart !== null) withStartTime += 1;

      samples.push({ startOffsetSeconds, paceMinPerKm: elapsed / 60 / distanceKm });
    }

    if (samples.length > 0 && withStartTime < samples.length) {
      profileWarnings.push(
        `${samples.length - withStartTime} of ${samples.length} finishers have no start time — they are modelled as starting on the gun.`
      );
    }

    profiles.push({
      contest,
      distanceKm: distanceKm ?? 0,
      entrants: contestRows.length,
      finishers,
      withStartTime,
      samples,
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
