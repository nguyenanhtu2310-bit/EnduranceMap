/**
 * When runners were actually read at each mat, from a timing export.
 *
 * Every arrival the tool reports is otherwise computed: this runner started at 05:00,
 * runs 6.5 min/km, therefore reaches km 40 at 09:20. That is a model, and it is the only
 * thing available before a race. Afterwards it is not: the file says when each chip was
 * read, and a count taken from chip reads is a different kind of claim from one taken
 * from arithmetic.
 *
 * The distinction matters most between two mats. A runner read at CP3 and not yet at CP4
 * is unambiguously on that leg — that count is exact — while where on the leg they are
 * stays a straight line drawn through ground that is not straight.
 */

export const RESERVED_COLUMNS = ['Contest', 'Start TOD', 'Chip Time', 'Status'];

/** Statuses whose rows never happened on the course. */
const NOT_ON_COURSE = new Set(['dns', 'n/a', 'dsq']);

export interface SplitReadOptions {
  /** Column holding each runner's own gun crossing. */
  startColumn?: string;
  /** Column naming the contest a row belongs to. */
  contestColumn?: string;
  statusColumn?: string;
  /** Columns to leave out of the split list beyond the reserved ones. */
  ignoreColumns?: string[];
}

export interface ContestSplits {
  contest: string;
  /** Arrival seconds from the event's first midnight, per split column. */
  arrivalsBySplit: Map<string, number[]>;
  /** Runners with a start time, so a capture rate can be judged against something. */
  starters: number;
  /** Whether the file stated elapsed times or times of day. */
  reading: 'elapsed' | 'time-of-day';
}

export interface MeasuredSplits {
  contests: ContestSplits[];
  warnings: string[];
}

/**
 * A duration or a time of day, in seconds.
 *
 * Accepts the day prefix a timing export writes on a race that crosses midnight —
 * "1:03:00:04" is day one at three in the morning — and elapsed times past 24 hours,
 * which a 49-hour race produces on every finisher.
 */
export function parseSplitSeconds(text: string): number | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length < 3 || parts.length > 4) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;

  const [days, hours, minutes, seconds] =
    numbers.length === 4 ? numbers : [0, numbers[0], numbers[1], numbers[2]];
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

/** Split columns are whatever is left once the ones with a fixed meaning are removed. */
export function splitColumnsOf(headers: string[], options: SplitReadOptions = {}): string[] {
  const reserved = new Set(
    [...RESERVED_COLUMNS, ...(options.ignoreColumns ?? [])].map((h) => h.toLowerCase())
  );
  return headers.filter((header) => header && !reserved.has(header.toLowerCase()));
}

/**
 * Whether a column of split values holds elapsed times or times of day.
 *
 * Stated by the file only indirectly, and getting it wrong shifts every arrival by the
 * length of a morning. Any value past twenty-four hours settles it — no time of day is
 * 41:34:15, and a long race produces those on every runner. Failing that, an elapsed
 * first split is nearer to zero than the gun it followed, while a time of day is later
 * than it.
 */
function readingOf(startSeconds: number[], firstSplitSeconds: number[]): 'elapsed' | 'time-of-day' {
  if (firstSplitSeconds.some((s) => s >= 86400)) return 'elapsed';
  if (startSeconds.length === 0 || firstSplitSeconds.length === 0) return 'elapsed';

  const middle = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  return middle(firstSplitSeconds) < middle(startSeconds) ? 'elapsed' : 'time-of-day';
}

/**
 * Reads a timing export into the moments each mat was crossed.
 *
 * Rows that never started are dropped; rows that started and stopped are kept, because a
 * runner who reached four checkpoints and retired was at all four of them and the crews
 * there served them.
 */
