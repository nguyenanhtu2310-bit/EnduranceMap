import { buildCourse, findCourseCrossings, haversineKm, snapToCourse, type CourseVertex } from './geo';
import type { RawCourse, RawPlacemark } from './kml';
import {
  DEFAULT_COINCIDENT_STATION_TOLERANCE_KM,
  DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM,
  DEFAULT_CROSSING_MAX_OFFSET_KM,
  DEFAULT_CROSSING_MIN_SEPARATION_KM,
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
  let best: Course | undefined;
  let bestDelta = Infinity;
  for (const course of courses) {
    const delta = Math.abs(course.totalKm - raceDistanceKm);
    if (delta <= toleranceKm && delta < bestDelta) {
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
 * Merges placemarks that sit within `toleranceKm` of one another into a single logical
 * station. Race organizers sometimes draw a separate point per distance at what is
 * physically the same checkpoint; this recovers that as one shared station.
 */
export function groupCoincidentPlacemarks(
  placemarks: SnappedPlacemark[],
  toleranceKm: number = DEFAULT_COINCIDENT_STATION_TOLERANCE_KM
): GroupedStation[] {
  const groups: GroupedStation[] = [];

  for (const placemark of placemarks) {
    const existing = groups.find((g) => g.members.some((m) => haversineKm(m.coord, placemark.coord) <= toleranceKm));
    if (existing) {
      existing.members.push(placemark);
    } else {
      groups.push({ name: placemark.label.cleanName || placemark.name, members: [placemark], snaps: [] });
    }
  }

  for (const group of groups) {
    // Key on course plus rounded km so two members describing the same pass collapse,
    // while genuinely distinct passes of one course are both kept.
    const byPass = new Map<string, CourseSnap>();
    for (const member of group.members) {
      for (const snap of member.snaps) {
        const key = `${snap.courseName}@${snap.kmFromStart.toFixed(1)}`;
        const existing = byPass.get(key);
        if (!existing || snap.offsetKm < existing.offsetKm) byPass.set(key, snap);
      }
    }
    group.snaps = Array.from(byPass.values()).sort((a, b) => a.kmFromStart - b.kmFromStart);
  }

  return groups;
}
