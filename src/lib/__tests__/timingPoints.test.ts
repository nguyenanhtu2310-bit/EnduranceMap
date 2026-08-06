import { describe, expect, it } from 'vitest';
import { matsCrossedTwice, parseTimingPoints } from '../timingPoints';

const split = (over: Record<string, unknown> = {}) => ({
  Name: 'CP1',
  Label: '',
  TimingPoint: 'CP1',
  Backup: '',
  Distance: 40.3,
  DistanceUnit: 'km',
  TypeOfSport: 100,
  ...over,
});

const file = (splits: unknown[]) => JSON.stringify({ TimeMode: {}, Splits: splits, Legs: [] });

describe('parseTimingPoints', () => {
  it('reads a split into a named point at a kilometre', () => {
    const { points } = parseTimingPoints(
      file([split({ Name: 'CP_TEL', Label: 'CP Topas Ecolodge', TimingPoint: 'CPTopas', Distance: 26.2 })])
    );
    expect(points).toEqual([
      {
        name: 'CP_TEL',
        label: 'CP Topas Ecolodge',
        mat: 'CPTopas',
        backupMat: '',
        kmFromStart: 26.2,
        sportCode: 100,
      },
    ]);
  });

  it('falls back to the name when the timer left the label blank', () => {
    expect(parseTimingPoints(file([split({ Name: 'CP3', Label: '' })])).points[0].label).toBe('CP3');
  });

  it('converts metres to kilometres', () => {
    // Real exports write the start line in metres and every checkpoint in kilometres,
    // within the same file.
    const { points } = parseTimingPoints(
      file([
        split({ Name: 'Start', TimingPoint: 'STARTLINE', Distance: 0, DistanceUnit: 'm', TypeOfSport: 255 }),
        split({ Name: 'CP1', Distance: 40.3, DistanceUnit: 'km' }),
      ])
    );
    expect(points[0].kmFromStart).toBe(0);
    expect(points[1].kmFromStart).toBe(40.3);
  });

  it('converts a distance stated in metres that is not zero', () => {
    expect(parseTimingPoints(file([split({ Distance: 1500, DistanceUnit: 'm' })])).points[0].kmFromStart)
      .toBe(1.5);
  });

  it('sorts points along the course, however the file ordered them', () => {
    const { points } = parseTimingPoints(
      file([
        split({ Name: 'CP7', Distance: 92.9 }),
        split({ Name: 'CP1', Distance: 40.3 }),
        split({ Name: 'CP3', Distance: 61.4 }),
      ])
    );
    expect(points.map((p) => p.name)).toEqual(['CP1', 'CP3', 'CP7']);
  });

  it('keeps the backup mat', () => {
    const { points } = parseTimingPoints(file([split({ Backup: 'TB_Lao_Chai' })]));
    expect(points[0].backupMat).toBe('TB_Lao_Chai');
  });

  it('skips a split with no usable distance and says which', () => {
    const { points, warnings } = parseTimingPoints(
      file([split({ Name: 'Broken', Distance: 'abc' }), split()])
    );
    expect(points).toHaveLength(1);
    expect(warnings[0]).toContain('Broken');
  });

  it('skips an entirely blank row without complaint', () => {
    const { points, warnings } = parseTimingPoints(
      file([{ Name: '', TimingPoint: '', Distance: 0, DistanceUnit: 'km' }, split()])
    );
    expect(points).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('tolerates the byte-order mark the export writes', () => {
    // Legal at the head of a UTF-8 file, and fatal to JSON.parse.
    expect(parseTimingPoints('﻿' + file([split()])).points).toHaveLength(1);
  });

  it('warns rather than throws on an empty file', () => {
    expect(parseTimingPoints('  ').warnings[0]).toMatch(/empty/i);
  });

  it('says plainly when handed something that is not a split export', () => {
    expect(() => parseTimingPoints('<?xml version="1.0"?><gpx/>')).toThrow(/not JSON/i);
    expect(() => parseTimingPoints('{"Splits":"nope"}')).toThrow(/no "Splits" list/i);
  });

  it('reports a file that parses but lists nothing', () => {
    expect(parseTimingPoints(file([])).warnings[0]).toMatch(/no timing points/i);
  });
});

describe('matsCrossedTwice', () => {
  it('finds one mat read at two kilometres', () => {
    // The real case: one crew at Lech Mong reads the 100 km field at 17.6 km and again
    // at 95.6 km — two columns in the results file, one tent, one shift.
    const { points } = parseTimingPoints(
      file([
        split({ Name: 'WS_Lech_Mong1', TimingPoint: 'WS Lech Mong', Distance: 17.6 }),
        split({ Name: 'CP1', TimingPoint: 'CP1', Distance: 40.3 }),
        split({ Name: 'WS_Lech_Mong', TimingPoint: 'WS Lech Mong', Distance: 95.6 }),
      ])
    );
    const twice = matsCrossedTwice(points);
    expect([...twice.keys()]).toEqual(['WS Lech Mong']);
    expect(twice.get('WS Lech Mong')!.map((p) => p.kmFromStart)).toEqual([17.6, 95.6]);
  });

  it('leaves a mat crossed once out', () => {
    const { points } = parseTimingPoints(file([split()]));
    expect(matsCrossedTwice(points).size).toBe(0);
  });

  it('ignores points with no mat named', () => {
    const { points } = parseTimingPoints(
      file([split({ Name: 'A', TimingPoint: '' }), split({ Name: 'B', TimingPoint: '' })])
    );
    expect(matsCrossedTwice(points).size).toBe(0);
  });
});
