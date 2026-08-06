import { describe, expect, it } from 'vitest';
import { nameStations, stationLabel, type PlacemarkCrossing } from '../stationNaming';
import type { TimingPoint } from '../timingPoints';

const point = (name: string, kmFromStart: number, label = ''): TimingPoint => ({
  name,
  label: label || name,
  mat: name,
  backupMat: '',
  kmFromStart,
  sportCode: 100,
});

const crossing = (key: string, kmFromStart: number, name = key): PlacemarkCrossing => ({
  key,
  name,
  kmFromStart,
});

describe('nameStations', () => {
  it('gives a placeholder pin the name the timing system uses', () => {
    const result = nameStations(
      [crossing('a', 26.2, 'Điểm 5')],
      [point('CP_TEL', 26.2, 'CP Topas Ecolodge')],
      { measuredTotalKm: 26.2 }
    );
    expect(result.stations[0].timingPoint?.name).toBe('CP_TEL');
    expect(stationLabel(result.stations[0])).toBe('CP Topas Ecolodge');
  });

  it('scales declared kilometres onto measured ones', () => {
    // The real gap: a 100 km the timer calls 101.6 measures 103.79 on its own GPX, so a
    // checkpoint declared at 95.6 actually sits near 97.7 — two kilometres out.
    const points = [point('WS_Lech_Mong', 95.6), point('Finish', 101.6)];
    const result = nameStations(
      [crossing('a', 97.66), crossing('b', 103.79)],
      points,
      { measuredTotalKm: 103.79 }
    );
    expect(result.scale).toBeCloseTo(1.0216, 4);
    expect(result.stations[0].timingPoint?.name).toBe('WS_Lech_Mong');
    expect(result.stations[1].timingPoint?.name).toBe('Finish');
  });

  it('would mismatch without the scaling, which is why it is there', () => {
    // Same pins, but told the course measures exactly what the timer declared.
    const result = nameStations(
      [crossing('a', 97.66)],
      [point('WS_Lech_Mong', 95.6), point('Finish', 101.6)],
      { measuredTotalKm: 101.6, toleranceKm: 1.5 }
    );
    expect(result.stations[0].timingPoint).toBeNull();
  });

  it('keeps two points 50 m apart on their own pins', () => {
    // A real course puts its announcer 50 m before its finish line.
    const result = nameStations(
      [crossing('announcer', 101.55), crossing('finish', 101.6)],
      [point('Announcer', 101.55), point('Finish', 101.6)],
      { measuredTotalKm: 101.6 }
    );
    expect(result.stations[0].timingPoint?.name).toBe('Announcer');
    expect(result.stations[1].timingPoint?.name).toBe('Finish');
  });

  it('leaves a pin with no mat on it unnamed rather than guessing', () => {
    // A water station without timing is still a station — it just is not a timing point,
    // and its traffic is modelled rather than counted.
    const result = nameStations(
      [crossing('ws', 30, 'Water only'), crossing('cp', 40.3)],
      [point('CP1', 40.3)],
      { measuredTotalKm: 40.3 }
    );
    expect(result.stations[0].timingPoint).toBeNull();
    expect(stationLabel(result.stations[0])).toBe('Water only');
    expect(result.stations[1].timingPoint?.name).toBe('CP1');
  });

  it('reports a mat nobody drew a pin for', () => {
    const result = nameStations([crossing('a', 10)], [point('CP1', 10), point('CP2', 50)], {
      measuredTotalKm: 50,
    });
    expect(result.unmatchedPoints.map((p) => p.name)).toEqual(['CP2']);
  });

  it('never gives one timing point to two pins, and the nearer pin takes it', () => {
    const result = nameStations(
      [crossing('near', 40.25), crossing('far', 40.9)],
      [point('CP1', 40.3)],
      { measuredTotalKm: 40.3, declaredTotalKm: 40.3 }
    );
    const matched = result.stations.filter((s) => s.timingPoint);
    expect(matched).toHaveLength(1);
    expect(matched[0].crossing.key).toBe('near');
  });

  it('settles the closest pair first, not the first in course order', () => {
    // Pin A is near both mats; pin B is only near the second. Taking them in order would
    // hand A the second mat and leave B with nothing.
    const result = nameStations(
      [crossing('a', 10.0), crossing('b', 10.9)],
      [point('early', 9.9), point('late', 11.0)],
      { measuredTotalKm: 11.0, toleranceKm: 1.5 }
    );
    expect(result.stations[0].timingPoint?.name).toBe('early');
    expect(result.stations[1].timingPoint?.name).toBe('late');
  });

  it('refuses a match beyond the tolerance', () => {
    const result = nameStations([crossing('a', 10)], [point('CP1', 30)], {
      measuredTotalKm: 30,
      toleranceKm: 1.5,
    });
    expect(result.stations[0].timingPoint).toBeNull();
    expect(result.unmatchedPoints).toHaveLength(1);
  });

  it('reports how far off each match was, so a bad one is visible', () => {
    const result = nameStations([crossing('a', 40.9)], [point('CP1', 40.3)], {
      measuredTotalKm: 40.3,
    });
    expect(result.stations[0].deltaKm).toBeCloseTo(0.6, 6);
  });

  it('copes with no timing points at all', () => {
    const result = nameStations([crossing('a', 10)], [], { measuredTotalKm: 10 });
    expect(result.stations[0].timingPoint).toBeNull();
    expect(result.scale).toBe(1);
  });

  it('copes with no crossings at all', () => {
    const result = nameStations([], [point('CP1', 10)], { measuredTotalKm: 10 });
    expect(result.stations).toEqual([]);
    expect(result.unmatchedPoints).toHaveLength(1);
  });

  it('takes a declared length when told one, rather than the furthest point', () => {
    // The furthest timing point is the finish on most courses, but not all: a race can
    // read a mat past its own finish line, and the declared length is what to scale by.
    const result = nameStations([crossing('a', 51)], [point('CP1', 50)], {
      measuredTotalKm: 102,
      declaredTotalKm: 100,
    });
    expect(result.scale).toBe(1.02);
    expect(result.stations[0].timingPoint?.name).toBe('CP1');
  });
});
