import { describe, expect, it } from 'vitest';
import { parsePlacemarkLabel } from '../labels';

describe('parsePlacemarkLabel', () => {
  it('parses a km-with-race-distance label', () => {
    const result = parsePlacemarkLabel('KM7.4/42 Water Station');
    expect(result.kmFromName).toBe(7.4);
    expect(result.raceDistanceFromName).toBe(42);
    expect(result.cleanName).toBe('Water Station');
  });

  it('parses a bare km label with no race distance', () => {
    const result = parsePlacemarkLabel('KM21 Turnaround Point');
    expect(result.kmFromName).toBe(21);
    expect(result.raceDistanceFromName).toBeUndefined();
    expect(result.cleanName).toBe('Turnaround Point');
  });

  it('parses a time window', () => {
    const result = parsePlacemarkLabel('Medical Station (03:00 - 09:30)');
    expect(result.timeWindow).toEqual({ open: '03:00', close: '09:30' });
    expect(result.cleanName).toBe('Medical Station');
  });

  it('parses both km/distance and a time window together', () => {
    const result = parsePlacemarkLabel('KM10/21 Cut-off (05:30 - 08:15)');
    expect(result.kmFromName).toBe(10);
    expect(result.raceDistanceFromName).toBe(21);
    expect(result.timeWindow).toEqual({ open: '05:30', close: '08:15' });
    expect(result.cleanName).toBe('Cut-off');
  });

  it('leaves cleanName as the trimmed original when no tokens are present', () => {
    const result = parsePlacemarkLabel('  Medical Post 1  ');
    expect(result.kmFromName).toBeUndefined();
    expect(result.timeWindow).toBeUndefined();
    expect(result.cleanName).toBe('Medical Post 1');
  });

  it('handles decimal km values without a race distance', () => {
    const result = parsePlacemarkLabel('KM5.25 Aid Station');
    expect(result.kmFromName).toBe(5.25);
    expect(result.cleanName).toBe('Aid Station');
  });
});
