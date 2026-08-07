import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { passKey, runPipeline, type DistanceInput } from '../pipeline';
import {
  EMPTY_OVERRIDES,
  applyRaceOverrides,
  countOverrides,
  hasOverrides,
  setCrossingOverride,
  setStationOverride,
} from '../overrides';

const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');
const inputs: DistanceInput[] = [
  {
    courseName: '10km',
    startTimeClock: '05:00',
    runnerCount: 200,
    fastestMinPerKm: 4,
    typicalMinPerKm: 6,
    slowestMinPerKm: 9,
  },
  {
    courseName: 'Half Marathon',
    startTimeClock: '04:30',
    runnerCount: 200,
    fastestMinPerKm: 4,
    typicalMinPerKm: 6,
    slowestMinPerKm: 9,
  },
];

const base = runPipeline(kml, inputs);

describe('editing an override set', () => {
  it('starts empty', () => {
    expect(hasOverrides(EMPTY_OVERRIDES)).toBe(false);
    expect(countOverrides(EMPTY_OVERRIDES)).toBe(0);
  });

  it('records a station edit without touching the others', () => {
    const o = setStationOverride(EMPTY_OVERRIDES, 'CP 1', 'openClockTime', '04:00');
    expect(o.stations['CP 1']).toEqual({ openClockTime: '04:00' });
    expect(countOverrides(o)).toBe(1);
  });

  it('drops the entry entirely once its last edit is cleared', () => {
    let o = setStationOverride(EMPTY_OVERRIDES, 'CP 1', 'openClockTime', '04:00');
    o = setStationOverride(o, 'CP 1', 'openClockTime', undefined);
    expect(o.stations['CP 1']).toBeUndefined();
    expect(hasOverrides(o)).toBe(false);
  });

  it('treats an empty string as a clear, so deleting the field reverts it', () => {
    let o = setStationOverride(EMPTY_OVERRIDES, 'CP 1', 'name', 'Water point');
    o = setStationOverride(o, 'CP 1', 'name', '');
    expect(hasOverrides(o)).toBe(false);
  });

  it('never mutates the set it was given', () => {
    const o = setStationOverride(EMPTY_OVERRIDES, 'CP 1', 'name', 'X');
    expect(EMPTY_OVERRIDES.stations).toEqual({});
    expect(o.stations['CP 1'].name).toBe('X');
  });
});