export function readMeasuredSplits(
  rows: Record<string, string>[],
  options: SplitReadOptions = {}
): MeasuredSplits {
  const warnings: string[] = [];
  if (rows.length === 0) return { contests: [], warnings: ['The results file has no rows.'] };

  const headers = Object.keys(rows[0]);
  const startColumn = options.startColumn ?? 'Start TOD';
  const contestColumn = options.contestColumn ?? 'Contest';
  const statusColumn = options.statusColumn ?? 'Status';
  const splits = splitColumnsOf(headers, options);

  if (splits.length === 0) {
    return { contests: [], warnings: ['No split columns found in the results file.'] };
  }

  const byContest = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const status = (row[statusColumn] ?? '').trim().toLowerCase();
    if (NOT_ON_COURSE.has(status)) continue;
    const contest = (row[contestColumn] ?? '').trim();
    if (!contest) continue;
    const bucket = byContest.get(contest);
    if (bucket) bucket.push(row);
    else byContest.set(contest, [row]);
  }

  const contests: ContestSplits[] = [];
  for (const [contest, contestRows] of byContest) {
    const starts = contestRows
      .map((row) => parseSplitSeconds(row[startColumn] ?? ''))
      .filter((s): s is number => s !== null);
    if (starts.length === 0) {
      warnings.push(`"${contest}" has no start times, so its splits cannot be placed on a clock.`);
      continue;
    }

    const firstWithValues = splits.find((split) =>
      contestRows.some((row) => parseSplitSeconds(row[split] ?? '') !== null)
    );
    const firstValues = firstWithValues
      ? contestRows
          .map((row) => parseSplitSeconds(row[firstWithValues] ?? ''))
          .filter((s): s is number => s !== null)
      : [];
    const reading = readingOf(starts, firstValues);

    const arrivalsBySplit = new Map<string, number[]>();
    for (const split of splits) {
      const arrivals: number[] = [];
      for (const row of contestRows) {
        const value = parseSplitSeconds(row[split] ?? '');
        if (value === null) continue;
        if (reading === 'time-of-day') {
          arrivals.push(value);
          continue;
        }
        const start = parseSplitSeconds(row[startColumn] ?? '');
        if (start === null) continue;
        arrivals.push(start + value);
      }
      if (arrivals.length > 0) {
        arrivals.sort((a, b) => a - b);
        arrivalsBySplit.set(split, arrivals);
      }
    }

    contests.push({ contest, arrivalsBySplit, starters: starts.length, reading });
  }

  return { contests, warnings };
}

/**
 * The split columns a contest actually uses.
 *
 * One export carries every mat the whole event owns, and a contest passes a subset: a
 * real card has twenty-three columns of which the 100 km crosses thirteen. Judging a
 * contest against all of them reports the ten it never goes near as mats that read
 * nobody, which is true and useless.
 *
 * Better still is the timing configuration, which states the subset outright. This is
 * the fallback for a file arriving without one, and it cannot tell a mat a contest never
 * passes from one that failed entirely — both read nobody.
 */
export function splitsUsedBy(
  rows: Record<string, string>[],
  splits: string[]
): string[] {
  return splits.filter((split) => rows.some((row) => parseSplitSeconds(row[split] ?? '') !== null));
}

export interface MatCoverage {
  split: string;
  /** Runners this mat recorded. */
  read: number;
  /**
   * Runners known to have passed it: everyone it read, plus everyone read at any mat
   * further on. A runner seen at CP5 was at CP4 whether or not CP4 saw them.
   */
  passed: number;
  /** read / passed, or null where nobody is known to have passed at all. */
  rate: number | null;
}

/**
 * How completely each mat read the runners who went by it.
 *
 * Not reads over starters — that number falls all race as people drop out, and on a real
 * 100 miles it reaches 58% at the last checkpoint with every mat working perfectly. It
 * would report attrition as a hardware fault.
 *
 * Reads over runners *known* to have passed instead, which the file settles: anyone
 * recorded further along the course was here too. That is the measure that found a real
 * station reading 54% of the field it served, in a season where every other mat read 99%
 * and nothing on the page said otherwise.
 */
export function matCoverage(
  rows: Record<string, string>[],
  splitsInCourseOrder: string[],
  options: SplitReadOptions = {}
): MatCoverage[] {
  const statusColumn = options.statusColumn ?? 'Status';
  const startColumn = options.startColumn ?? 'Start TOD';

  const started = rows.filter((row) => {
    const status = (row[statusColumn] ?? '').trim().toLowerCase();
    return !NOT_ON_COURSE.has(status) && parseSplitSeconds(row[startColumn] ?? '') !== null;
  });

  const seen = splitsInCourseOrder.map((split) =>
    started.map((row) => parseSplitSeconds(row[split] ?? '') !== null)
  );

  return splitsInCourseOrder.map((split, index) => {
    let read = 0;
    let passed = 0;
    for (let runner = 0; runner < started.length; runner++) {
      const here = seen[index][runner];
      if (here) read += 1;
      if (here || seen.slice(index + 1).some((later) => later[runner])) passed += 1;
    }
    return { split, read, passed, rate: passed > 0 ? read / passed : null };
  });
}
