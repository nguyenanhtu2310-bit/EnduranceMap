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

  it('parses a two-time operating window', () => {
    const result = parsePlacemarkLabel('MEDICAL 1 (03:00 - 09:30)');
    expect(result.timeWindow).toEqual({ open: '03:00', close: '09:30' });
    expect(result.cutoffs).toEqual([]);
    expect(result.cleanName).toBe('MEDICAL 1');
  });

  it('keeps trailing notes outside the window in the display name', () => {
    const result = parsePlacemarkLabel('MEDICAL 5 (03:00 - 06:00) -> S7');
    expect(result.timeWindow).toEqual({ open: '03:00', close: '06:00' });
    expect(result.cleanName).toBe('MEDICAL 5 -> S7');
  });

  it('leaves cleanName as the trimmed original when no tokens are present', () => {
    const result = parsePlacemarkLabel('  Medical Post 1  ');
    expect(result.kmFromName).toBeUndefined();
    expect(result.cleanName).toBe('Medical Post 1');
  });

  describe('real cut-off formats', () => {
    it('parses a single km/distance with an AM cut-off', () => {
      const result = parsePlacemarkLabel('COT 1 (KM7.4/42 - 4:10 AM)');
      expect(result.cutoffs).toHaveLength(1);
      expect(result.cutoffs[0]).toMatchObject({ km: 7.4, raceDistanceKm: 42, cutoffClock: '4:10 AM' });
      expect(result.cutoffs[0].cutoffSeconds).toBe(4 * 3600 + 10 * 60);
      expect(result.cleanName).toBe('COT 1');
    });

    it('applies one cut-off time to every distance it names', () => {
      const result = parsePlacemarkLabel('COT 4 Đi (KM15.3/42 & KM10.3/21 - 5:25 AM)');
      expect(result.cutoffs).toHaveLength(2);
      expect(result.cutoffs[0]).toMatchObject({ km: 15.3, raceDistanceKm: 42 });
      expect(result.cutoffs[1]).toMatchObject({ km: 10.3, raceDistanceKm: 21 });
      expect(result.cutoffs.every((c) => c.cutoffClock === '5:25 AM')).toBe(true);
      expect(result.cleanName).toBe('COT 4 Đi');
    });

    it('parses two separate cut-off windows in one name', () => {
      const result = parsePlacemarkLabel('COT 5 (KM14.5/21 - 5:55 AM) (KM35.5/42 - 8:30 AM)');
      expect(result.cutoffs).toHaveLength(2);
      expect(result.cutoffs[0]).toMatchObject({ km: 14.5, raceDistanceKm: 21, cutoffClock: '5:55 AM' });
      expect(result.cutoffs[1]).toMatchObject({ km: 35.5, raceDistanceKm: 42, cutoffClock: '8:30 AM' });
      expect(result.timeWindow).toBeUndefined();
    });

    it('parses a km mark written without the KM prefix', () => {
      const result = parsePlacemarkLabel('COT 7 (27.5/42 - 7:15 AM)');
      expect(result.cutoffs[0]).toMatchObject({ km: 27.5, raceDistanceKm: 42, cutoffClock: '7:15 AM' });
    });

    it('normalizes a malformed km value and warns instead of dropping the checkpoint', () => {
      const result = parsePlacemarkLabel('COT 5 (KM14.4.5/21 - 5:55 AM)');
      expect(result.kmMarks[0]).toMatchObject({ km: 14.5, raceDistanceKm: 21, rawText: '14.4.5' });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('14.4.5');
    });

    it('returns nothing parseable for a bare name', () => {
      const result = parsePlacemarkLabel('PRE-FINISH');
      expect(result.kmMarks).toEqual([]);
      expect(result.cutoffs).toEqual([]);
      expect(result.cleanName).toBe('PRE-FINISH');
    });
  });

  describe('U-turn distance lists', () => {
    it('reads the distances a U-turn serves without treating them as km positions', () => {
      const result = parsePlacemarkLabel('U-turn 21km/10km: Võ Văn Kiệt');
      expect(result.distancesServed).toEqual([21, 10]);
      expect(result.kmMarks).toEqual([]);
      // The distances stay in the display name: they are what tells this U-turn apart
      // from the 42km U-turn on the same street.
      expect(result.cleanName).toBe('U-turn 21km/10km: Võ Văn Kiệt');
    });

    it('handles a single-distance U-turn', () => {
      const result = parsePlacemarkLabel('U-turn 42km: Lê Hiến Mai');
      expect(result.distancesServed).toEqual([42]);
      expect(result.cleanName).toBe('U-turn 42km: Lê Hiến Mai');
    });
  });

  it('normalizes the non-breaking spaces Google My Maps embeds in names', () => {
    // The gap before '(' below is a real U+00A0, exactly as Google My Maps exports it.
    const result = parsePlacemarkLabel('MEDICAL 3 (03:00 - 05:15)');
    expect(result.timeWindow).toEqual({ open: '03:00', close: '05:15' });
    expect(result.cleanName).toBe('MEDICAL 3');
  });
});
