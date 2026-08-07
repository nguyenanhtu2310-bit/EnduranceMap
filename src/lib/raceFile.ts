import type { ContestSplits, MeasuredSplits } from './measuredSplits';

/**
 * Turning a race into a file, and back.
 *
 * JSON has no Map. `JSON.stringify(new Map([['a', [1]]]))` is `{}` — not an error, not a
 * warning, just an empty object where the data was. Everything about that failure is
 * quiet: the file saves, it is the right size, it opens, and the field that mattered is
 * gone. Worse, what comes back is a plain object where the code expects something
 * iterable, so the first `for (const [k, v] of ...)` throws and takes the whole app down
 * with it — after an hour of configuration and with no clue as to which field did it.
 *
 * So the conversion is explicit and in one place, and there is a round-trip test standing
 * over it. Anything added to a saved race that is not plain JSON has to be handled here
 * or it will fail the same way.
 */

/** A contest's splits as they can actually be written to a file. */
interface EncodedContestSplits extends Omit<ContestSplits, 'arrivalsBySplit'> {
  arrivalsBySplit: [string, number[]][];
}

export interface EncodedMeasuredSplits {
  contests: EncodedContestSplits[];
  warnings: string[];
}

/** The results as held in memory: splits keyed by a Map. */
export interface LoadedResultsLike {
  splits?: MeasuredSplits;
  [key: string]: unknown;
}

/** The same, with every Map flattened to the entries JSON can carry. */
export interface EncodedResultsLike {
  splits?: EncodedMeasuredSplits;
  [key: string]: unknown;
}

export function encodeSplits(splits: MeasuredSplits): EncodedMeasuredSplits {
  return {
    warnings: splits.warnings,
    contests: splits.contests.map((contest) => ({
      ...contest,
      arrivalsBySplit: [...contest.arrivalsBySplit],
    })),
  };
}

/**
 * Rebuilds the Map, from entries or from anything else without complaint.
 *
 * Tolerant on purpose. Files written before this existed hold `{}` where the entries
 * should be, and the right answer for them is an empty Map and a race that opens — not a
 * crash, and not a refusal to open a file whose other twenty fields are perfectly good.
 */
export function decodeSplits(splits: EncodedMeasuredSplits | MeasuredSplits): MeasuredSplits {
  return {
    warnings: Array.isArray(splits.warnings) ? splits.warnings : [],
    contests: (Array.isArray(splits.contests) ? splits.contests : []).map((contest) => ({
      ...(contest as ContestSplits),
      arrivalsBySplit: toMap((contest as EncodedContestSplits).arrivalsBySplit),
    })),
  };
}

function toMap(value: unknown): Map<string, number[]> {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value as [string, number[]][]);
  // An object is what a Map became on its way through an older file. Its keys are the
  // splits and its values were lost, so it yields nothing rather than pretending.
  return new Map();
}

/** Prepares the loaded results for writing, leaving everything else untouched. */
export function encodeResults<T extends LoadedResultsLike | null>(results: T): unknown {
  if (!results || !results.splits) return results;
  return { ...results, splits: encodeSplits(results.splits) };
}

/** Restores what `encodeResults` flattened. */
export function decodeResults<T extends EncodedResultsLike | null>(results: T): unknown {
  if (!results || !results.splits) return results;
  return { ...results, splits: decodeSplits(results.splits) };
}
