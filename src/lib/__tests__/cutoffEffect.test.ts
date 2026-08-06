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
