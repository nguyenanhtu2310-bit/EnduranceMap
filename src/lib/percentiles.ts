import { secondsToClockTime } from './time';
import { DEFAULT_PERCENTILES } from './config';

export interface PercentileResult {
  percentile: number;
  seconds: number;
  clockTime: string;
}

/** Linear-interpolation ("R type 7") percentile, matching common spreadsheet PERCENTILE functions. */
export function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) throw new Error('Cannot compute a percentile of an empty array.');
  if (sortedValues.length === 1) return sortedValues[0];

  const rank = (p / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

/** Computes arrival-time percentiles (in clock time) from a set of arrival timestamps (seconds since midnight). */
export function computeArrivalPercentiles(
  arrivalSeconds: number[],
  percentiles: number[] = DEFAULT_PERCENTILES
): PercentileResult[] {
  const sorted = arrivalSeconds.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  return percentiles.map((p) => {
    const seconds = computePercentile(sorted, p);
    return { percentile: p, seconds, clockTime: secondsToClockTime(seconds) };
  });
}
