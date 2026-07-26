import { parseClockTimeToSeconds } from './time';
import { DEFAULT_PACE_BOUNDS, type PaceBounds } from './config';

/** Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas/quotes, and CRLF/LF. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // ignore; \n (handled below) closes the row
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Parses CSV text into an array of header-keyed row objects. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (row[i] ?? '').trim();
      });
      return obj;
    });
}

export interface SplitColumn {
  index: number;
  splitColumn: string;
  todColumn?: string;
}

/** Finds "SplitN" / "SplitN.ToD" column pairs in a header row, sorted by split index. */
export function identifySplitColumns(headers: string[]): SplitColumn[] {
  const splitRe = /^Split(\d+)$/i;
  const columns: SplitColumn[] = [];

  for (const h of headers) {
    const m = h.match(splitRe);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    const todColumn = headers.find((hh) => hh.toLowerCase() === `${h}.tod`.toLowerCase());
    columns.push({ index, splitColumn: h, todColumn });
  }

  return columns.sort((a, b) => a.index - b.index);
}

/**
 * Extracts a runner's clock-time arrival at each split column, unwrapping midnight
 * rollovers (arrivals must be monotonically increasing from the start time).
 */
export function extractRunnerArrivals(
  row: Record<string, string>,
  splitColumns: SplitColumn[],
  startTodColumn = 'startTOD'
): (number | null)[] {
  let previous = parseClockTimeToSeconds(row[startTodColumn] ?? '');

  return splitColumns.map((col) => {
    const raw = col.todColumn ? row[col.todColumn] : undefined;
    if (!raw) return null;

    let seconds = parseClockTimeToSeconds(raw);
    if (seconds === null) return null;

    if (previous !== null) {
      while (seconds < previous) seconds += 86400;
    }
    previous = seconds;
    return seconds;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface CheckpointCandidate {
  name: string;
  kmFromStart: number;
}

export interface SplitMatchResult {
  splitColumn: string;
  checkpoint: CheckpointCandidate;
  /** Median pace (min/km) for the leg leading into this split, across runners with a valid arrival. */
  medianPaceMinPerKm: number | null;
  plausible: boolean;
  warning?: string;
}

/**
 * Confirms which split column corresponds to which checkpoint by checking that the
 * median runner's pace between consecutive checkpoints stays physically plausible.
 * Split columns and checkpoints are both assumed to already be in course order
 * (Split1..SplitN alongside checkpoints sorted by km-from-start) — this is a
 * consistency check on that assumption, not a search over orderings.
 */
export function matchSplitsToCheckpoints(
  rows: Record<string, string>[],
  splitColumns: SplitColumn[],
  checkpointsInCourseOrder: CheckpointCandidate[],
  options: { startTodColumn?: string; paceBounds?: PaceBounds } = {}
): SplitMatchResult[] {
  const startTodColumn = options.startTodColumn ?? 'startTOD';
  const paceBounds = options.paceBounds ?? DEFAULT_PACE_BOUNDS;

  const n = Math.min(splitColumns.length, checkpointsInCourseOrder.length);
  const trimmedSplitColumns = splitColumns.slice(0, n);
  const arrivalsByRunner = rows.map((row) => extractRunnerArrivals(row, trimmedSplitColumns, startTodColumn));

  const results: SplitMatchResult[] = [];
  let previousKm = 0;

  for (let i = 0; i < n; i++) {
    const checkpoint = checkpointsInCourseOrder[i];
    const legKm = checkpoint.kmFromStart - previousKm;

    const legDurationsMin: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const arrival = arrivalsByRunner[r][i];
      if (arrival === null) continue;

      const legStart = i === 0 ? parseClockTimeToSeconds(rows[r][startTodColumn] ?? '') : arrivalsByRunner[r][i - 1];
      if (legStart === null || legStart === undefined) continue;

      const durationMin = (arrival - legStart) / 60;
      if (durationMin > 0) legDurationsMin.push(durationMin);
    }

    let medianPaceMinPerKm: number | null = null;
    let plausible = true;
    let warning: string | undefined;

    if (legDurationsMin.length === 0) {
      plausible = false;
      warning = `No valid arrival times found for "${checkpoint.name}" (${trimmedSplitColumns[i].splitColumn}).`;
    } else if (legKm <= 0) {
      plausible = false;
      warning = `"${checkpoint.name}" is not further along the course than the previous checkpoint — cannot validate pace.`;
    } else {
      const medianDurationMin = median(legDurationsMin);
      medianPaceMinPerKm = medianDurationMin / legKm;
      if (medianPaceMinPerKm < paceBounds.minMinPerKm || medianPaceMinPerKm > paceBounds.maxMinPerKm) {
        plausible = false;
        warning = `Median pace into "${checkpoint.name}" (${medianPaceMinPerKm.toFixed(2)} min/km) falls outside the plausible range [${paceBounds.minMinPerKm}, ${paceBounds.maxMinPerKm}] min/km — check that ${trimmedSplitColumns[i].splitColumn} really corresponds to this checkpoint.`;
      }
    }

    results.push({ splitColumn: trimmedSplitColumns[i].splitColumn, checkpoint, medianPaceMinPerKm, plausible, warning });
    previousKm = checkpoint.kmFromStart;
  }

  return results;
}
