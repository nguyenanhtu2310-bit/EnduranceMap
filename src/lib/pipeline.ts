import { parseKml, type KmlParseOptions } from './kml';
import { parseClockTimeToSeconds } from './time';
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
import type { LeadAthlete, RunnerSample, Sex } from './results';
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
import {
  DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM,
  DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM,
  DEFAULT_HISTOGRAM_BIN_MINUTES,
} from './config';

/** Pace and field-size input for one race distance. */
export interface DistanceInput extends PaceBand, StartField {
  courseName: string;
  /**
   * The finish cut-off the organizer has set for this distance, "HH:MM". Optional —
   * when blank the tool proposes one from the modelled tail instead. Applied to the
   * finish-area pass only: a race's official COT governs its finish line, and the
   * intermediate points get their own proposals.
   */
  organizerCutoffClock?: string;
  /**
   * Real finishers from a previous race. When present these drive the arrival times and
   * the pace band is only shown for reference; the band is a three-point approximation
   * and the samples are the actual distribution.
   */
  samples?: RunnerSample[];
  /**
   * The fastest man and fastest woman of the reference field. They are modelled apart
   * from the rest because the organizer needs the lead athlete's arrival to a minute —
   * tape, podium, lead vehicle and photographers all key off it — and the head of the
   * field is the one place where a percentile of the whole distribution is no use.
   */
  leaders?: LeadAthlete[];
  /**
   * The drawn LineString this input runs on, when it differs from `courseName`. A
   * duathlon runs its two run legs over one loop, and each leg needs its own crossings,
   * cut-offs and removals; naming them separately and pointing both at the same drawn
   * route keeps them independent. Defaults to `courseName`.
   */
  sourceCourseName?: string;
  /**
   * Position in a multisport sequence — 0 for the first leg, and 0 for every
   * single-sport race. Stations are ordered by leg first, so a point half way round a
   * 90 km bike leg still ranks ahead of the first kilometre of the run.
   */
  legIndex?: number;
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

/** How close to either end of a route a stop counts as start or finish furniture. */
export const END_ZONE_KM = 0.5;

/** Names that mark a point as the start or the finish rather than a stop on the course. */
const END_POINT_NAME = /^(start|finish|s\/f)\b/i;

/**
 * Whether a stop is start or finish furniture rather than something a runner meets out
 * on the course. Aid and water spacing is about what lies between the two lines, so the
 * lines themselves are never counted.
 *
 * Position alone is not enough: a start can sit a little way from the route's first
 * metre, and on a loop the finish is metres from the start. The map's own name is
 * checked too — matched against the map name rather than the displayed one, which
 * sequential numbering would have replaced with "Station 4".
 */
export function isEndZoneStop(mapName: string, kmFromStart: number, courseTotalKm: number): boolean {
  if (END_POINT_NAME.test(mapName.trim())) return true;
  // The start side needs no course length; only the finish side is measured from it.
  if (kmFromStart <= END_ZONE_KM) return true;
  return courseTotalKm > 0 && kmFromStart >= courseTotalKm - END_ZONE_KM;
}

export interface PipelineOptions extends KmlParseOptions, SnapOptions, ScheduleOptions {
  /** Folder names (case-insensitive) whose points are treated as staffed stations. */
  stationFolders?: string[];
  /** Placemark names to exclude from the operational output entirely. */
  excludePlacemarkNames?: string[];
  /**
   * Placemarks to leave out when their name contains any of these fragments. One map
   * often carries several events — a kids race, a sprint — whose points share folders
   * with the race being planned, so ticking folders cannot separate them.
   */
  excludePlacemarkContaining?: string[];
  /**
   * Stations to leave out, by map name. Distinct from `excludePlacemarkNames`: this
   * drops a position after grouping, so removing a merged station takes all of its
   * placemarks with it. Applied before numbering, so the remaining stations number
   * consecutively rather than leaving a gap where the removed one was.
   */
  excludeStations?: string[];
  /**
   * Individual course passes to drop, keyed by `passKey`. Snapping works on proximity
   * to a line, so where a course runs out and back along a divided road the two
   * carriageways sit within the crossing corridor and one mat reads as two passes —
   * even though a runner on the far side cannot reach it. That is a judgement about the
   * ground, not something the geometry can settle, so the pass is removed by hand.
   */
  excludePasses?: string[];
  courseDistanceToleranceKm?: number;
  /** How near a cut-off's labelled km must be to a pass for it to govern that pass. */
  cutoffPassToleranceKm?: number;
  /** Distance within which separately-drawn placemarks are merged into one station. */
  coincidentToleranceKm?: number;
  /** Samples per distance used to synthesize arrival timestamps from a pace band. */
  paceModelSampleSize?: number;
  /** Minutes added to the slowest arrival when proposing a cut-off. */
  cutoffGraceMinutes?: number;
  /**
   * When set, stations are renamed "<prefix> 1" … "<prefix> N" in course order. Crews
   * work from a sequential station list rather than the map's internal placemark names;
   * the original names stay on `sourceNames` so the mapping remains checkable.
   */
  renumberStationsAs?: string;
  /**
   * Restricts which courses a placemark is allowed to sit on, by name. On a multisport
   * map the bike and run routes share tarmac around transition — a run turnaround can
   * sit a metre from the bike line and a metre from the run line — so proximity cannot
   * say which leg a point belongs to. Returning a leg's course names for a placemark
   * confines it to that leg; returning undefined leaves the decision to the geometry.
   */
  restrictCoursesFor?: (placemarkName: string) => string[] | undefined;
}

export interface StationCrossingDetail {
  courseName: string;
  kmFromStart: number;
  passIndex: number;
  passCount: number;
  offsetKm: number;
  officialCutoffClock?: string;
}

/** When the lead athlete of one sex, on one distance, reaches a station. */
export interface LeadArrival {
  courseName: string;
  sex: Sex;
  kmFromStart: number;
  passIndex: number;
  /** Seconds since midnight, on the same clock as every other arrival. */
  seconds: number;
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
  /** Head of the field through this point, empty when no export named the sexes. */
  leadArrivals: LeadArrival[];
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
  /**
   * True when the courses are legs of a sequence rather than separate distances, so
   * `courseOrder` is the order they are raced in. Sorting legs by length would put a
   * duathlon's short second run ahead of the bike it follows.
   */
  legOrdered: boolean;
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
 * Stable identity for one course pass at one station. Used to remove a single crossing
 * without touching the station's other passes or the other distances through it.
 */
export function passKey(mapName: string, courseName: string, passIndex: number): string {
  return `${mapName}|${courseName}|${passIndex}`;
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
 * Gives every leg its own course, even when several legs are drawn as one line.
 *
 * A duathlon runs out, cycles, and runs the same loop again. Keyed by the drawn name
 * alone the second run would overwrite the first, taking its crossings, its cut-offs and
 * its removals with it. Naming the legs separately and pointing them at the same
 * geometry keeps them independent, at the cost of snapping that route twice.
 *
 * The drawn route is dropped once something aliases it: it is scenery at that point, and
 * leaving it in would snap every placemark a third time and warn about a course nobody
 * entered a pace band for. Returns the input untouched when no aliasing is in play.
 */
function expandLegCourses(drawn: Course[], inputs: DistanceInput[]): Course[] {
  const byName = new Map(drawn.map((c) => [c.name, c]));
  const aliases: Course[] = [];
  const consumed = new Set<string>();

  for (const input of inputs) {
    const source = input.sourceCourseName;
    if (!source || source === input.courseName) continue;
    // An input naming a course that really was drawn wins over its own alias.
    if (byName.has(input.courseName)) continue;
    const base = byName.get(source);
    if (!base) continue;
    aliases.push({ name: input.courseName, vertices: base.vertices, totalKm: base.totalKm });
    consumed.add(source);
  }

  if (aliases.length === 0) return drawn;
  return [...drawn.filter((c) => !consumed.has(c.name)), ...aliases];
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
  const excludedPasses = new Set(options.excludePasses ?? []);
  const toleranceKm = options.courseDistanceToleranceKm ?? DEFAULT_COURSE_DISTANCE_MATCH_TOLERANCE_KM;
  const cutoffPassToleranceKm = options.cutoffPassToleranceKm ?? DEFAULT_CUTOFF_PASS_MATCH_TOLERANCE_KM;
  const sampleSize = options.paceModelSampleSize ?? 200;

  const parsed = parseKml(kmlText, options);
  const warnings = [...parsed.warnings];
  const courses = expandLegCourses(buildCourses(parsed.courses), distanceInputs);

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
  const excludedFragments = (options.excludePlacemarkContaining ?? [])
    .map((fragment) => fragment.trim().toLowerCase())
    .filter(Boolean);
  const considered = parsed.placemarks.filter(
    (p) =>
      !excluded.includes(normalize(p.name)) &&
      !excludedFragments.some((fragment) => p.name.toLowerCase().includes(fragment))
  );
  const snapped = snapPlacemarks(considered, courses, options).map((placemark) => {
    const allowed = options.restrictCoursesFor?.(placemark.name);
    if (!allowed) return placemark;
    const permitted = new Set(allowed);
    const snaps = placemark.snaps.filter((s) => permitted.has(s.courseName));
    return snaps.length === placemark.snaps.length ? placemark : { ...placemark, snaps };
  });
  // A station takes its leg from any of the placemarks standing at it. Merging happens
  // within metres, and around transition a bike route and a run route are within metres
  // of each other, so an unnamed neighbour would otherwise hand a run position the bike
  // passes as well — and a window stretching from the first rider to the last runner.
  const groups = groupCoincidentPlacemarks(snapped, options.coincidentToleranceKm).map((group) => {
    if (!options.restrictCoursesFor) return group;

    const allowed = new Set<string>();
    let restricted = false;
    for (const member of group.members) {
      const names = options.restrictCoursesFor(member.name);
      if (!names) continue;
      restricted = true;
      for (const name of names) allowed.add(name);
    }

    if (!restricted) return group;
    const snaps = group.snaps.filter((s) => allowed.has(s.courseName));
    return snaps.length === group.snaps.length ? group : { ...group, snaps };
  });

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
    const leadArrivals: LeadArrival[] = [];

    for (const snap of group.snaps) {
      const input = inputByCourse.get(snap.courseName);
      if (!input) continue;
      if (excludedPasses.has(passKey(stationName, snap.courseName, snap.passIndex))) continue;

      // The organizer's finish COT governs the finish-area pass of its own distance;
      // everything else falls back to whatever the map's placemark names carry.
      const course = courses.find((c) => c.name === snap.courseName);
      const atFinish = !!course && course.totalKm > 0 && snap.kmFromStart >= course.totalKm * FINISH_AREA_FRACTION;
      const organizerCot =
        atFinish && input.organizerCutoffClock && parseClockTimeToSeconds(input.organizerCutoffClock) !== null
          ? input.organizerCutoffClock
          : undefined;
      const officialCutoffClock =
        organizerCot ?? findCutoffForCrossing(group, snap, courses, toleranceKm, cutoffPassToleranceKm);

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

      // The same formula the rest of the field is modelled with, run for one athlete.
      const startSeconds = parseClockTimeToSeconds(input.startTimeClock);
      if (startSeconds !== null) {
        for (const leader of input.leaders ?? []) {
          leadArrivals.push({
            courseName: snap.courseName,
            sex: leader.sex,
            kmFromStart: snap.kmFromStart,
            passIndex: snap.passIndex,
            seconds:
              startSeconds + leader.startOffsetSeconds + leader.paceMinPerKm * snap.kmFromStart * 60,
          });
        }
      }
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
      leadArrivals,
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
   *
   * On a multisport race the fraction is not comparable across legs either: half way
   * round a 90 km bike leg is 45, while nine tenths of the way through a 21 km run is
   * only 19, which would file the run ahead of the bike. The leg a station is met on
   * therefore outranks its position within that leg. With one leg this is the same
   * ordering as before.
   */
  const legByCourse = new Map(distanceInputs.map((d) => [d.courseName, d.legIndex ?? 0]));
  const legOf = (courseName: string) => legByCourse.get(courseName) ?? 0;
  const byLength = [...courses].sort((a, b) => b.totalKm - a.totalKm);
  const longestKm = byLength[0]?.totalKm ?? 1;

  const orderKey = (station: PipelineStation): number => {
    if (station.crossings.length === 0) return Infinity;
    // Where a station is met on more than one leg, the earliest one places it.
    const earliestLeg = Math.min(...station.crossings.map((c) => legOf(c.courseName)));

    for (const course of byLength) {
      if (legOf(course.name) !== earliestLeg) continue;
      const passes = station.crossings.filter((c) => c.courseName === course.name);
      if (passes.length === 0 || course.totalKm <= 0) continue;

      const firstFraction = Math.min(...passes.map((p) => p.kmFromStart)) / course.totalKm;
      const lastFraction = Math.max(...passes.map((p) => p.kmFromStart)) / course.totalKm;
      const fraction = lastFraction >= FINISH_AREA_FRACTION ? lastFraction : firstFraction;

      return (earliestLeg + fraction) * longestKm;
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
    cutoffTable: buildCutoffTable(stations.map((s) => s.schedule), {
      graceMinutes: options.cutoffGraceMinutes,
    }),
    distanceInputs,
    courseOrder,
    legOrdered: distanceInputs.some((d) => (d.legIndex ?? 0) > 0),
    timeRangeSeconds,
    binMinutes,
    skipped,
    warnings,
  };
}
