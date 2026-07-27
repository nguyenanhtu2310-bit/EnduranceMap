import { describe, expect, it } from 'vitest';
import {
  AMENITIES,
  DEFAULT_AMENITY_RULES,
  resolveAmenities,
  totalAmenities,
} from '../amenities';

describe('resolveAmenities', () => {
  it('gives every station the basics regardless of traffic', () => {
    for (const level of ['Low', 'Medium', 'High'] as const) {
      const set = resolveAmenities(level, DEFAULT_AMENITY_RULES, undefined);
      expect(set.water).toBe(true);
      expect(set.electrolyte).toBe(true);
      expect(set.portaToilet).toBe(true);
    }
  });

  it('adds solid food only from medium traffic upward', () => {
    expect(resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined).banana).toBe(false);
    expect(resolveAmenities('Medium', DEFAULT_AMENITY_RULES, undefined).banana).toBe(true);
  });

  it('reserves medical cover for the busiest stations', () => {
    expect(resolveAmenities('Medium', DEFAULT_AMENITY_RULES, undefined).ambulance).toBe(false);
    expect(resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined).ambulance).toBe(true);
  });

  it('lets a hand edit win over the rule, in both directions', () => {
    const added = resolveAmenities('Low', DEFAULT_AMENITY_RULES, { medical: true });
    expect(added.medical).toBe(true);

    const removed = resolveAmenities('High', DEFAULT_AMENITY_RULES, { ambulance: false });
    expect(removed.ambulance).toBe(false);
  });

  it('leaves untouched amenities following the rule when one is edited', () => {
    const set = resolveAmenities('Low', DEFAULT_AMENITY_RULES, { medical: true });
    expect(set.water).toBe(true);
    expect(set.banana).toBe(false);
  });

  it('reports every known amenity so a row never has holes', () => {
    const set = resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined);
    expect(Object.keys(set).sort()).toEqual(AMENITIES.map((a) => a.key).sort());
  });
});

describe('totalAmenities', () => {
  it('counts each column across the stops', () => {
    const totals = totalAmenities([
      resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined),
      resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined),
    ]);
    expect(totals.water).toBe(2);
    expect(totals.ambulance).toBe(1);
  });

  it('returns zeroes rather than nothing for an empty course', () => {
    const totals = totalAmenities([]);
    expect(totals.water).toBe(0);
    expect(Object.keys(totals)).toHaveLength(AMENITIES.length);
  });
});