describe('applying overrides to a computed plan', () => {
  const station = base.stations[0];

  it('returns the result untouched when nothing is edited', () => {
    expect(applyRaceOverrides(base, EMPTY_OVERRIDES)).toBe(base);
  });

  it('replaces a station name, open and close time', () => {
    let o = setStationOverride(EMPTY_OVERRIDES, station.mapName, 'name', 'Water point A');
    o = setStationOverride(o, station.mapName, 'openClockTime', '03:15');
    o = setStationOverride(o, station.mapName, 'closeClockTime', '11:45');

    const edited = applyRaceOverrides(base, o).stations.find((s) => s.mapName === station.mapName)!;
    expect(edited.schedule.name).toBe('Water point A');
    expect(edited.schedule.openClockTime).toBe('03:15:00');
    expect(edited.schedule.closeClockTime).toBe('11:45:00');
  });

  it('replaces the activity level, which drives the amenity defaults', () => {
    const o = setStationOverride(EMPTY_OVERRIDES, station.mapName, 'activityLevel', 'Low');
    const edited = applyRaceOverrides(base, o).stations.find((s) => s.mapName === station.mapName)!;
    expect(edited.schedule.activityLevel).toBe('Low');
  });

  it('replaces the kilometre of one pass, leaving the other passes alone', () => {
    const crossing = station.crossings[0];
    const key = passKey(station.mapName, crossing.courseName, crossing.passIndex);
    const o = setCrossingOverride(EMPTY_OVERRIDES, key, 'kmFromStart', 12.5);

    const edited = applyRaceOverrides(base, o).stations.find((s) => s.mapName === station.mapName)!;
    expect(edited.crossings[0].kmFromStart).toBe(12.5);
    for (let i = 1; i < edited.crossings.length; i++) {
      expect(edited.crossings[i].kmFromStart).toBe(station.crossings[i].kmFromStart);
    }
  });

  /** The row, the crossing that owns it, and the key that edits that crossing. */
  function firstCutoff() {
    const row = base.cutoffTable[0];
    const owner = base.stations.find((s) => s.schedule.name === row.stationName)!;
    const pass = owner.crossings.find(
      (c) => c.courseName === row.courseName && Math.abs(c.kmFromStart - row.kmFromStart) < 1e-6
    )!;
    return { row, owner, pass, key: passKey(owner.mapName, row.courseName, pass.passIndex) };
  }

  it('carries an edited cut-off in as the organiser’s, not as a new proposal', () => {
    // A cut-off typed by hand is a decision the race has made. It used to land on the
    // proposal instead, which put the tool's own suggestion and the director's decision
    // in one column and left nothing to compare against.
    const { owner, pass, key } = firstCutoff();
    const o = setCrossingOverride(EMPTY_OVERRIDES, key, 'cutoffClock', '10:45');
    const applied = applyRaceOverrides(base, o);

    expect(applied.cutoffTable[0].mapClockTime).toBe('10:45:00');
    expect(applied.cutoffTable[0].suggestedClockTime).toBe(base.cutoffTable[0].suggestedClockTime);

    const editedStation = applied.stations.find((s) => s.mapName === owner.mapName)!;
    expect(editedStation.crossings.find((c) => c.passIndex === pass.passIndex)!.officialCutoffClock).toBe('10:45:00');
  });

  it('puts an edited cut-off on the day it was given, not the first', () => {
    // The whole reason the day is stored beside the clock: "01:30" at a checkpoint is the
    // small hours of the Saturday for one distance and of the Sunday for another, and a
    // 100 miles has both. Compared as a bare clock it lands before the arrivals it is
    // meant to sit after, and the margin comes out hours negative.
    const { key } = firstCutoff();
    let o = setCrossingOverride(EMPTY_OVERRIDES, key, 'cutoffClock', '01:30');
    o = setCrossingOverride(o, key, 'cutoffDayOffset', 2);
    const applied = applyRaceOverrides(base, o);

    expect(applied.cutoffTable[0].mapSeconds).toBe(2 * 86400 + 90 * 60);
    // And the seconds agree with the clock rather than being left behind by it.
    expect(applied.cutoffTable[0].mapClockTime).toBe('01:30:00');
  });

  it('says whether an edited cut-off is tighter than the proposal', () => {
    const { key } = firstCutoff();
    const suggested = base.cutoffTable[0].suggestedSeconds;

    const tight = applyRaceOverrides(
      base,
      setCrossingOverride(EMPTY_OVERRIDES, key, 'cutoffClock', '00:01')
    );
    expect(tight.cutoffTable[0].mapSeconds!).toBeLessThan(suggested);
    expect(tight.cutoffTable[0].mapIsTighter).toBe(true);

    let loose = setCrossingOverride(EMPTY_OVERRIDES, key, 'cutoffClock', '01:00');
    loose = setCrossingOverride(loose, key, 'cutoffDayOffset', 3);
    expect(applyRaceOverrides(base, loose).cutoffTable[0].mapIsTighter).toBe(false);
  });

  it('keeps a renamed station attached to its cut-off rows', () => {
    const row = base.cutoffTable[0];
    const owner = base.stations.find((s) => s.schedule.name === row.stationName)!;
    const o = setStationOverride(EMPTY_OVERRIDES, owner.mapName, 'name', 'Renamed CP');

    const applied = applyRaceOverrides(base, o);
    expect(applied.cutoffTable.some((r) => r.stationName === 'Renamed CP')).toBe(true);
  });

  it('ignores an unparseable time rather than corrupting the schedule', () => {
    const o = setStationOverride(EMPTY_OVERRIDES, station.mapName, 'openClockTime', 'later');
    const edited = applyRaceOverrides(base, o).stations.find((s) => s.mapName === station.mapName)!;
    expect(edited.schedule.openClockTime).toBe(station.schedule.openClockTime);
  });

  it('survives a recalculation — edits are keyed to the map, not to row order', () => {
    const o = setStationOverride(EMPTY_OVERRIDES, station.mapName, 'name', 'Sticky name');
    const recomputed = runPipeline(kml, inputs);
    const applied = applyRaceOverrides(recomputed, o);
    expect(applied.stations.find((s) => s.mapName === station.mapName)!.schedule.name).toBe('Sticky name');
  });
});
