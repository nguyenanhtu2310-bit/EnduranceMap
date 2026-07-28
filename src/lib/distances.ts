/**
 * How far a contest actually was.
 *
 * Working a distance out from finishing times is circular — the times are divided by the
 * distance to get pace, so a slow field reads as a short course. Where a results file
 * states a pace or a speed the distance stops being a guess: duration multiplied by rate
 * is arithmetic on the organiser's own numbers. Across real exports of several thousand
 * athletes the answers agree to within a third of a percent.
 *
 * That matters because names are not merely vague, they are wrong. A trail race sold as
 * "Ultra 70km" measured 66.02 km and its "5KM" measured 5.58 — a race is named for what
 * sells, not for what was run.
 */

/** A rate as a results file writes it, normalized to seconds per kilometre. */
export interface Rate {
  secondsPerKm: number;
  /** How it was written, for the note shown to the operator. */
  written: string;
}

const PER_KM = /^\s*(\d{1,3}):(\d{2})\s*(?:\/\s*km|min\s*\/\s*km)?\s*$/i;
const PER_100M = /^\s*(\d{1,3}):(\d{2})\s*\/\s*100\s*m\s*$/i;
const KMH = /^\s*([\d.]+)\s*(?:km\/h|kph|kmh)\s*$/i;
const MPH = /^\s*([\d.]+)\s*mph\s*$/i;

/**
 * Reads "4:01/km", "1:35/100m", "34.7 km/h" or a bare "5:20".
 *
 * A bare mm:ss is treated as minutes per kilometre, which is what a running export means
 * by an unlabelled pace; a swim column always labels its 100 m.
 */
export function parseRate(text: string | undefined): Rate | null {
  const written = (text ?? '').trim();
  if (!written) return null;

  const per100 = written.match(PER_100M);
  if (per100) return { secondsPerKm: (Number(per100[1]) * 60 + Number(per100[2])) * 10, written };

  const kmh = written.match(KMH);
  if (kmh) {
    const speed = Number(kmh[1]);
    return speed > 0 ? { secondsPerKm: 3600 / speed, written } : null;
  }

  const mph = written.match(MPH);
  if (mph) {
    const speed = Number(mph[1]) * 1.609344;
    return speed > 0 ? { secondsPerKm: 3600 / speed, written } : null;
  }

  const perKm = written.match(PER_KM);
  if (perKm) {
    const seconds = Number(perKm[1]) * 60 + Number(perKm[2]);
    return seconds > 0 ? { secondsPerKm: seconds, written } : null;
  }

  return null;
}

export interface Measurement {
  km: number;
  /** Athletes the measurement rests on. */
  count: number;
  /**
   * How much the answers disagree, p10 to p90 as a fraction of the median. Rounding in
   * the file's own pace column puts this around 0.003; anything large means the group
   * holds more than one distance.
   */
  spread: number;
  /** True when the spread is small enough for one number to describe the whole group. */
  consistent: boolean;
}

/** Above this the group is holding several courses at once, and no single number fits. */
export const MIXED_DISTANCE_SPREAD = 0.05;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/**
 * The distance implied by pairing each athlete's duration with the rate stated for them.
 *
 * Returns null when too few athletes carry both, since a handful of rows is not enough to
 * tell a real measurement from a stray value.
 */
export function measureDistanceKm(
  pairs: { seconds: number; rate: string | undefined }[],
  minimumAthletes = 5
): Measurement | null {
  const implied: number[] = [];
  for (const { seconds, rate } of pairs) {
    const parsed = parseRate(rate);
    if (!parsed || !(seconds > 0)) continue;
    implied.push(seconds / parsed.secondsPerKm);
  }
  if (implied.length < minimumAthletes) return null;

  implied.sort((a, b) => a - b);
  const km = quantile(implied, 0.5);
  if (!(km > 0)) return null;

  const spread = (quantile(implied, 0.9) - quantile(implied, 0.1)) / km;
  return { km, count: implied.length, spread, consistent: spread <= MIXED_DISTANCE_SPREAD };
}

/**
 * Picks the duration column whose pairing with the rate agrees most tightly.
 *
 * A file may carry both a gun time and a chip time while stating only one pace; pairing
 * the wrong one scatters the answers, so the tighter pairing is the right one and the
 * choice needs no configuration.
 */
export function measureFromCandidates(
  candidates: { label: string; pairs: { seconds: number; rate: string | undefined }[] }[],
  minimumAthletes = 5
): { measurement: Measurement; from: string } | null {
  let best: { measurement: Measurement; from: string } | null = null;
  for (const candidate of candidates) {
    const measurement = measureDistanceKm(candidate.pairs, minimumAthletes);
    if (!measurement) continue;
    if (!best || measurement.spread < best.measurement.spread) {
      best = { measurement, from: candidate.label };
    }
  }
  return best;
}

/** Where a distance came from, worst evidence last. */
export type DistanceSource = 'operator' | 'measured' | 'name' | 'splits' | 'times' | 'unknown';

export interface ResolvedDistance {
  km: number;
  source: DistanceSource;
  /** Arithmetic on stated rates rather than an inference from how fast the field looked. */
  measured: boolean;
  note: string;
}

/** Rounds a measured distance to a sane precision without pretending to millimetres. */
export function tidyKm(km: number): number {
  return km >= 10 ? Number(km.toFixed(1)) : Number(km.toFixed(2));
}

/** Column names a results file uses for an overall pace. */
export const PACE_COLUMN_NAMES = [
  'Average Pace',
  'AveragePace',
  'Avg Pace',
  'Finish Pace',
  'FinishPace',
  'Pace',
];
