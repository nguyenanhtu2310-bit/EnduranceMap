import { buildCourse, findCourseCrossings, haversineKm, snapToCourse, type CourseVertex } from './geo';
import type { RawCourse, RawPlacemark } from './kml';
import {
  DEFAULT_COINCIDENT_STATION_TOLERANCE_KM,
  DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM,
  DEFAULT_CROSSING_MAX_OFFSET_KM,
  DEFAULT_CROSSING_MIN_SEPARATION_KM,
  DEFAULT_DUPLICATE_PASS_TOLERANCE_KM,
  DEFAULT_LABEL_MISMATCH_THRESHOLD_KM,
} from './config';

export interface Course {
  name: string;
  vertices: CourseVertex[];
  totalKm: number;
}

export interface CourseSnap {
  courseName: string;
  kmFromStart: number;
  /** Perpendicular offset from the course line, in km — for QA / debugging. */
  offsetKm: number;
  /** 0-based index of this pass when a course crosses the same point more than once. */
  passIndex: number;
  /** Total number of passes this course makes at this point. */
  passCount: number;
}

export interface LabelMismatch {
  courseName: string;
  computedKm: number;
  labeledKm: number;
  deltaKm: number;
}

export interface SnappedPlacemark extends RawPlacemark {
  /** Every course pass at this placemark; a course may appear more than once (out-and-back). */
  snaps: CourseSnap[];
  /** Km labels in the name that could not be reconciled with any computed crossing. */
  labelMismatches: LabelMismatch[];
}

export function buildCourses(rawCourses: RawCourse[]): Course[] {
  return rawCourses.map((rc) => {
    const vertices = buildCourse(rc.points);
    return { name: rc.name, vertices, totalKm: vertices[vertices.length - 1]?.cumulativeKm ?? 0 };
  });
}

/**
 * Finds the course whose measured length matches a race distance named in a label
 * (e.g. the "/42" in "KM7.4/42"). Matching on measured length rather than course name
 * avoids having to interpret names like "Marathon" or "Half Marathon" as numbers, and
 * tolerates the ~0.5% that GPS-traced routes run long versus their official distance.
 */
export function matchCourseByDistance(
  courses: Course[],
  raceDistanceKm: number,
  toleranceKm: number = DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM
): Course | undefined {
  // Advertised distances are marketing as much as measurement — a trail "70K" routinely
  // measures 66 km, because a rounder number sells better. A flat tolerance that suits a
  // road 10K would reject that, so it also scales with the distance being matched.
  const allowedKm = Math.max(toleranceKm, raceDistanceKm * 0.08);

  let best: Course | undefined;
  let bestDelta = Infinity;
  for (const course of courses) {
    const delta = Math.abs(course.totalKm - raceDistanceKm);
    if (delta <= allowedKm && delta < bestDelta) {
      best = course;
      bestDelta = delta;
    }
  }
  return best;
}

export interface SnapOptions {
  crossingMaxOffsetKm?: number;
  crossingMinSeparationKm?: number;
  labelMismatchThresholdKm?: number;
  courseDistanceToleranceKm?: number;
}

/**
 * Locates every placemark on every course it lies on. A single placemark can produce
 * several snaps for the same course when that course passes it more than once, and
 * snaps on several courses when distances share a checkpoint.
 *
 * Km labels in the name are validated against the course that the label itself names
 * (via its "/42"-style distance suffix), not merely the closest line — checking a
 * "/10" label against the marathon route would flag a false mismatch.
 */
