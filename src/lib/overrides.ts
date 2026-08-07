import { passKey, type PipelineResult, type PipelineStation } from './pipeline';
import type { ActivityLevel } from './schedule';
import { eventSecondsFrom, parseClockTimeToSeconds, secondsToClockTime } from './time';

/**
 * Hand edits laid over the computed plan.
 *
 * The model produces a starting point, not an answer: in the weeks before a race the
 * operator learns things the map and the pace data cannot know — a station opening
 * early for a road closure, a checkpoint that sits 200 m from where it was drawn, a
 * cut-off the organiser moved. Those edits are stored separately from the computation
 * rather than written into it, so recalculating after a new KML keeps them, and any
 * single edit can be dropped back to what the model says.
 */
export interface StationOverride {
  name?: string;
  openClockTime?: string;
  closeClockTime?: string;
  activityLevel?: ActivityLevel;
}

export interface CrossingOverride {
  kmFromStart?: number;
  /** Replaces the proposed cut-off for this one pass. */
  cutoffClock?: string;
  /**
   * The day that cut-off falls on, counted from the event's first.
   *
   * Stored beside the clock rather than folded into it, because the clock is what the
   * operator types and what the card prints. Without it "01:30" at CP5 is either the
   * small hours of the Saturday or of the Sunday, and a 100 miles has both.
   */
  cutoffDayOffset?: number;
}

export interface RaceOverrides {
  /** Keyed by station map name — stable across renumbering. */
  stations: Record<string, StationOverride>;
  /** Keyed by `passKey(mapName, courseName, passIndex)`. */
  crossings: Record<string, CrossingOverride>;
}

export const EMPTY_OVERRIDES: RaceOverrides = { stations: {}, crossings: {} };

/** True when anything has been edited by hand. */
export function hasOverrides(o: RaceOverrides): boolean {
  return countOverrides(o) > 0;
}

export function countOverrides(o: RaceOverrides): number {
  const fields = (v: object) => Object.values(v).filter((x) => x !== undefined && x !== '').length;
  return (
    Object.values(o.stations ?? {}).reduce((n, s) => n + fields(s), 0) +
    Object.values(o.crossings ?? {}).reduce((n, c) => n + fields(c), 0)
  );
}

function setField<T extends object>(
  bag: Record<string, T>,
  key: string,
  field: keyof T,
  value: T[keyof T] | undefined
): Record<string, T> {
  const next = { ...bag };
  const entry = { ...(next[key] ?? ({} as T)) };

  if (value === undefined || value === '') delete entry[field];
  else entry[field] = value;

  // Drop the whole entry once its last edit is cleared, so "is anything edited?" stays
  // a simple emptiness check rather than a walk over hollow objects.
  if (Object.keys(entry).length === 0) delete next[key];
  else next[key] = entry;

  return next;
}

export function setStationOverride<K extends keyof StationOverride>(
  o: RaceOverrides,
  mapName: string,
  field: K,
  value: StationOverride[K] | undefined
): RaceOverrides {
  return { ...o, stations: setField(o.stations ?? {}, mapName, field, value) };
}

export function setCrossingOverride<K extends keyof CrossingOverride>(
  o: RaceOverrides,
  key: string,
  field: K,
  value: CrossingOverride[K] | undefined
): RaceOverrides {
  return { ...o, crossings: setField(o.crossings ?? {}, key, field, value) };
}

/** Normalises "HH:MM" from an input to the "HH:MM:SS" the rest of the app carries. */
function toClock(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const seconds = parseClockTimeToSeconds(value);
  return seconds === null ? undefined : secondsToClockTime(seconds);
}

/**
 * Lays the edits over a freshly computed result. Derived figures follow the edits:
 * gaps and margins recompute from an edited kilometre or time, and the cut-off table is
 * rebuilt so an edited proposal is what the sheet and the report both show.
 */
export function applyRaceOverrides(result: PipelineResult, o: RaceOverrides): PipelineResult {
  const stationOverrides = o.stations ?? {};
  const crossingOverrides = o.crossings ?? {};
  if (Object.keys(stationOverrides).length === 0 && Object.keys(crossingOverrides).length === 0) {
    return result;
  }

  const stations: PipelineStation[] = result.stations.map((station) => {
    const s = stationOverrides[station.mapName];

    const crossings = station.crossings.map((crossing) => {
      const c = crossingOverrides[passKey(station.mapName, crossing.courseName, crossing.passIndex)];
      if (!c) return crossing;
      const clock = toClock(c.cutoffClock);
      return {
        ...crossing,
        kmFromStart: c.kmFromStart ?? crossing.kmFromStart,
        officialCutoffClock: clock ?? crossing.officialCutoffClock,
        // An edited cut-off carries its own day; the seconds are what everything
        // downstream compares against, and a clock alone cannot say which morning.
        officialCutoffSeconds: clock
          ? eventSecondsFrom(clock, c.cutoffDayOffset ?? 0) ?? crossing.officialCutoffSeconds
          : crossing.officialCutoffSeconds,
      };
    });

    if (!s && crossings === station.crossings) return station;

    return {
      ...station,
      crossings,
      schedule: {
        ...station.schedule,
        name: s?.name?.trim() || station.schedule.name,
        openClockTime: toClock(s?.openClockTime) ?? station.schedule.openClockTime,
        closeClockTime: toClock(s?.closeClockTime) ?? station.schedule.closeClockTime,
        activityLevel: s?.activityLevel ?? station.schedule.activityLevel,
      },
    };
  });

  // Names and cut-offs may both have moved, so the table is rebuilt from the edited
  // stations rather than patched in place.
  const byMapName = new Map(stations.map((s) => [s.mapName, s]));
  const cutoffTable = result.cutoffTable.map((row) => {
    const original = result.stations.find((s) => s.schedule.name === row.stationName);
    const station = original ? byMapName.get(original.mapName) : undefined;
    if (!station || !original) return row;

    const index = original.crossings.findIndex(
      (c) => c.courseName === row.courseName && Math.abs(c.kmFromStart - row.kmFromStart) < 1e-6
    );
    const edited = index >= 0 ? station.crossings[index] : undefined;
    const key = index >= 0 ? passKey(station.mapName, row.courseName, original.crossings[index].passIndex) : '';
    const c = crossingOverrides[key];

    // A cut-off typed by hand is the organiser's, not a new proposal. It used to be
    // written over the proposal's clock and not its seconds, so the table showed one time
    // and did its arithmetic with another — an edited cut-off two days out reported a
    // margin of minus eight hours against an arrival it comfortably cleared.
    const clock = toClock(c?.cutoffClock);
    const seconds = clock ? eventSecondsFrom(clock, c?.cutoffDayOffset ?? 0) : null;
    const mapSeconds = seconds ?? row.mapSeconds;

    return {
      ...row,
      stationName: station.schedule.name,
      kmFromStart: edited?.kmFromStart ?? row.kmFromStart,
      mapClockTime: clock ?? row.mapClockTime,
      mapSeconds,
      mapIsTighter: mapSeconds !== undefined && mapSeconds < row.suggestedSeconds,
    };
  });

  return { ...result, stations, cutoffTable };
}
