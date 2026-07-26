import { buildCourse, haversineKm, snapToCourse, type CourseVertex } from './geo';
import type { RawCourse, RawPlacemark } from './kml';
import {
  DEFAULT_COINCIDENT_STATION_TOLERANCE_KM,
  DEFAULT_LABEL_MISMATCH_THRESHOLD_KM,
  DEFAULT_MAX_MATCH_OFFSET_KM,
  DEFAULT_SNAP_OFFSET_WARNING_KM,
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
}

export interface SnappedPlacemark extends RawPlacemark {
  /** One entry per course this placemark sits on (closest, plus any others within tolerance). */
  snaps: CourseSnap[];
  labelMismatch?: { computedKm: number; labeledKm: number; deltaKm: number };
}

export function buildCourses(rawCourses: RawCourse[]): Course[] {
  return rawCourses.map((rc) => {
    const vertices = buildCourse(rc.points);
    return { name: rc.name, vertices, totalKm: vertices[vertices.length - 1]?.cumulativeKm ?? 0 };
  });
}

/**
 * Snaps every placemark to the course(s) it lies on. A placemark near more than one
 * course line (within `snapOffsetWarningKm` of the closest) is treated as a checkpoint
 * shared by multiple distances — the same GPS point mapping to a different km-from-start
 * on each course.
 */
export function snapPlacemarks(
  placemarks: RawPlacemark[],
  courses: Course[],
  options: {
    snapOffsetWarningKm?: number;
    labelMismatchThresholdKm?: number;
    maxMatchOffsetKm?: number;
  } = {}
): SnappedPlacemark[] {
  const snapOffsetWarningKm = options.snapOffsetWarningKm ?? DEFAULT_SNAP_OFFSET_WARNING_KM;
  const labelMismatchThresholdKm = options.labelMismatchThresholdKm ?? DEFAULT_LABEL_MISMATCH_THRESHOLD_KM;
  const maxMatchOffsetKm = options.maxMatchOffsetKm ?? DEFAULT_MAX_MATCH_OFFSET_KM;

  return placemarks.map((placemark) => {
    const allSnaps: CourseSnap[] = [];
    for (const course of courses) {
      const snap = snapToCourse(placemark.coord, course.vertices);
      if (snap && snap.offsetKm <= maxMatchOffsetKm) {
        allSnaps.push({ courseName: course.name, kmFromStart: snap.kmFromStart, offsetKm: snap.offsetKm });
      }
    }
    allSnaps.sort((a, b) => a.offsetKm - b.offsetKm);

    if (allSnaps.length === 0) {
      return { ...placemark, snaps: [] };
    }

    const proximityThresholdKm = Math.max(allSnaps[0].offsetKm, snapOffsetWarningKm);
    const snaps = allSnaps.filter((s) => s.offsetKm <= proximityThresholdKm);

    let labelMismatch: SnappedPlacemark['labelMismatch'];
    if (placemark.label.kmFromName !== undefined) {
      const closest = snaps[0];
      const deltaKm = Math.abs(closest.kmFromStart - placemark.label.kmFromName);
      if (deltaKm > labelMismatchThresholdKm) {
        labelMismatch = { computedKm: closest.kmFromStart, labeledKm: placemark.label.kmFromName, deltaKm };
      }
    }

    return { ...placemark, snaps, labelMismatch };
  });
}

export interface GroupedStation {
  name: string;
  members: SnappedPlacemark[];
  /** Deduped snaps across all members, one per course (closest offset wins), sorted by km. */
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
    const byCourse = new Map<string, CourseSnap>();
    for (const member of group.members) {
      for (const snap of member.snaps) {
        const existing = byCourse.get(snap.courseName);
        if (!existing || snap.offsetKm < existing.offsetKm) byCourse.set(snap.courseName, snap);
      }
    }
    group.snaps = Array.from(byCourse.values()).sort((a, b) => a.kmFromStart - b.kmFromStart);
  }

  return groups;
}
