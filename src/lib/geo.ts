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

/**
 * Snaps an arbitrary point to the nearest position on a course polyline, returning
 * the km-from-start of that position and how far off the line the point actually is.
 */
export function snapToCourse(point: LatLon, course: CourseVertex[]): SnapResult | null {
  if (course.length < 2) return null;

  let best: SnapResult | null = null;

  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i];
    const b = course[i + 1];
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
    const offsetKm = Math.hypot(pP.x - projX, pP.y - projY);

    const segmentKm = b.cumulativeKm - a.cumulativeKm;
    const kmFromStart = a.cumulativeKm + t * segmentKm;

    if (!best || offsetKm < best.offsetKm) {
      best = { kmFromStart, offsetKm };
    }
  }

  return best;
}
