import { describe, expect, it } from 'vitest';
import { decodeResults, decodeSplits, encodeResults, encodeSplits } from '../raceFile';
import type { MeasuredSplits } from '../measuredSplits';

const splits: MeasuredSplits = {
  warnings: ['one warning'],
  contests: [
    {
      contest: '100km',
      arrivalsBySplit: new Map([
        ['CP1', [3600, 3700]],
        ['CP2', [7200]],
      ]),
      starters: 2,
      reading: 'elapsed',
    },
  ],
};

/** What actually happens to a value on its way to a file and back. */
const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('writing a race to a file', () => {
  it('survives the trip through JSON with its splits intact', () => {
    // The whole point. A Map goes into JSON.stringify and `{}` comes out — no error, no
    // warning, just the data gone.
    const restored = decodeSplits(throughJson(encodeSplits(splits)));
    expect(restored.contests[0].arrivalsBySplit.get('CP1')).toEqual([3600, 3700]);
    expect(restored.contests[0].arrivalsBySplit.get('CP2')).toEqual([7200]);
    expect(restored.contests[0].starters).toBe(2);
    expect(restored.warnings).toEqual(['one warning']);
  });

  it('shows what goes wrong without it', () => {
    // Left as a Map, the field is silently emptied — this is the bug, pinned down so it
    // cannot come back unnoticed.
    const naive = throughJson(splits);
    expect(naive.contests[0].arrivalsBySplit).toEqual({});
    expect(() => [...(naive.contests[0].arrivalsBySplit as unknown as Iterable<unknown>)]).toThrow();
  });

  it('gives back a real Map, not something that merely looks like one', () => {
    const restored = decodeSplits(throughJson(encodeSplits(splits)));
    expect(restored.contests[0].arrivalsBySplit).toBeInstanceOf(Map);
    // Iterating is what crashed the app; it has to work.
    expect([...restored.contests[0].arrivalsBySplit].length).toBe(2);
  });

  it('opens a file written before any of this, instead of refusing it', () => {
    // Older saves hold `{}` where the entries should be. Their other twenty fields are
    // perfectly good, and an empty Map plus a race that opens beats a crash.
    const old = { contests: [{ ...splits.contests[0], arrivalsBySplit: {} }], warnings: [] };
    const restored = decodeSplits(old as never);
    expect(restored.contests[0].arrivalsBySplit.size).toBe(0);
    expect(restored.contests[0].contest).toBe('100km');
  });

  it('tolerates a file whose splits are missing or malformed', () => {
    expect(decodeSplits({ contests: undefined, warnings: undefined } as never).contests).toEqual([]);
    expect(decodeSplits({} as never).warnings).toEqual([]);
  });
});

describe('the results around them', () => {
  const results = { kind: 'single', fileName: 'r.csv', profiles: [], splits };

  it('round-trips the whole results object', () => {
    const restored = decodeResults(throughJson(encodeResults(results) as never)) as typeof results;
    expect(restored.fileName).toBe('r.csv');
    expect(restored.splits.contests[0].arrivalsBySplit.get('CP1')).toEqual([3600, 3700]);
  });

  it('leaves results with no splits exactly as they are', () => {
    const bare = { kind: 'single', fileName: 'r.csv', profiles: [] };
    expect(encodeResults(bare as never)).toEqual(bare);
    expect(decodeResults(bare as never)).toEqual(bare);
  });

  it('passes null through both ways', () => {
    expect(encodeResults(null)).toBeNull();
    expect(decodeResults(null)).toBeNull();
  });
});
