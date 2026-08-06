import type { TimingPoint } from './timingPoints';

/** One pass of one course over one placemark, as the map and the course produce it. */
export interface PlacemarkCrossing {
  /** Whatever identifies this pass uniquely to the caller. */
  key: string;
  /** The name drawn on the map — often a placeholder like "Điểm 5". */
  name: string;
  /** Where the course actually passes it, measured on the course's own geometry. */
  kmFromStart: number;
}

export interface NamedStation {
  crossing: PlacemarkCrossing;
  /** The timing point this pass is, or null where the map pin has no mat on it. */
  timingPoint: TimingPoint | null;
  /** How far apart the two were after scaling, in km. Null where nothing matched. */
  deltaKm: number | null;
}

export interface NamingResult {
  stations: NamedStation[];
  /** Timing points nothing on the map came near — a mat with no pin drawn for it. */
  unmatchedPoints: TimingPoint[];
  /** What the declared kilometres were multiplied by to reach measured ones. */
  scale: number;
}

export interface NamingOptions {
  /** The course's own measured length, from its geometry. */
  measuredTotalKm: number;
  /** What the timing system calls the course. Defaults to its furthest timing point. */
  declaredTotalKm?: number;
  /** How far a pin may sit from its mat, along the course, and still be it. */
  toleranceKm?: number;
}

/**
 * A pin and its mat may be this far apart along the course and still be the same place.
 *
 * Generous on purpose. What is being matched is a hand-drawn pin against a distance the
 * timing system rounded to 100 m, on a course whose two measurements already disagree —
 * none of the three is exact, and none of them needs to be: the nearest timing point is
 * almost always nearer than this and the next one is kilometres away.
 */
const DEFAULT_TOLERANCE_KM = 1.5;

/**
 * Gives every station on the map the name the timing system calls it.
 *
 * Map pins are drawn to mark positions and on real maps they are named "Điểm 5" and
 * "Point 23", because naming twenty-nine of them by hand is nobody's evening. The timing
 * configuration has no such freedom — its names become the columns of the results file —
 * so the pin is matched to it by distance along the course and takes its name from there.
 *
 * The declared kilometres are scaled onto the measured ones first, and that is not a
 * refinement. Across one real season the two disagreed by 2.2% on the 100 km and 5.6% on
 * the 10 km — enough to put the last checkpoint of a 100 km more than two kilometres from
 * where the timer says it is, which is far enough to match the wrong one or nothing at all.
 *
 * Matching is nearest-first across every candidate pair rather than in course order, so
 * two points 50 m apart — a real map has its announcer and its finish line that close —
 * each take the pin they are actually nearest to.
 */
export function nameStations(
  crossings: PlacemarkCrossing[],
  points: TimingPoint[],
  options: NamingOptions
): NamingResult {
  const tolerance = options.toleranceKm ?? DEFAULT_TOLERANCE_KM;
  const declared =
    options.declaredTotalKm ?? points.reduce((furthest, p) => Math.max(furthest, p.kmFromStart), 0);
  const scale = declared > 0 && options.measuredTotalKm > 0 ? options.measuredTotalKm / declared : 1;

  interface Candidate {
    crossingIndex: number;
    pointIndex: number;
    deltaKm: number;
  }

  const candidates: Candidate[] = [];
  points.forEach((point, pointIndex) => {
    const expectedKm = point.kmFromStart * scale;
    crossings.forEach((crossing, crossingIndex) => {
      const deltaKm = Math.abs(crossing.kmFromStart - expectedKm);
      if (deltaKm <= tolerance) candidates.push({ crossingIndex, pointIndex, deltaKm });
    });
  });

  // Closest pair wins outright, then the next closest among what is left. A pin and a mat
  // that are each other's nearest are settled before anything else can claim either.
  candidates.sort((a, b) => a.deltaKm - b.deltaKm);

  const pointForCrossing = new Map<number, Candidate>();
  const takenPoints = new Set<number>();
  for (const candidate of candidates) {
    if (pointForCrossing.has(candidate.crossingIndex)) continue;
    if (takenPoints.has(candidate.pointIndex)) continue;
    pointForCrossing.set(candidate.crossingIndex, candidate);
    takenPoints.add(candidate.pointIndex);
  }

  const stations: NamedStation[] = crossings.map((crossing, index) => {
    const match = pointForCrossing.get(index);
    return {
      crossing,
      timingPoint: match ? points[match.pointIndex] : null,
      deltaKm: match ? match.deltaKm : null,
    };
  });

  return {
    stations,
    unmatchedPoints: points.filter((_, index) => !takenPoints.has(index)),
    scale,
  };
}

/** What to call a station: the timing system's label, or the map's name where it has no mat. */
export function stationLabel(station: NamedStation): string {
  return station.timingPoint?.label || station.crossing.name;
}
