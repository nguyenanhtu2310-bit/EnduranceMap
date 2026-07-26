import { parseKml, type KmlParseOptions } from './kml';
import {
  buildCourses,
  groupCoincidentPlacemarks,
  matchCourseByDistance,
  snapPlacemarks,
  type Course,
  type CourseSnap,
  type GroupedStation,
  type SnapOptions,
} from './snap';
import {
  arrivalPercentilesFromPaceBand,
  samplePaceModelArrivals,
  type PaceBand,
  type StartField,
} from './paceModel';
import {
  buildCutoffTable,
  buildStationSchedule,
  type CutoffTableRow,
  type DistanceCrossing,
  type ScheduleOptions,
  type StationSchedule,
} from './schedule';
import { DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM } from './config';

/** Manual pace-band and field-size input for one race distance. */
export interface DistanceInput extends PaceBand, StartField {
  courseName: string;
}

/** Folders whose point placemarks represent positions that have to be staffed. */
export const DEFAULT_STATION_FOLDERS = [
  'CUT-OFF TIME',
  'MEDICAL STATION & AMBULANCE',
  'SIGNAGE: STATION',
  'INTERSECTIONS',
  'RACE ROUTE',
];

/** Folder whose unlabeled placemarks are course markers rather than staffed positions. */
const CUTOFF_FOLDER = 'CUT-OFF TIME';

export interface PipelineOptions extends KmlParseOptions, SnapOptions, ScheduleOptions {
  /** Folder names (case-insensitive) whose points are treated as staffed stations. */
  stationFolders?: string[];
  /** Placemark names to exclude from the operational output entirely. */
  excludePlacemarkNames?: string[];
  courseDistanceToleranceKm?: number;
  /** Distance within which separately-drawn placemarks are merged into one station. */
  coincidentToleranceKm?: number;
  /** Samples per distance used to synthesize arrival timestamps from a pace band. */
  paceModelSampleSize?: number;
}

export interface StationCrossingDetail {
  courseName: string;
  kmFromStart: number;
  passIndex: number;
  passCount: number;
  offsetKm: number;
  officialCutoffClock?: string;
}

export interface PipelineStation {
  schedule: StationSchedule;
  folder: string;
  sourceNames: string[];
  crossings: StationCrossingDetail[];
}

