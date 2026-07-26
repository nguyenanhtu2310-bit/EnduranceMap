export interface LatLon {
  lat: number;
  lon: number;
}

export interface CourseVertex extends LatLon {
  /** Distance in km from the start of the course, following the polyline. */
  cumulativeKm: number;
}

export interface SnapResult {
  /** Position along the course, in km from the start. */
  kmFromStart: number;
  /** Perpendicular offset from the course line, in km — used to sanity-check bad snaps. */
  offsetKm: number;
}

const EARTH_RADIUS_KM = 6371.0088;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Converts a raw ordered list of course points into vertices carrying cumulative distance. */
export function buildCourse(points: LatLon[]): CourseVertex[] {
  if (points.length === 0) return [];

  const vertices: CourseVertex[] = [{ ...points[0], cumulativeKm: 0 }];
  for (let i = 1; i < points.length; i++) {
    const segmentKm = haversineKm(points[i - 1], points[i]);
    vertices.push({ ...points[i], cumulativeKm: vertices[i - 1].cumulativeKm + segmentKm });
  }
  return vertices;
}

/**
 * Local equirectangular projection around a reference latitude. Race courses span at
 * most tens of km, so per-segment flat-earth math is accurate enough and much cheaper
 * than great-circle projection.
 */
function toLocalXY(point: LatLon, refLat: number): { x: number; y: number } {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(toRad(refLat));
  return {
    x: point.lon * kmPerDegLon,
    y: point.lat * kmPerDegLat,
  };
}

/** Projects a point onto one polyline segment. */
function projectOntoSegment(point: LatLon, a: CourseVertex, b: CourseVertex): SnapResult {
  const refLat = (a.lat + b.lat) / 2;

  const pA = toLocalXY(a, refLat);
  const pB = toLocalXY(b, refLat);
  const pP = toLocalXY(point, refLat);

  const abx = pB.x - pA.x;
  const aby = pB.y - pA.y;
  const segLenSq = abx * abx + aby * aby;

  let t = segLenSq === 0 ? 0 : ((pP.x - pA.x) * abx + (pP.y - pA.y) * aby) / segLenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = pA.x + t * abx;
  const projY = pA.y + t * aby;

  return {
    kmFromStart: a.cumulativeKm + t * (b.cumulativeKm - a.cumulativeKm),
    offsetKm: Math.hypot(pP.x - projX, pP.y - projY),
  };
}

/**
 * Snaps an arbitrary point to the nearest position on a course polyline, returning
 * the km-from-start of that position and how far off the line the point actually is.
 * Only ever reports one position — use `findCourseCrossings` for out-and-back courses
 * where a single physical location is passed more than once.
 */
export function snapToCourse(point: LatLon, course: CourseVertex[]): SnapResult | null {
  if (course.length < 2) return null;

  let best: SnapResult | null = null;
  for (let i = 0; i < course.length - 1; i++) {
    const candidate = projectOntoSegment(point, course[i], course[i + 1]);
    if (!best || candidate.offsetKm < best.offsetKm) best = candidate;
  }
  return best;
}

export interface CrossingOptions {
  /** Perpendicular distance within which the course is considered to pass the point. */
  maxOffsetKm?: number;
  /**
   * Minimum gap along the course between two positions for them to count as separate
   * passes. Prevents adjacent segments near one crossing from being reported repeatedly,
   * while still separating an outbound leg from a return leg many km later.
   */
  minSeparationKm?: number;
}

/**
 * Finds every distinct position at which a course passes a point. Out-and-back and
 * looped courses cross the same physical location more than once — a marathon that
 * passes a checkpoint outbound at 19.5km and again returning at 35.5km needs both,
 * because the return-leg pass is what drives cut-off and teardown decisions.
 */
export function findCourseCrossings(
  point: LatLon,
  course: CourseVertex[],
  options: CrossingOptions = {}
): SnapResult[] {
  const maxOffsetKm = options.maxOffsetKm ?? 0.05;
  const minSeparationKm = options.minSeparationKm ?? 1;

  if (course.length < 2) return [];

  const nearby: SnapResult[] = [];
  for (let i = 0; i < course.length - 1; i++) {
    const candidate = projectOntoSegment(point, course[i], course[i + 1]);
    if (candidate.offsetKm <= maxOffsetKm) nearby.push(candidate);
  }
  if (nearby.length === 0) return [];

  nearby.sort((a, b) => a.kmFromStart - b.kmFromStart);

  // Collapse runs of adjacent near-misses into one crossing each, keeping the closest.
  const crossings: SnapResult[] = [];
  let cluster: SnapResult[] = [nearby[0]];

  const flush = () => {
    let best = cluster[0];
    for (const c of cluster) if (c.offsetKm < best.offsetKm) best = c;
    crossings.push(best);
  };

  for (let i = 1; i < nearby.length; i++) {
    if (nearby[i].kmFromStart - nearby[i - 1].kmFromStart > minSeparationKm) {
      flush();
      cluster = [];
    }
    cluster.push(nearby[i]);
  }
  flush();

  return crossings;
}
