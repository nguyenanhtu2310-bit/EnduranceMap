import { describe, expect, it } from 'vitest';
import {
  MIXED_DISTANCE_SPREAD,
  measureDistanceKm,
  measureFromCandidates,
  parseRate,
  tidyKm,
} from '../distances';

describe('parseRate', () => {
  it.each([
    ['4:01/km', 241],
    ['4:01 /km', 241],
    ['5:20', 320],
    ['1:35/100m', 950],
    ['1:35 / 100 m', 950],
  ])('reads %s as %i seconds per km', (text, seconds) => {
    expect(parseRate(text)?.secondsPerKm).toBeCloseTo(seconds, 6);
  });

  it('turns a speed into a pace', () => {
    // 34.7 km/h is 3600/34.7 seconds for each kilometre.
    expect(parseRate('34.7 km/h')?.secondsPerKm).toBeCloseTo(103.746, 3);
    expect(parseRate('20 mph')?.secondsPerKm).toBeCloseTo(3600 / 32.18688, 3);
  });

  it('keeps how it was written, for the note shown to the operator', () => {
    expect(parseRate(' 34.7 km/h ')?.written).toBe('34.7 km/h');
  });

  it.each(['', undefined, '—', 'n/a', '0:00', '0 km/h'])('rejects %s', (text) => {
    expect(parseRate(text)).toBeNull();
  });
});

describe('measureDistanceKm', () => {
  /** A field whose stated pace is rounded to the second, as a real export's is. */
  function field(trueKm: number, paceSecondsPerKm: number[], jitter = 0) {
    return paceSecondsPerKm.map((pace, i) => ({
      seconds: Math.round(trueKm * pace) + (i % 2 ? jitter : -jitter),
      rate: `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, '0')}/km`,
    }));
  }

  it('recovers the distance from duration times stated pace', () => {
    const measured = measureDistanceKm(field(21.1, [300, 330, 360, 390, 420, 450]))!;
    expect(measured.km).toBeCloseTo(21.1, 1);
    expect(measured.consistent).toBe(true);
  });

  it('is not fooled by a slow field, which is where guessing from times fails', () => {
    // Everyone at eleven minutes a kilometre still measures ten kilometres.
    const measured = measureDistanceKm(field(10, [660, 665, 670, 675, 680, 690]))!;
    expect(measured.km).toBeCloseTo(10, 1);
  });

  it('reports a wide spread when one contest holds several courses', () => {
    // A kids race runs three ages over different distances under one name.
    const mixed = [...field(3, [420, 430, 440]), ...field(6, [420, 430, 440])];
    const measured = measureDistanceKm(mixed)!;
    expect(measured.spread).toBeGreaterThan(MIXED_DISTANCE_SPREAD);
    expect(measured.consistent).toBe(false);
  });

  it('refuses to measure from a handful of rows', () => {
    expect(measureDistanceKm(field(10, [300, 310]))).toBeNull();
  });

  it('ignores rows missing a rate or a time', () => {
    const pairs = [
      ...field(5, [300, 310, 320, 330, 340]),
      { seconds: 0, rate: '5:00/km' },
      { seconds: 1500, rate: undefined },
    ];
    expect(measureDistanceKm(pairs)!.count).toBe(5);
  });
});

describe('measureFromCandidates', () => {
  it('picks the duration column that agrees with the stated pace', () => {
    // The pace was computed from chip time; pairing gun time scatters the answer.
    const paces = [300, 330, 360, 390, 420, 450];
    const chip = paces.map((p) => ({ seconds: 10 * p, rate: `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` }));
    const gun = paces.map((p, i) => ({ seconds: 10 * p + i * 240, rate: chip[i].rate }));

    const best = measureFromCandidates([
      { label: 'GunTime', pairs: gun },
      { label: 'ChipTime', pairs: chip },
    ])!;

    expect(best.from).toBe('ChipTime');
    expect(best.measurement.km).toBeCloseTo(10, 6);
  });
});

describe('tidyKm', () => {
  it.each([
    [66.0234, 66],
    [5.5831, 5.58],
    [21.0975, 21.1],
    [0.7531, 0.75],
  ])('rounds %f to %f', (raw, expected) => {
    expect(tidyKm(raw)).toBe(expected);
  });
});
