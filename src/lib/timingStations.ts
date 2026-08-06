import type { CourseVertex, LatLon } from './geo';
import type { RawPlacemark } from './kml';
import { parsePlacemarkLabel } from './labels';
import type { TimingPoint } from './timingPoints';

/**
 * Stations built from the timing configuration alone, with no map drawn for them.
 *
 * A timing point already says how far along the course it sits, and a route file already
 * says what is at any distance along that course. Between them the mat's position on the
 * ground is determined — so for a race that only cares about timing, the map has nothing
 * left to contribute and does not have to exist.
 *
 * This is the better of the two paths where it applies. Snapping hand-dropped pins to a
 * route brings a tolerance, a matching table to review, and pins named "Điểm 6" three
 * times over; the timing system simply states where it reads chips.
 */

/** The folder synthesised stations are filed under, so they read as one group on screen. */
export const TIMING_FOLDER = 'TIMING POINTS';

/**
 * How far apart two courses may place the same mat before it is worth reporting.
 *
 * Set against the method rather than against hope. Declared distances are stretched onto
 * each course's measured length by one proportion, and that proportion is not the whole
 * relationship: on real files the residual drifts from about 200 m over the first half of
 * a course to 900 m over the second. So two courses independently placing one mat land a
 * few hundred metres apart as a matter of course, and a tighter bound here would report
 * the tool's own approximation as though it were the operator's mistake.
 */
const AGREEMENT_TOLERANCE_KM = 1.2;

export interface TimingStationResult {
  placemarks: RawPlacemark[];
  warnings: string[];
}

/** The point on a course at a given distance along it, interpolated between vertices. */
export function positionAtKm(course: CourseVertex[], km: number): LatLon | null {
  if (course.length === 0) return null;
  if (km <= course[0].cumulativeKm) return { lat: course[0].lat, lon: course[0].lon };

  const last = course[course.length - 1];
  if (km >= last.cumulativeKm) return { lat: last.lat, lon: last.lon };

  let low = 0;
  let high = course.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (course[mid].cumulativeKm <= km) low = mid;
    else high = mid;
  }

  const a = course[low];
  const b = course[high];
  const span = b.cumulativeKm - a.cumulativeKm;
  if (span <= 0) return { lat: a.lat, lon: a.lon };

  const t = (km - a.cumulativeKm) / span;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Rough kilometres between two points, for checking two courses agree about a mat. */
function gapKm(a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 111.32);
}

/**
 * One placemark per physical mat, positioned from whichever courses read it.
 *
 * Per mat rather than per timing point on purpose: a course that reads the same mat twice
 * is one place visited twice, and the crossing logic downstream already finds both passes
 * from one position. Making two placemarks would make two stations out of one tent.
 *
 * Where several courses name the same mat, all of them are asked where it is and any
 * disagreement is reported. They should agree — the declared distances are scaled onto
 * each course's own measured length first — and where they do not, either a course has
 * moved or a distance in the configuration is wrong, both of which are worth knowing
 * before a crew is sent there.
 */
export function timingStations(
  pointsByCourse: Record<string, TimingPoint[]>,
  coursesByName: Map<string, CourseVertex[]>
): TimingStationResult {
  const warnings: string[] = [];
  const byMat = new Map<
    string,
    { label: string; positions: LatLon[]; courses: string[]; best: LatLon; bestPoints: number }
  >();

  for (const [courseName, points] of Object.entries(pointsByCourse)) {
    const course = coursesByName.get(courseName);
    if (!course || course.length < 2 || points.length === 0) continue;

    const declared = points.reduce((far, p) => Math.max(far, p.kmFromStart), 0);
    const measured = course[course.length - 1].cumulativeKm;
    // The timing system's distances and the route's own measurement disagree by a few
    // percent, so the declared kilometres are stretched onto the measured ones first.
    // This takes the furthest timing point for the course's declared length, which every
    // real export satisfies — the finish line is the last thing a race reads.
    const scale = declared > 0 ? measured / declared : 1;

    for (const point of points) {
      const coord = positionAtKm(course, point.kmFromStart * scale);
      if (!coord) continue;
      const key = point.mat || point.name;
      const entry = byMat.get(key);
      if (entry) {
        entry.positions.push(coord);
        if (!entry.courses.includes(courseName)) entry.courses.push(courseName);
        // The course reading the most mats has the best-determined scale — two points
        // fix a proportion through the finish and nothing in between.
        if (points.length > entry.bestPoints) {
          entry.best = coord;
          entry.bestPoints = points.length;
        }
      } else {
        byMat.set(key, {
          label: point.label || point.name,
          positions: [coord],
          courses: [courseName],
          best: coord,
          bestPoints: points.length,
        });
      }
    }
  }

  const placemarks: RawPlacemark[] = [];
  for (const [mat, entry] of byMat) {
    const first = entry.positions[0];
    let worst = 0;
    for (const position of entry.positions) worst = Math.max(worst, gapKm(first, position));
    if (worst > AGREEMENT_TOLERANCE_KM) {
      warnings.push(
        `"${entry.label}" is placed ${(worst * 1000).toFixed(0)} m apart by ` +
          `${entry.courses.join(' and ')} — check the distance each gives it.`
      );
    }

    placemarks.push({
      name: entry.label,
      folder: TIMING_FOLDER,
      coord: entry.best,
      label: parsePlacemarkLabel(entry.label),
    });
    void mat;
  }

  return { placemarks, warnings };
}
