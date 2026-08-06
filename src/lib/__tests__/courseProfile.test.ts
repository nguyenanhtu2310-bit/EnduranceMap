import { describe, expect, it } from 'vitest';
import { layoutLabels, resampleProfile, stationMarks } from '../courseProfile';

const station = (name: string, isTimed: boolean, crossings: [string, number, number, number][]) => ({
  isTimed,
  schedule: { name },
  crossings: crossings.map(([courseName, kmFromStart, passIndex, passCount]) => ({
    courseName,
    kmFromStart,
    passIndex,
    passCount,
  })),
});

describe('stationMarks', () => {
  it('takes only the stations one course passes', () => {
    const marks = stationMarks(
      [station('CP1', true, [['100K', 40.3, 0, 1]]), station('CP9', true, [['70K', 9, 0, 1]])],
      '100K'
    );
    expect(marks.map((m) => m.name)).toEqual(['CP1']);
  });

  it('gives a mat crossed twice two marks, hours apart on the profile', () => {
    const marks = stationMarks(
      [station('WS Lech Mong', true, [['100K', 17.6, 0, 2], ['100K', 95.6, 1, 2]])],
      '100K'
    );
    expect(marks.map((m) => m.kmFromStart)).toEqual([17.6, 95.6]);
    expect(marks.map((m) => m.passIndex)).toEqual([0, 1]);
  });

  it('orders them the way the course meets them', () => {
    const marks = stationMarks(
      [
        station('CP3', true, [['100K', 61.4, 0, 1]]),
        station('CP1', true, [['100K', 40.3, 0, 1]]),
        station('CP2', true, [['100K', 53.7, 0, 1]]),
      ],
      '100K'
    );
    expect(marks.map((m) => m.kmFromStart)).toEqual([40.3, 53.7, 61.4]);
  });

  it('keeps the untimed ones, and says which they are', () => {
    // They still need a crew and still belong on the profile; what they cannot do is
    // confirm anybody passed.
    const marks = stationMarks(
      [station('Water only', false, [['100K', 30, 0, 1]]), station('CP1', true, [['100K', 40.3, 0, 1]])],
      '100K'
    );
    expect(marks.map((m) => m.isTimed)).toEqual([false, true]);
  });

  it('returns nothing for a course with no stations on it', () => {
    expect(stationMarks([station('CP1', true, [['100K', 40.3, 0, 1]])], '10K')).toEqual([]);
  });
});

describe('resampleProfile', () => {
  const profile = Array.from({ length: 1000 }, (_, i) => ({ cumulativeKm: i / 10, ele: 1000 + i }));

  it('thins to the number of columns asked for', () => {
    expect(resampleProfile(profile, 100).length).toBeLessThanOrEqual(100);
  });

  it('keeps the highest and lowest reading in each column', () => {
    // Sampling every nth point would drop the summits, which is the one thing anybody
    // reads a profile for.
    const spiky = [
      { cumulativeKm: 0, ele: 100 },
      { cumulativeKm: 1, ele: 2000 },
      { cumulativeKm: 2, ele: 100 },
    ];
    const bands = resampleProfile(spiky, 1);
    expect(bands[0].high).toBe(2000);
    expect(bands[0].low).toBe(100);
  });

  it('copes with an empty profile', () => {
    expect(resampleProfile([], 10)).toEqual([]);
  });
});

describe('layoutLabels', () => {
  const wide = (x: number) => ({ x, text: 'CP Topas Ecolodge (2)' });

  it('leaves well-spaced labels all on the top row', () => {
    const out = layoutLabels([{ x: 0, text: 'A' }, { x: 400, text: 'B' }, { x: 800, text: 'C' }], {
      width: 900,
    });
    expect(out.placed.every((p) => p.row === 0)).toBe(true);
    expect(out.rows).toBe(1);
  });

  it('pushes a label that would touch its neighbour onto the next row', () => {
    const out = layoutLabels([wide(200), wide(230)], { width: 900 });
    expect(out.placed.map((p) => p.row).sort()).toEqual([0, 1]);
  });

  it('measures the label rather than assuming them all the same width', () => {
    // Two short names fit side by side where two long ones would not.
    const short = layoutLabels([{ x: 200, text: 'CP5' }, { x: 230, text: 'CP6' }], { width: 900 });
    expect(short.rows).toBe(1);
    expect(layoutLabels([wide(200), wide(230)], { width: 900 }).rows).toBe(2);
  });

  it('anchors a label at the start of the axis so it leans inwards', () => {
    expect(layoutLabels([wide(2)], { width: 900 }).placed[0].anchor).toBe('start');
    expect(layoutLabels([wide(898)], { width: 900 }).placed[0].anchor).toBe('end');
    expect(layoutLabels([wide(450)], { width: 900 }).placed[0].anchor).toBe('middle');
  });

  it('drops a label with nowhere left rather than printing it over another', () => {
    const crowded = Array.from({ length: 12 }, (_, i) => wide(300 + i));
    const out = layoutLabels(crowded, { width: 900, maxRows: 3 });
    expect(out.dropped.length).toBeGreaterThan(0);
    expect(out.rows).toBeLessThanOrEqual(3);
  });

  it('reports rows against the marks they belong to, whatever order they came in', () => {
    const out = layoutLabels([wide(800), wide(100)], { width: 900 });
    expect(out.placed.find((p) => p.index === 0)!.x).toBe(800);
    expect(out.placed.find((p) => p.index === 1)!.x).toBe(100);
  });

  it('copes with no labels at all', () => {
    expect(layoutLabels([], { width: 900 })).toEqual({ placed: [], rows: 0, dropped: [] });
  });
});
