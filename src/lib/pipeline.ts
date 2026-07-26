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
  buildStackedHistogram,
  buildStationSchedule,
  type CutoffTableRow,
  type DistanceCrossing,
  type ScheduleOptions,
  type StackedBin,
  type StationSchedule,
} from './schedule';
import { DEFAULT_HISTOGRAM_BIN_MINUTES } from './config';
import {
  DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM,
  DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM,
} from './config';

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
  /** How near a cut-off's labelled km must be to a pass for it to govern that pass. */
  cutoffPassToleranceKm?: number;
  /** Distance within which separately-drawn placemarks are merged into one station. */
  coincidentToleranceKm?: number;
  /** Samples per distance used to synthesize arrival timestamps from a pace band. */
  paceModelSampleSize?: number;
  /**
   * When set, stations are renamed "<prefix> 1" … "<prefix> N" in course order. Crews
   * work from a sequential station list rather than the map's internal placemark names;
   * the original names stay on `sourceNames` so the mapping remains checkable.
   */
  renumberStationsAs?: string;
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
  /** Arrivals binned on the shared time grid, split by distance. */
  distribution: StackedBin[];
  /** Index into `distribution` of the busiest bin, or -1 when nobody crosses. */
  peakBinIndex: number;
  /** Names of the placemarks in a selected folder that make this a station. */
  sourceNames: string[];
  /**
   * Names of placemarks from other folders sitting at the same spot. They do not make
   * the station, but they are why it may carry an official cut-off — a signage post at
   * a cut-off mat is governed by that mat's closing time.
   */
  coLocatedNames: string[];
  crossings: StationCrossingDetail[];
}

