import { describe, expect, it } from 'vitest';
import { buildCourse } from '../geo';
import { lengthOf, mapToSpine, spineKmOf } from '../spine';

/** A straight north-south line, so kilometres and geometry are easy to reason about. */
const line = (fromLat: number, toLat: number, lon = 103.84, steps = 200) =>
  buildCourse(
    Array.from({ length: steps + 1 }, (_, i) => ({
      lat: fromLat + ((toLat - fromLat) * i) / steps,
      lon,
    }))
  );

describe('mapToSpine', () => {
  it('maps a course that runs the first half of the spine', () => {
    const spine = line(22.0, 22.9);
    const half = line(22.0, 22.45);
    const mapping = mapToSpine(half, spine, 'half');

    expect(mapping.coverage).toBeGreaterThan(0.98);
    expect(spineKmOf(mapping, 0)).toBeCloseTo(0, 1);
    const end = lengthOf(half);
    expect(spineKmOf(mapping, end)).toBeCloseTo(end, 0);
  });

  it('reports ground the spine never touches instead of inventing a position', () => {
    // A course on its own road, a long way off the spine.
    const spine = line(22.0, 22.9, 103.84);
    const elsewhere = line(22.0, 22.4, 104.5);
    const mapping = mapToSpine(elsewhere, spine, 'elsewhere');
    expect(mapping.coverage).toBe(0);
    expect(spineKmOf(mapping, 10)).toBeNull();
  });

  it('measures partial coverage rather than calling it all or nothing', () => {
    // Half on the spine's road, half on its own — the shape of a real 10 km.
    const spine = line(22.0, 22.9, 103.84);
    const partly = buildCourse([
      ...Array.from({ length: 100 }, (_, i) => ({ lat: 22.0 + i * 0.002, lon: 103.84 })),
      ...Array.from({ length: 100 }, (_, i) => ({ lat: 22.2 + i * 0.002, lon: 104.5 })),
    ]);
    const mapping = mapToSpine(partly, spine, 'partly');
    expect(mapping.coverage).toBeGreaterThan(0.3);
    expect(mapping.coverage).toBeLessThan(0.7);
  });

  it('puts a station at the same spine kilometre whichever course reaches it', () => {
    // The whole point: one place, one column, whatever a course calls its distance.
    const spine = line(22.0, 22.9);
    const shorter = line(22.3, 22.9);
    const mapping = mapToSpine(shorter, spine, 'shorter');
    // 10 km along the shorter course is 10 km further up the spine than its own start.
    const shorterStartOnSpine = spineKmOf(mapping, 0)!;
    expect(spineKmOf(mapping, 10)! - shorterStartOnSpine).toBeCloseTo(10, 0);
  });

  it('returns nothing usable for an empty course', () => {
    expect(mapToSpine([], line(22.0, 22.9), 'none').coverage).toBe(0);
    expect(spineKmOf({ courseName: 'none', samples: [], coverage: 0 }, 5)).toBeNull();
  });
});
