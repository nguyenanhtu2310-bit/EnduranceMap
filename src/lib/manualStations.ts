import type { CourseVertex, LatLon } from './geo';
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

/** Rough kilometres between two points, for deciding whether two rows are one place. */
function gapKm(a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 111.32);
}

export interface ManualStationResult {
  placemarks: RawPlacemark[];
  warnings: string[];
}

/**
 * How far the distances given for one named station may disagree before it is worth
 * saying so.
 *
 * A published table rounds, and different distances of one race are often measured on
 * different days by different people, so the same water station turns up as km 16.0 on
 * the 21 km and km 4.8 on the 10 km when those two points are 560 m apart on the ground.
 * That is one station and it should be planned as one; it is also a discrepancy the
 * operator can fix, and only they know which number is right.
 */
const AGREEMENT_TOLERANCE_KM = 0.1;

/**
 * How far apart two rows of one name may be and still be one station.
 *
 * Wide, because the figures a race publishes for one water station routinely differ by
 * half a kilometre between its distances — a real card put the same tent at km 16.0 on
 * the 21 km and at a point 564 m away via the 10 km. Narrower than that and the feature
 * fails at exactly the job it exists for.
 *
 * Not unlimited, though, and that is why the name alone will not do: "WS" is what half
 * the water stations on a card are called, and two of them forty kilometres apart are
 * two places whatever they share. A kilometre is far enough to absorb the disagreement
 * between two published tables and nowhere near far enough to swallow a second station.
 */
const MERGE_TOLERANCE_KM = 1;

/**
 * Places each hand-entered station, one placemark per name.
 *
 * The name is the operator's own statement of identity: typing "WS Lếch Mông" twice, once
 * against each distance that passes it, says these are one tent. So they become one
 * station, positioned once, rather than two stations 560 m apart with a "(2)" after the
 * second — which is what a plan looks like when it has quietly stopped believing you.
 *
 * Position comes from the longest course the station was given a distance on. A
 * kilometre is measured more reliably along a long route than a short one, and where the
 * published figures disagree the longer measurement is the one to trust.
 *
 * A station past the end of its course is reported rather than pinned to the finish: the
 * usual cause is a table read against the wrong distance, and silently stacking three
 * checkpoints on the finish line would hide that behind a plausible-looking plan.
 */
export function manualPlacemarks(
  stations: ManualStation[],
  coursesByName: Map<string, CourseVertex[]>
): ManualStationResult {
  const warnings: string[] = [];

  /** One entry per named station, holding every distance it was given. */
  interface Group {
    /** What it is called, suffixed where a second place shares the name. */
    name: string;
    /** The name as typed, so a later row can find its group. */
    baseName: string;
    rows: { coord: LatLon; courseName: string; totalKm: number; km: number; cutoffClock?: string }[];
  }
  const groups = new Map<string, Group>();

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

    const row = { coord, courseName: station.courseName, totalKm, km: station.km, cutoffClock: station.cutoffClock };

    // Joins a group of the same name that is near enough to be the same tent, and starts
    // a new one — suffixed — where it is not.
    const sameName = [...groups.values()].filter((g) => g.baseName === name);
    const near = sameName.find((g) => gapKm(g.rows[0].coord, coord) <= MERGE_TOLERANCE_KM);
    if (near) {
      near.rows.push(row);
      continue;
    }

    let unique = name;
    for (let n = 2; groups.has(unique); n++) unique = `${name} (${n})`;
    groups.set(unique, { name: unique, baseName: name, rows: [row] });
  }

  const placemarks: RawPlacemark[] = [];
  for (const [id, group] of groups) {
    /*
     * One placemark per row, all sharing an identity.
     *
     * Each row keeps the position its own distance gives it, so the kilometre reported
     * for that distance is the one the race published rather than one re-derived from a
     * point measured along a different course. They still arrive as a single station,
     * because the identity says so — which no proximity rule could, the two points on a
     * real card being 564 m apart while two genuinely separate stations can be nearer
     * than that.
     */
    const anchor = [...group.rows].sort((a, b) => b.totalKm - a.totalKm)[0];
    let worst = 0;
    for (const row of group.rows) worst = Math.max(worst, gapKm(anchor.coord, row.coord));
    if (worst > AGREEMENT_TOLERANCE_KM) {
      const given = group.rows.map((r) => `${r.courseName} km ${r.km.toFixed(1)}`).join(', ');
      warnings.push(
        `"${group.name}" is placed ${(worst * 1000).toFixed(0)} m apart by the distances given ` +
          `for it (${given}). It is planned as one station, and each distance keeps its own ` +
          `kilometre — check them against the published table if that gap looks wrong.`
      );
    }

    for (const row of group.rows) {
      const clock = row.cutoffClock?.trim();
      const seconds = clock ? parseClockTimeToSeconds(clock) : null;
      if (clock && seconds === null) {
        warnings.push(`"${group.name}" has a cut-off of "${clock}", which is not a time.`);
      }

      /*
       * The cut-off is bound to the distance that published it, by that distance's
       * length — so the 10 km's 12:30 governs the 10 km and nothing else, on a station
       * every distance passes.
       */
      const label: ParsedLabel = {
        kmMarks: [],
        cutoffs:
          clock && seconds !== null
            ? [{ km: row.km, raceDistanceKm: row.totalKm, cutoffClock: clock, cutoffSeconds: seconds }]
            : [],
        distancesServed: [],
        cleanName: group.name,
        warnings: [],
      };

      placemarks.push({
        name: group.name,
        folder: MANUAL_FOLDER,
        coord: row.coord,
        stationId: id,
        // This row speaks for its own distance only. Left to geometry it would also land
        // on every other course passing nearby, at a kilometre no table published.
        onlyCourses: [row.courseName],
        label,
      });
    }
  }

  return { placemarks, warnings };
}