export interface PipelineResult {
  courses: Course[];
  stations: PipelineStation[];
  cutoffTable: CutoffTableRow[];
  /**
   * Course names in the order their colours are assigned, so every station's
   * distribution stacks the same distance in the same slot.
   */
  courseOrder: string[];
  /** Shared arrival-time window across every station, for a common chart axis. */
  timeRangeSeconds: { start: number; end: number };
  binMinutes: number;
  /** Stations that could not be scheduled, with the reason why. */
  skipped: { name: string; folder: string; reason: string }[];
  warnings: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export interface FolderSummary {
  folder: string;
  placemarkCount: number;
}

/** Lists the folders holding point placemarks, so the caller can choose what to schedule. */
export function listPlacemarkFolders(placemarks: { folder: string }[]): FolderSummary[] {
  const counts = new Map<string, number>();
  for (const p of placemarks) {
    counts.set(p.folder, (counts.get(p.folder) ?? 0) + 1);
  }
  return Array.from(counts, ([folder, placemarkCount]) => ({ folder, placemarkCount })).sort((a, b) =>
    a.folder.localeCompare(b.folder)
  );
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
  toleranceKm: number,
  passToleranceKm: number
): string | undefined {
  let best: { clock: string; delta: number } | undefined;

  for (const member of station.members) {
    for (const cutoff of member.label.cutoffs) {
      if (cutoff.raceDistanceKm !== undefined) {
        const target = matchCourseByDistance(courses, cutoff.raceDistanceKm, toleranceKm);
        if (!target || target.name !== snap.courseName) continue;
      }

      // A cut-off with a km mark governs only the pass at that km. Without the check,
      // a return-leg cut-off would also bind the outbound pass through the same spot,
      // inventing a deadline hours before the one that was actually written.
      if (Number.isFinite(cutoff.km)) {
        const delta = Math.abs(cutoff.km - snap.kmFromStart);
        if (delta > passToleranceKm) continue;
        if (!best || delta < best.delta) best = { clock: cutoff.cutoffClock, delta };
      } else if (!best) {
        // An unlabelled km applies to the station as a whole.
        best = { clock: cutoff.cutoffClock, delta: Infinity };
      }
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
  const cutoffPassToleranceKm = options.cutoffPassToleranceKm ?? DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM;
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

  const isSelectedFolder = (folder: string) => stationFolders.includes(normalize(folder));

  // Every placemark is snapped and grouped, not just those in the selected folders. A
  // station's official cut-off often lives on a placemark from a different folder that
  // sits at the same spot, and dropping those early would silently lose the cut-off.
  const considered = parsed.placemarks.filter((p) => !excluded.includes(normalize(p.name)));
  const snapped = snapPlacemarks(considered, courses, options);
  const groups = groupCoincidentPlacemarks(snapped, options.coincidentToleranceKm);

  const stations: PipelineStation[] = [];
  const skipped: PipelineResult['skipped'] = [];

  for (const group of groups) {
    const selectedMembers = group.members.filter((m) => isSelectedFolder(m.folder));
    if (selectedMembers.length === 0) continue;

    const folder = selectedMembers[0].folder;
    const names = selectedMembers.map((m) => m.name);
    const others = group.members.filter((m) => !isSelectedFolder(m.folder));
    const coLocatedNames = Array.from(new Set(others.map((m) => m.label.cleanName || m.name)));

    // The station is named for the placemarks the user actually asked to schedule;
    // anything co-located from another folder is reported separately.
    const stationName = Array.from(new Set(selectedMembers.map((m) => m.label.cleanName || m.name))).join(' / ');

    // Data-quality warnings are only raised for placemarks that actually bear on a
    // station in the schedule, so narrowing the folder selection narrows the noise.
    for (const member of group.members) {
      for (const warning of member.label.warnings) warnings.push(`${member.name}: ${warning}`);
      for (const mismatch of member.labelMismatches) {
        warnings.push(
          `${member.name}: label says KM${mismatch.labeledKm} on ${mismatch.courseName} but it maps to ` +
            `KM${mismatch.computedKm.toFixed(2)} (${mismatch.deltaKm.toFixed(2)} km apart).`
        );
      }
    }

    if (group.snaps.length === 0) {
      skipped.push({ name: names.join(' / '), folder, reason: 'Does not sit on any race course.' });
      continue;
    }

    // In the cut-off folder a placemark carrying neither a km mark nor a cut-off time
    // is a course marker (e.g. "PRE-FINISH"), not a position that has to be staffed.
    // The rule only applies when every selected member of the station is such a marker:
    // a marker that happens to sit within metres of a staffed position must not drag it
    // out of the schedule.
    const hasAnyLabelData = group.members.some((m) => m.label.kmMarks.length > 0 || m.label.cutoffs.length > 0);
    const allFromCutoffFolder = selectedMembers.every((m) => normalize(m.folder) === normalize(CUTOFF_FOLDER));
    if (allFromCutoffFolder && !hasAnyLabelData) {
      skipped.push({ name: stationName, folder, reason: 'No km mark or cut-off time — treated as a course marker.' });
      continue;
    }

    const crossings: DistanceCrossing[] = [];
    const details: StationCrossingDetail[] = [];

    for (const snap of group.snaps) {
      const input = inputByCourse.get(snap.courseName);
      if (!input) continue;

      const officialCutoffClock = findCutoffForCrossing(group, snap, courses, toleranceKm, cutoffPassToleranceKm);

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
      skipped.push({ name: stationName, folder, reason: 'No pace band entered for any distance passing it.' });
      continue;
    }

    stations.push({
      schedule: buildStationSchedule(stationName, crossings, options),
      folder,
      // Filled in below, once the shared time grid is known.
      distribution: [],
      peakBinIndex: -1,
      sourceNames: names,
      coLocatedNames,
      crossings: details,
    });
  }

  stations.sort((a, b) => {
    const aKm = Math.min(...a.crossings.map((c) => c.kmFromStart));
    const bKm = Math.min(...b.crossings.map((c) => c.kmFromStart));
    return aKm - bKm;
  });

  if (options.renumberStationsAs) {
    const prefix = options.renumberStationsAs;
    stations.forEach((station, i) => {
      station.schedule = { ...station.schedule, name: `${prefix} ${i + 1}` };
    });
  }

  // A single time grid shared by every station, so the charts sit on one axis and the
  // field can be seen moving down the course rather than each station being rescaled
  // to its own window.
  const binMinutes = options.binMinutes ?? DEFAULT_HISTOGRAM_BIN_MINUTES;
  const courseOrder = courses.map((c) => c.name).filter((name) => inputByCourse.has(name));

  let rangeStart = Infinity;
  let rangeEnd = -Infinity;
  for (const station of stations) {
    for (const crossing of station.schedule.crossings) {
      for (const arrival of crossing.runnerArrivalsSeconds ?? []) {
        if (arrival < rangeStart) rangeStart = arrival;
        if (arrival > rangeEnd) rangeEnd = arrival;
      }
    }
  }
  const hasArrivals = Number.isFinite(rangeStart) && Number.isFinite(rangeEnd);
  const timeRangeSeconds = hasArrivals ? { start: rangeStart, end: rangeEnd } : { start: 0, end: 0 };

  if (hasArrivals) {
    for (const station of stations) {
      const arrivalsByCourse = courseOrder.map((courseName) =>
        station.schedule.crossings
          .filter((c) => c.courseName === courseName)
          .flatMap((c) => c.runnerArrivalsSeconds ?? [])
      );

      station.distribution = buildStackedHistogram(arrivalsByCourse, binMinutes, rangeStart, rangeEnd);
      station.peakBinIndex = station.distribution.reduce(
        (best, bin, i, all) => (bin.total > (all[best]?.total ?? -1) ? i : best),
        -1
      );
      if (station.peakBinIndex >= 0 && station.distribution[station.peakBinIndex].total === 0) {
        station.peakBinIndex = -1;
      }
    }
  }

  return {
    courses,
    stations,
    cutoffTable: buildCutoffTable(stations.map((s) => s.schedule)),
    courseOrder,
    timeRangeSeconds,
    binMinutes,
    skipped,
    warnings,
  };
}
