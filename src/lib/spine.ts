import { haversineKm, type CourseVertex } from './geo';

/**
 * One axis for a race that runs several distances over mostly the same ground.
 *
 * A station at the 100 km's kilometre 26.2 and the same station at the 100 miles'
 * kilometre 85.6 are one place, and a director looking at the field wants them in one
 * column. So every course is projected onto the longest one — measured on the real VMM
 * season, 96.8% of the 100 km, 96.9% of the 21 km and 93.6% of the 50 km lie within
 * 80 m of the 100 miles, while the reverse fails badly: the 100 miles is only 66%
 * covered by the 100 km. The spine has to be the longest course, not any course.
 *
 * Ground the spine never touches is reported rather than forced onto it. A third of one
 * real 10 km runs on its own roads, and putting those runners at a plausible-looking
 * kilometre would be inventing a position for them.
 */

export interface SpineSample {
  courseKm: number;
  /** Where that lands on the spine, or null where the spine does not go there. */
  spineKm: number | null;
}

export interface SpineMapping {
  courseName: string;
  samples: SpineSample[];
  /** Share of the course that lies on the spine, 0 to 1. */
  coverage: number;
}

export interface SpineOptions {
  /** How near the spine a point must be to count as on it. */
  toleranceKm?: number;
  /** How often along the course to take a sample. */
  stepKm?: number;
}

const DEFAULT_TOLERANCE_KM = 0.08;
const DEFAULT_STEP_KM = 0.2;

/** Metres per degree, near enough over the tens of kilometres a course spans. */
function localScale(lat: number): { kx: number; ky: number } {
  const ky = 111.32;
  return { kx: ky * Math.cos((lat * Math.PI) / 180), ky };
}

/**
 * Fills in the spine so no two consecutive points are further apart than the tolerance.
 *
 * The lookup finds the nearest spine *point*, not the nearest place on the line between
 * two of them, so a spine whose vertices are half a kilometre apart would report a course
 * running straight down it as half off. A recorded GPX is already denser than any
 * tolerance worth using and this does nothing to it; a hand-drawn route is not.
 */
function densify(spine: CourseVertex[], maxGapKm: number): CourseVertex[] {
  const out: CourseVertex[] = [];
  for (let i = 0; i < spine.length; i++) {
    out.push(spine[i]);
    const next = spine[i + 1];
    if (!next) break;

    const gap = next.cumulativeKm - spine[i].cumulativeKm;
    const steps = Math.floor(gap / maxGapKm);
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1);
      out.push({
        lat: spine[i].lat + (next.lat - spine[i].lat) * t,
        lon: spine[i].lon + (next.lon - spine[i].lon) * t,
        cumulativeKm: spine[i].cumulativeKm + gap * t,
      });
    }
  }
  return out;
}

/**
 * Buckets the spine's vertices by position so a lookup reads a handful of neighbours
 * rather than all 65,699 of them. Without it, mapping five courses onto one is an
 * afternoon's work rather than a moment's.
 */
function buildIndex(spine: CourseVertex[], cellKm: number) {
  const { kx, ky } = localScale(spine[0]?.lat ?? 0);
  const cells = new Map<string, { x: number; y: number; km: number }[]>();
  for (const vertex of spine) {
    const x = vertex.lon * kx;
    const y = vertex.lat * ky;
    const key = `${Math.floor(x / cellKm)},${Math.floor(y / cellKm)}`;
    const bucket = cells.get(key);
    const entry = { x, y, km: vertex.cumulativeKm };
    if (bucket) bucket.push(entry);
    else cells.set(key, [entry]);
  }
  return { cells, kx, ky, cellKm };
}

export function mapToSpine(
  course: CourseVertex[],
  spine: CourseVertex[],
  courseName: string,
  options: SpineOptions = {}
): SpineMapping {
  const tolerance = options.toleranceKm ?? DEFAULT_TOLERANCE_KM;
  const step = options.stepKm ?? DEFAULT_STEP_KM;

  if (course.length < 2 || spine.length < 2) {
    return { courseName, samples: [], coverage: 0 };
  }

  const index = buildIndex(densify(spine, tolerance / 2), Math.max(tolerance * 2, 0.1));
  const samples: SpineSample[] = [];
  let on = 0;

  let next = 0;
  for (const vertex of course) {
    if (vertex.cumulativeKm < next && vertex !== course[course.length - 1]) continue;
    next = vertex.cumulativeKm + step;

    const x = vertex.lon * index.kx;
    const y = vertex.lat * index.ky;
    const cx = Math.floor(x / index.cellKm);
    const cy = Math.floor(y / index.cellKm);

    let bestKm: number | null = null;
    let bestDistance = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const point of index.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const distance = Math.hypot(x - point.x, y - point.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestKm = point.km;
          }
        }
      }
    }

    const onSpine = bestKm !== null && bestDistance <= tolerance;
    if (onSpine) on += 1;
    samples.push({ courseKm: vertex.cumulativeKm, spineKm: onSpine ? bestKm : null });
  }

  return { courseName, samples, coverage: samples.length === 0 ? 0 : on / samples.length };
}

/**
 * Where a position on one course sits on the spine, or null where the spine does not
 * reach it.
 *
 * Interpolated between the two nearest samples only while both are on the spine. Across
 * a gap the two ends belong to different roads, and averaging them would place a runner
 * somewhere neither of them is.
 */
export function spineKmOf(mapping: SpineMapping, courseKm: number): number | null {
  const samples = mapping.samples;
  if (samples.length === 0) return null;
  if (courseKm <= samples[0].courseKm) return samples[0].spineKm;
  if (courseKm >= samples[samples.length - 1].courseKm) return samples[samples.length - 1].spineKm;

  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].courseKm <= courseKm) low = mid;
    else high = mid;
  }

  const a = samples[low];
  const b = samples[high];
  if (a.spineKm === null || b.spineKm === null) return a.spineKm ?? b.spineKm ?? null;

  const span = b.courseKm - a.courseKm;
  if (span <= 0) return a.spineKm;
  const t = (courseKm - a.courseKm) / span;
  return a.spineKm + t * (b.spineKm - a.spineKm);
}

/** Total length of a course, for callers holding vertices rather than a Course. */
export function lengthOf(course: CourseVertex[]): number {
  return course.length === 0 ? 0 : course[course.length - 1].cumulativeKm;
}

/** Straight-line distance between two vertices, exposed for tests and sanity checks. */
export const vertexDistanceKm = haversineKm;
