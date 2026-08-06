import { describe, expect, it } from 'vitest';
import { cutoffEffect } from '../cutoffEffect';

const H = (h: number) => h * 3600;

describe('cutoffEffect', () => {
  const base = {
    startSeconds: 0,
    effortFraction: 0.5,
    finishLimitSeconds: H(28),
  };

  it('counts who the cut-off leaves behind', () => {
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(10), H(12), H(14), H(16)],
      cutoffSeconds: H(13),
    });
    expect(out.caught).toBe(2);
    expect(out.fieldSize).toBe(4);
    expect(out.share).toBe(0.5);
  });

  it('leaves nobody behind when everyone is through in time', () => {
    const out = cutoffEffect({ ...base, arrivalsSeconds: [H(10), H(11)], cutoffSeconds: H(13) });
    expect(out.caught).toBe(0);
    expect(out.share).toBe(0);
  });

  it('asks for nothing extra when the effort and the time line up', () => {
    // Halfway through the effort, half the finish limit allowed.
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(10)],
      cutoffSeconds: H(14),
      effortFraction: 0.5,
    });
    expect(out.demandedSpeedUp).toBeCloseTo(0, 6);
  });

  it('names the speed-up a tight cut-off demands', () => {
    // The real case: CP2 sits at 51.5% of the effort and must be reached in 42.9% of the
    // time, so a runner pacing to use all 28 hours is eliminated there.
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(10)],
      cutoffSeconds: H(12),
      effortFraction: 0.515,
    });
    expect(out.demandedSpeedUp).toBeCloseTo(0.2017, 3);
  });

  it('reports slack as slack rather than as a tighter cut-off', () => {
    // The 50 km inherits the 70 km's times and arrives with hours in hand.
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(8)],
      cutoffSeconds: H(18),
      effortFraction: 0.5,
    });
    expect(out.demandedSpeedUp).toBeLessThan(0);
  });

  it('measures the margin against the last one through', () => {
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(10), H(12)],
      cutoffSeconds: H(13),
    });
    expect(out.marginSeconds).toBe(H(1));
  });

  it('reports a negative margin where the field runs past the cut-off', () => {
    const out = cutoffEffect({ ...base, arrivalsSeconds: [H(14)], cutoffSeconds: H(13) });
    expect(out.marginSeconds).toBe(-H(1));
  });

  it('says nothing about speed where there is no finish limit to compare against', () => {
    const out = cutoffEffect({
      ...base,
      arrivalsSeconds: [H(10)],
      cutoffSeconds: H(13),
      finishLimitSeconds: null,
    });
    expect(out.demandedSpeedUp).toBeNull();
  });

  it('copes with a crossing nobody reached', () => {
    const out = cutoffEffect({ ...base, arrivalsSeconds: [], cutoffSeconds: H(13) });
    expect(out).toMatchObject({ caught: 0, fieldSize: 0, share: 0, marginSeconds: null });
  });
});

import { cutoffEffects, cutoffKey } from '../cutoffEffect';
import { eventSecondsFrom } from '../time';

describe('cutoffEffects across a whole result', () => {
  /** A course whose median runner finishes in 20 h, with a checkpoint at half the effort. */
  const result = {
    distanceInputs: [{ courseName: '100K', startTimeClock: '05:00', startDayOffset: 1 }],
    stations: [
      {
        schedule: {
          name: 'CP2',
          crossings: [
            {
              courseName: '100K',
              kmFromStart: 50,
              arrivalPercentiles: [{ percentile: 50, seconds: eventSecondsFrom('15:00', 1)! }],
              runnerArrivalsSeconds: [
                eventSecondsFrom('14:00', 1)!,
                eventSecondsFrom('15:00', 1)!,
                eventSecondsFrom('18:00', 1)!,
                eventSecondsFrom('19:00', 1)!,
              ],
            },
          ],
        },
      },
      {
        schedule: {
          name: 'Finish',
          crossings: [
            {
              courseName: '100K',
              kmFromStart: 100,
              arrivalPercentiles: [{ percentile: 50, seconds: eventSecondsFrom('01:00', 2)! }],
              runnerArrivalsSeconds: [eventSecondsFrom('01:00', 2)!],
            },
          ],
        },
      },
    ],
    cutoffTable: [
      {
        stationName: 'CP2',
        courseName: '100K',
        kmFromStart: 50,
        mapSeconds: eventSecondsFrom('17:00', 1)!,
        suggestedSeconds: eventSecondsFrom('19:30', 1)!,
      },
    ],
  };

  it('counts who a provided cut-off leaves behind', () => {
    const effect = cutoffEffects(result, eventSecondsFrom).get(cutoffKey('CP2', '100K', 50))!;
    // 18:00 and 19:00 are past a 17:00 cut-off.
    expect(effect).toMatchObject({ caught: 2, fieldSize: 4, share: 0.5 });
  });

  it('measures the effort from the field rather than from the ground', () => {
    // The median reaches CP2 ten hours in and finishes at twenty, so CP2 is half the
    // effort — and a 17:00 cut-off allows twelve of those twenty hours, which is slack.
    const effect = cutoffEffects(result, eventSecondsFrom).get(cutoffKey('CP2', '100K', 50))!;
    expect(effect.demandedSpeedUp).toBeCloseTo(10 / 12 - 1, 6);
    expect(effect.demandedSpeedUp).toBeLessThan(0);
  });

  it('says nothing about a crossing with no cut-off provided', () => {
    const none = cutoffEffects(
      { ...result, cutoffTable: [{ ...result.cutoffTable[0], mapSeconds: undefined }] },
      eventSecondsFrom
    );
    expect(none.size).toBe(0);
  });
});