export interface PipelineResult {
  courses: Course[];
  stations: PipelineStation[];
  cutoffTable: CutoffTableRow[];
  /** Stations that could not be scheduled, with the reason why. */
  skipped: { name: string; folder: string; reason: string }[];
  warnings: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Finds the official cut-off that applies to one specific course pass. A name can carry
 * several cut-offs (one per distance, or one per direction on an out-and-back), so the
 * cut-off is matched on both the race distance it names and how near its km mark is to
 * this particular pass.
 */
function findCutoffForCrossing(
  station: GroupedStation,
  snap: CourseSnap,
  courses: Course[],
  toleranceKm: number
): string | undefined {
  let best: { clock: string; delta: number } | undefined;

  for (const member of station.members) {
    for (const cutoff of member.label.cutoffs) {
      if (cutoff.raceDistanceKm !== undefined) {
        const target = matchCourseByDistance(courses, cutoff.raceDistanceKm, toleranceKm);
        if (!target || target.name !== snap.courseName) continue;
      }

      // An unlabeled km means the cut-off applies to the pass it is nearest to.
      const delta = Number.isFinite(cutoff.km) ? Math.abs(cutoff.km - snap.kmFromStart) : 0;
      if (!best || delta < best.delta) best = { clock: cutoff.cutoffClock, delta };
    }
  }

  return best?.clock;
}

/**
 * Runs a parsed race map and a set of per-distance pace bands through to station
 * operating schedules and a cut-off table.
 *
 * Arrival times come from the pace-band model, which stands in for a results CSV until
 * one exists. Every course pass at a station becomes its own crossing, so an
 * out-and-back station is scheduled around both the outbound and the return field.
 */
export function runPipeline(
  kmlText: string,
  distanceInputs: DistanceInput[],
  options: PipelineOptions = {}
): PipelineResult {
  const stationFolders = (options.stationFolders ?? DEFAULT_STATION_FOLDERS).map(normalize);
  const excluded = (options.excludePlacemarkNames ?? []).map(normalize);
  const toleranceKm = options.courseDistanceToleranceKm ?? DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM;
  const sampleSize = options.paceModelSampleSize ?? 200;

  const parsed = parseKml(kmlText, options);
  const warnings = [...parsed.warnings];
  const courses = buildCourses(parsed.courses);

  const inputByCourse = new Map(distanceInputs.map((d) => [d.courseName, d]));
  for (const course of courses) {
    if (!inputByCourse.has(course.name)) {
      warnings.push(`No pace band entered for "${course.name}" — its crossings are omitted from the schedule.`);
    }
  }

  const stationPlacemarks = parsed.placemarks.filter(
    (p) => stationFolders.includes(normalize(p.folder)) && !excluded.includes(normalize(p.name))
  );

  const snapped = snapPlacemarks(stationPlacemarks, courses, options);
  for (const placemark of snapped) {
    for (const warning of placemark.label.warnings) warnings.push(`${placemark.name}: ${warning}`);
    for (const mismatch of placemark.labelMismatches) {
      warnings.push(
        `${placemark.name}: label says KM${mismatch.labeledKm} on ${mismatch.courseName} but it maps to ` +
          `KM${mismatch.computedKm.toFixed(2)} (${mismatch.deltaKm.toFixed(2)} km apart).`
      );
    }
  }

  const groups = groupCoincidentPlacemarks(snapped, options.coincidentToleranceKm);

  const stations: PipelineStation[] = [];
  const skipped: PipelineResult['skipped'] = [];

  for (const group of groups) {
    const folder = group.members[0]?.folder ?? '';
    const names = group.members.map((m) => m.name);

    if (group.snaps.length === 0) {
      skipped.push({ name: group.name, folder, reason: 'Does not sit on any race course.' });
      continue;
    }

    // In the cut-off folder a placemark carrying neither a km mark nor a cut-off time
    // is a course marker (e.g. "PRE-FINISH"), not a position that has to be staffed.
    // The rule only applies when every member of the station is such a marker: a marker
    // that happens to sit within metres of a staffed position must not drag it out of
    // the schedule.
    const hasAnyLabelData = group.members.some((m) => m.label.kmMarks.length > 0 || m.label.cutoffs.length > 0);
    const allFromCutoffFolder = group.members.every((m) => normalize(m.folder) === normalize(CUTOFF_FOLDER));
    if (allFromCutoffFolder && !hasAnyLabelData) {
      skipped.push({ name: group.name, folder, reason: 'No km mark or cut-off time — treated as a course marker.' });
      continue;
    }

    const crossings: DistanceCrossing[] = [];
    const details: StationCrossingDetail[] = [];

    for (const snap of group.snaps) {
      const input = inputByCourse.get(snap.courseName);
      if (!input) continue;

      const officialCutoffClock = findCutoffForCrossing(group, snap, courses, toleranceKm);

      crossings.push({
        courseName: snap.courseName,
        kmFromStart: snap.kmFromStart,
        arrivalPercentiles: arrivalPercentilesFromPaceBand(input, input, snap.kmFromStart),
        runnerArrivalsSeconds: samplePaceModelArrivals(input, input, snap.kmFromStart, sampleSize),
        officialCutoffClock,
      });

      details.push({
        courseName: snap.courseName,
        kmFromStart: snap.kmFromStart,
        passIndex: snap.passIndex,
        passCount: snap.passCount,
        offsetKm: snap.offsetKm,
        officialCutoffClock,
      });
    }

    if (crossings.length === 0) {
      skipped.push({ name: group.name, folder, reason: 'No pace band entered for any distance passing it.' });
      continue;
    }

    stations.push({
      schedule: buildStationSchedule(group.name, crossings, options),
      folder,
      sourceNames: names,
      crossings: details,
    });
  }

  stations.sort((a, b) => {
    const aKm = Math.min(...a.crossings.map((c) => c.kmFromStart));
    const bKm = Math.min(...b.crossings.map((c) => c.kmFromStart));
    return aKm - bKm;
  });

  return {
    courses,
    stations,
    cutoffTable: buildCutoffTable(stations.map((s) => s.schedule)),
    skipped,
    warnings,
  };
}