export function snapPlacemarks(
  placemarks: RawPlacemark[],
  courses: Course[],
  options: SnapOptions = {}
): SnappedPlacemark[] {
  const crossingMaxOffsetKm = options.crossingMaxOffsetKm ?? DEFAULT_CROSSING_MAX_OFFSET_KM;
  const crossingMinSeparationKm = options.crossingMinSeparationKm ?? DEFAULT_CROSSING_MIN_SEPARATION_KM;
  const labelMismatchThresholdKm = options.labelMismatchThresholdKm ?? DEFAULT_LABEL_MISMATCH_THRESHOLD_KM;
  const courseDistanceToleranceKm = options.courseDistanceToleranceKm ?? DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM;

  return placemarks.map((placemark) => {
    const snaps: CourseSnap[] = [];

    for (const course of courses) {
      const crossings = findCourseCrossings(placemark.coord, course.vertices, {
        maxOffsetKm: crossingMaxOffsetKm,
        minSeparationKm: crossingMinSeparationKm,
      });
      crossings.forEach((crossing, index) =>
        snaps.push({
          courseName: course.name,
          kmFromStart: crossing.kmFromStart,
          offsetKm: crossing.offsetKm,
          passIndex: index,
          passCount: crossings.length,
        })
      );
    }

    snaps.sort((a, b) => a.offsetKm - b.offsetKm || a.kmFromStart - b.kmFromStart);

    const labelMismatches: LabelMismatch[] = [];
    for (const mark of placemark.label.kmMarks) {
      // Prefer the course the label itself names; fall back to all courses if unnamed.
      const target = mark.raceDistanceKm
        ? matchCourseByDistance(courses, mark.raceDistanceKm, courseDistanceToleranceKm)
        : undefined;
      const candidates = target ? snaps.filter((s) => s.courseName === target.name) : snaps;
      if (candidates.length === 0) continue;

      // A label is satisfied by whichever pass it is closest to.
      let closest = candidates[0];
      for (const candidate of candidates) {
        if (Math.abs(candidate.kmFromStart - mark.km) < Math.abs(closest.kmFromStart - mark.km)) closest = candidate;
      }

      const deltaKm = Math.abs(closest.kmFromStart - mark.km);
      if (deltaKm > labelMismatchThresholdKm) {
        labelMismatches.push({
          courseName: closest.courseName,
          computedKm: closest.kmFromStart,
          labeledKm: mark.km,
          deltaKm,
        });
      }
    }

    return { ...placemark, snaps, labelMismatches };
  });
}

/** Nearest position on each course regardless of distance — for diagnosing placemarks that snapped nowhere. */
export function nearestOnEachCourse(placemark: RawPlacemark, courses: Course[]): CourseSnap[] {
  const results: CourseSnap[] = [];
  for (const course of courses) {
    const snap = snapToCourse(placemark.coord, course.vertices);
    if (snap) {
      results.push({
        courseName: course.name,
        kmFromStart: snap.kmFromStart,
        offsetKm: snap.offsetKm,
        passIndex: 0,
        passCount: 1,
      });
    }
  }
  return results.sort((a, b) => a.offsetKm - b.offsetKm);
}

export interface GroupedStation {
  name: string;
  members: SnappedPlacemark[];
  /** Every course pass across all members, deduped by course+km, sorted by km. */
  snaps: CourseSnap[];
}


/**
 * What a placemark's own name says it is: the start of something, the finish of
 * something, both, or neither.
 *
 * A name carrying both words — "SWIM START/FINISH" — is a point that genuinely does both
 * jobs, and stays one point.
 */
type PointRole = 'start' | 'finish' | 'both' | 'none';

const START_WORDS = /\b(start|xu[aâấ]t\s*ph[aáát]t)\b/i;
const FINISH_WORDS = /\b(finish|fnish|v[eề]\s*[dđ][iíich]+|[dđ][iíich]{2,})\b/i;

function pointRole(name: string): PointRole {
  const isStart = START_WORDS.test(name);
  const isFinish = FINISH_WORDS.test(name);
  if (isStart && isFinish) return 'both';
  if (isStart) return 'start';
  if (isFinish) return 'finish';
  return 'none';
}

/**
 * Whether two placemarks close together are the same job or two different ones.
 *
 * A start line and a finish line are often within metres of each other — Quang Tri put a
 * run start and a run finish twenty-four metres apart, across one intersection — and
 * merging them produced a station that opened when the first wave set off and closed
 * when the last athlete came home, with a peak belonging to neither. No distance
 * threshold separates those safely: the same map has a finish drawn twice at the very
 * same spot, and a swim start/finish typed twice eight metres apart, both of which
 * genuinely are one point. What tells them apart is not how far apart they sit but what
 * the organiser called them.
 */
