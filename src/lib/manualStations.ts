import type { CourseVertex } from './geo';
import type { RawPlacemark } from './kml';
import type { ParsedLabel } from './labels';
import { parseClockTimeToSeconds } from './time';
import { positionAtKm } from './timingStations';

/**
 * Stations typed in by hand, from the distance table a race already publishes.
 *
 * Every race with a website has this table: checkpoint, place, cumulative kilometres,
 * and often the cut-off. It is the first thing published and the last thing to reach a
 * map — a KML with a pin per station arrives late if it arrives at all, and last year's
 * one is the only one that exists while this year is being planned.
 *
 * The route says where a kilometre is and the table says which kilometre, so between
 * them a station's position on the ground is settled. Nothing else here is new: once a
 * station has a position it is a station, and the arrival modelling, the traffic counts
 * and the schedule all work on it exactly as they do on a pin somebody dropped.
 */

/** The folder hand-entered stations are filed under, so they read as one group. */
export const MANUAL_FOLDER = 'BY HAND';

/**
 * How far past the end of a course a station may sit before it is refused.
 *
 * A published table and a GPS trace disagree by a few tenths of a percent as a matter of
 * course — one is measured along the ground and the other along a line drawn on it — so
 * a finish typed as 100.9 against a route measuring 100.4 is not a mistake and must not
 * be treated as one. A checkpoint a fifth of the way past the end is a different thing
 * entirely: a table read against the wrong distance.
 */
const OVERSHOOT_TOLERANCE = 0.02;

export interface ManualStation {
  /** What the race calls it — "CP3", "WS Lếch Mông". */
  name: string;
  /** Cumulative kilometres from the start, along the course named below. */
  km: number;
  /**
   * The course those kilometres are measured along.
   *
   * Stated rather than assumed. A published table is written for one distance, and
   * "km 26.2" on the 100 km is a different place from "km 26.2" on the 70 km — the two
   * only coincide on a card where every race shares a start and a direction, which is
   * not a card, it is a coincidence.
   */
  courseName: string;
  /** Cut-off at this station, where the table publishes one. */
  cutoffClock?: string;
}

export interface ManualStationResult {
  placemarks: RawPlacemark[];
  warnings: string[];
}

/**
 * Places each hand-entered station on its course.
 *
 * A station past the end of its course is reported rather than pinned to the finish:
 * the usual cause is a table read against the wrong distance, and silently stacking
 * three checkpoints on the finish line would hide that behind a plausible-looking plan.
 */
export function manualPlacemarks(
  stations: ManualStation[],
  coursesByName: Map<string, CourseVertex[]>
): ManualStationResult {
  const warnings: string[] = [];
  const placemarks: RawPlacemark[] = [];
  const used = new Set<string>();

  for (const station of stations) {
    const name = station.name.trim();
    if (!name) continue;

    const course = coursesByName.get(station.courseName);
    if (!course || course.length < 2) {
      warnings.push(`"${name}" is measured along "${station.courseName}", which is not loaded.`);
      continue;
    }

    const totalKm = course[course.length - 1].cumulativeKm;
    if (!(station.km >= 0)) {
      warnings.push(`"${name}" has no distance, so it cannot be placed.`);
      continue;
    }
    if (station.km > totalKm * (1 + OVERSHOOT_TOLERANCE)) {
      warnings.push(
        `"${name}" is at km ${station.km.toFixed(1)} but "${station.courseName}" measures ` +
          `${totalKm.toFixed(1)} km. Check which distance the table was written for.`
      );
      continue;
    }

    // Inside the tolerance a station past the end is the finish, which is where the last
    // row of a published table almost always is.
    const coord = positionAtKm(course, Math.min(station.km, totalKm));
    if (!coord) continue;

    // Two stations under one name make one station downstream, and the second one's
    // crossings quietly join the first's. Named apart, they stay two places.
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = `${name} (${n})`;
    used.add(unique);

    /*
     * The label is built rather than written into the name and parsed back out.
     *
     * A cut-off typed into a box is already structured; spelling it into "CP3 COT 21:00"
     * so a text parser can find it again would put a round trip through prose between
     * the operator and the schedule, and every rule that parser has about km marks and
     * distance tokens would start applying to a name nobody meant as one.
     *
     * The km is carried on the cut-off so it binds this pass alone — a course that
     * crosses the same point twice has two passes, and a deadline written for the return
     * leg must not close the outbound one hours early.
     */
    const cutoffClock = station.cutoffClock?.trim();
    const cutoffSeconds = cutoffClock ? parseClockTimeToSeconds(cutoffClock) : null;
    if (cutoffClock && cutoffSeconds === null) {
      warnings.push(`"${name}" has a cut-off of "${cutoffClock}", which is not a time.`);
    }

    const label: ParsedLabel = {
      kmMarks: [],
      cutoffs:
        cutoffClock && cutoffSeconds !== null
          ? [{ km: station.km, cutoffClock, cutoffSeconds }]
          : [],
      distancesServed: [],
      cleanName: unique,
      warnings: [],
    };

    placemarks.push({ name: unique, folder: MANUAL_FOLDER, coord, label });
  }

  return { placemarks, warnings };
}
