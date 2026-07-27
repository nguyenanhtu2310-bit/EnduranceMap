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
  arrivalPercentilesFromSamples,
  projectSampleArrivals,
  samplePaceModelArrivals,
  type PaceBand,
  type StartField,
} from './paceModel';
import type { RunnerSample } from './results';
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
import { parseClockTimeToSeconds } from './time';
import {
  DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM,
  DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM,
} from './config';

/** Pace and field-size input for one race distance. */
export interface DistanceInput extends PaceBand, StartField {
  courseName: string;
  /**
   * Real finishers from a previous race. When present these drive the arrival times and
   * the pace band is only shown for reference; the band is a three-point approximation
   * and the samples are the actual distribution.
   */
  samples?: RunnerSample[];
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

/** Fraction of a course beyond which a crossing counts as finish-line furniture. */
const FINISH_AREA_FRACTION = 0.97;

export interface PipelineOptions extends KmlParseOptions, SnapOptions, ScheduleOptions {
  /** Folder names (case-insensitive) whose points are treated as staffed stations. */
  stationFolders?: string[];
  /** Placemark names to exclude from the operational output entirely. */
  excludePlacemarkNames?: string[];
  /**
   * Stations to leave out, by map name. Distinct from `excludePlacemarkNames`: this
   * drops a position after grouping, so removing a merged station takes all of its
   * placemarks with it. Applied before numbering, so the remaining stations number
   * consecutively rather than leaving a gap where the removed one was.
   */
  excludeStations?: string[];
  /**
   * Cut-offs supplied by the organiser, keyed by station name then course name. These
   * are authoritative: a time entered here overrides whatever the map's placemark names
   * happen to say, because the organiser's sheet is the source of truth and the map is
   * a transcription of it.
   */
  manualCutoffs?: Record<string, Record<string, string>>;
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
  /**
   * Name derived from the map, before any sequential renumbering. Stable regardless of
   * how the station is labelled on screen, so manual cut-offs keyed to it survive
   * turning numbering on and off.
   */
  mapName: string;
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
  /** The per-distance inputs this run used, for tables that show start times. */
  distanceInputs: DistanceInput[];
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

/**
 * Applies an operator-chosen presentation order to a set of stations. The computed
 * course order is a good default, but the order a schedule is presented in is an
 * editorial decision — an organiser may want the staffed positions grouped, or the
 * finish area first. Stations missing from `order` keep their computed position at the
 * end, so adding a folder does not silently drop rows.
 */
export function applyStationOrder(stations: PipelineStation[], order: string[]): PipelineStation[] {
  if (order.length === 0) return stations;

  const rank = new Map(order.map((mapName, i) => [mapName, i]));
  return [...stations].sort((a, b) => {
    const ra = rank.get(a.mapName) ?? Infinity;
    const rb = rank.get(b.mapName) ?? Infinity;
    return ra === rb ? 0 : ra - rb;
  });
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
  const excludedStations = new Set(options.excludeStations ?? []);
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

    // Removed by the operator — a position that exists on the map but is not being run
    // this year. Dropped silently rather than reported as skipped, since it is a
    // deliberate choice rather than something the data could not resolve.
    if (excludedStations.has(stationName)) continue;

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

      // An organiser-entered time wins over anything parsed from the map.
      const manual = options.manualCutoffs?.[stationName]?.[snap.courseName]?.trim();
      const officialCutoffClock =
        manual && parseClockTimeToSeconds(manual) !== null
          ? manual
          : findCutoffForCrossing(group, snap, courses, toleranceKm, cutoffPassToleranceKm);

      const usesRealField = !!input.samples && input.samples.length > 0;

      crossings.push({
        courseName: snap.courseName,
        kmFromStart: snap.kmFromStart,
        arrivalPercentiles: usesRealField
          ? arrivalPercentilesFromSamples(input.samples!, input, snap.kmFromStart)
          : arrivalPercentilesFromPaceBand(input, input, snap.kmFromStart),
        runnerArrivalsSeconds: usesRealField
          ? projectSampleArrivals(input.samples!, input, snap.kmFromStart)
          : samplePaceModelArrivals(input, input, snap.kmFromStart, sampleSize),
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
      mapName: stationName,
      folder,
      // Filled in below, once the shared time grid is known.
      distribution: [],
      peakBinIndex: -1,
      sourceNames: names,
      coLocatedNames,
      crossings: details,
    });
  }

  /**
   * Orders stations down the route. Two things make the naive "smallest kilometre
   * anywhere" rule wrong on a real race:
   *
   *  - Distances of different lengths share points. A pre-finish mat is 4.6 km into the
   *    5K and 65.6 km into the 70K; ranking it by 4.6 puts the finish area above the
   *    mid-course checkpoints. Positions are therefore compared as a fraction of the
   *    course they sit on, so "most of the way round" ranks alike whichever distance it
   *    belongs to.
   *  - A finish line sits metres from a start, so on an out-and-back it is crossed at
   *    both ~0 km and the full distance. Ranking it by first crossing puts the finish at
   *    the top of the table.
   *
   * Points are therefore ranked by where runners FIRST meet them, which keeps an
   * out-and-back reading in the order it is run, except for points whose last crossing
   * is essentially at the course end — those are finish-line furniture and belong last.
   */
  const byLength = [...courses].sort((a, b) => b.totalKm - a.totalKm);
  const longestKm = byLength[0]?.totalKm ?? 1;

  const orderKey = (station: PipelineStation): number => {
    for (const course of byLength) {
      const passes = station.crossings.filter((c) => c.courseName === course.name);
      if (passes.length === 0 || course.totalKm <= 0) continue;

      const firstFraction = Math.min(...passes.map((p) => p.kmFromStart)) / course.totalKm;
      const lastFraction = Math.max(...passes.map((p) => p.kmFromStart)) / course.totalKm;
      const fraction = lastFraction >= FINISH_AREA_FRACTION ? lastFraction : firstFraction;

      return fraction * longestKm;
    }
    return Infinity;
  };

  stations.sort((a, b) => orderKey(a) - orderKey(b));

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
    distanceInputs,
    courseOrder,
    timeRangeSeconds,
    binMinutes,
    skipped,
    warnings,
  };
}