function sameJob(a: string, b: string): boolean {
  const left = pointRole(a);
  const right = pointRole(b);
  return !((left === 'start' && right === 'finish') || (left === 'finish' && right === 'start'));
}

/**
 * Merges placemarks that sit within `toleranceKm` of one another into a single logical
 * station. Race organizers sometimes draw a separate point per distance at what is
 * physically the same checkpoint; this recovers that as one shared station.
 */
export function groupCoincidentPlacemarks(
  placemarks: SnappedPlacemark[],
  toleranceKm: number = DEFAULT_COINCIDENT_STATION_TOLERANCE_KM,
  duplicatePassToleranceKm: number = DEFAULT_DUPLICATE_PASS_TOLERANCE_KM
): GroupedStation[] {
  const groups: GroupedStation[] = [];

  for (const placemark of placemarks) {
    /*
     * An asserted identity wins over the guess from proximity, and then proximity still
     * applies.
     *
     * The first half is what lets a station typed once per distance arrive as one station
     * even where the two published kilometres land half a kilometre apart — nothing else
     * can join those without also joining two stations that merely sit near each other.
     *
     * The second half matters just as much: without the fallback, a typed station could
     * never join a pin on the map, even standing on it. Someone who has both a KML and a
     * distance table would get two stations at one tent and no way to say they were the
     * same, which is the bug this whole mechanism exists to prevent, arriving from the
     * other direction.
     */
    const byIdentity = placemark.stationId
      ? groups.find((g) => g.members.some((m) => m.stationId === placemark.stationId))
      : undefined;
    const existing =
      byIdentity ??
      groups.find((g) =>
        g.members.some(
          (m) =>
            // Two members that each assert an identity and disagree are two stations,
            // whatever the distance between them says.
            !(m.stationId && placemark.stationId && m.stationId !== placemark.stationId) &&
            haversineKm(m.coord, placemark.coord) <= toleranceKm &&
            sameJob(m.name, placemark.name)
        )
      );
    if (existing) {
      existing.members.push(placemark);
    } else {
      groups.push({ name: placemark.label.cleanName || placemark.name, members: [placemark], snaps: [] });
    }
  }

  for (const group of groups) {
    // Members of one station describe the same physical spot, so their snaps overlap.
    // Collapse snaps of the same course that land within `duplicatePassToleranceKm` of
    // each other — those are one pass seen twice — while keeping genuinely distinct
    // passes (an outbound and a return leg many km apart) separate.
    const byCourse = new Map<string, CourseSnap[]>();
    for (const member of group.members) {
      for (const snap of member.snaps) {
        if (!byCourse.has(snap.courseName)) byCourse.set(snap.courseName, []);
        byCourse.get(snap.courseName)!.push(snap);
      }
    }

    const deduped: CourseSnap[] = [];
    for (const courseSnaps of byCourse.values()) {
      courseSnaps.sort((a, b) => a.kmFromStart - b.kmFromStart);
      let cluster: CourseSnap[] = [];

      const flush = () => {
        if (cluster.length === 0) return;
        let best = cluster[0];
        for (const c of cluster) if (c.offsetKm < best.offsetKm) best = c;
        deduped.push(best);
      };

      for (const snap of courseSnaps) {
        const previous = cluster[cluster.length - 1];
        if (previous && snap.kmFromStart - previous.kmFromStart > duplicatePassToleranceKm) {
          flush();
          cluster = [];
        }
        cluster.push(snap);
      }
      flush();
    }

    group.snaps = deduped.sort((a, b) => a.kmFromStart - b.kmFromStart);

    // A merged station carries every distinct source name, so an operator can see that
    // e.g. a signage post and a cut-off mat share one physical position.
    const names = Array.from(new Set(group.members.map((m) => m.label.cleanName || m.name)));
    group.name = names.join(' / ');
  }

  return groups;
}
