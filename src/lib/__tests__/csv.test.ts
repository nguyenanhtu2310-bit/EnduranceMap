import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractRunnerArrivals,
  identifySplitColumns,
  matchSplitsToCheckpoints,
  parseCsv,
  type SplitColumn,
} from '../csv';

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/test/fixtures', name), 'utf-8');
}

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Doe, John","said ""hi"""\n');
    expect(rows).toEqual([{ name: 'Doe, John', note: 'said "hi"' }]);
  });

  it('skips blank trailing lines', () => {
    const rows = parseCsv('a,b\n1,2\n\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('parses the sample results fixture', () => {
    const rows = parseCsv(loadFixture('sample-results.csv'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ bib: '101', startTOD: '06:00:00', Status: 'Finished' });
  });
});

describe('identifySplitColumns', () => {
  it('finds SplitN/SplitN.ToD pairs and ignores unrelated columns', () => {
    const columns = identifySplitColumns(['bib', 'name', 'Split1', 'Split1.ToD', 'Split2', 'Split2.ToD', 'Status']);
    expect(columns).toEqual<SplitColumn[]>([
      { index: 1, splitColumn: 'Split1', todColumn: 'Split1.ToD' },
      { index: 2, splitColumn: 'Split2', todColumn: 'Split2.ToD' },
    ]);
  });

  it('sorts by numeric split index even if headers are out of order', () => {
    const columns = identifySplitColumns(['Split10', 'Split2']);
    expect(columns.map((c) => c.splitColumn)).toEqual(['Split2', 'Split10']);
  });
});

describe('extractRunnerArrivals', () => {
  const splitColumns: SplitColumn[] = [{ index: 1, splitColumn: 'Split1', todColumn: 'Split1.ToD' }];

  it('returns the parsed arrival in seconds since midnight', () => {
    const [seconds] = extractRunnerArrivals({ startTOD: '06:00:00', 'Split1.ToD': '06:15:00' }, splitColumns);
    expect(seconds).toBe(6 * 3600 + 15 * 60);
  });

  it('unwraps a midnight rollover relative to the start time', () => {
    const [seconds] = extractRunnerArrivals({ startTOD: '23:50:00', 'Split1.ToD': '00:05:00' }, splitColumns);
    expect(seconds).toBe(24 * 3600 + 5 * 60);
  });

  it('returns null for a missing/unparseable ToD value', () => {
    const [seconds] = extractRunnerArrivals({ startTOD: '06:00:00', 'Split1.ToD': '' }, splitColumns);
    expect(seconds).toBeNull();
  });
});

describe('matchSplitsToCheckpoints', () => {
  const rows = parseCsv(loadFixture('sample-results.csv'));
  const splitColumns = identifySplitColumns(Object.keys(rows[0]));

  it('confirms plausible splits against checkpoints in course order', () => {
    const results = matchSplitsToCheckpoints(rows, splitColumns, [
      { name: 'CP_A', kmFromStart: 3 },
      { name: 'CP_B', kmFromStart: 7 },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].plausible).toBe(true);
    expect(results[0].medianPaceMinPerKm).toBeCloseTo(6.5, 5);
    expect(results[1].plausible).toBe(true);
    expect(results[1].medianPaceMinPerKm).toBeCloseTo(6.5, 5);
  });

  it('flags an implausible pace when a checkpoint is assigned the wrong km', () => {
    const results = matchSplitsToCheckpoints(rows, splitColumns, [
      { name: 'CP_A', kmFromStart: 3 },
      { name: 'Way Too Far', kmFromStart: 70 }, // same elapsed time, absurd distance
    ]);

    expect(results[1].plausible).toBe(false);
    expect(results[1].warning).toMatch(/plausible range/);
  });

  it('flags a non-advancing checkpoint (km not increasing) as unable to validate', () => {
    const results = matchSplitsToCheckpoints(rows, splitColumns, [
      { name: 'CP_A', kmFromStart: 3 },
      { name: 'CP_B_same_km', kmFromStart: 3 },
    ]);

    expect(results[1].plausible).toBe(false);
    expect(results[1].medianPaceMinPerKm).toBeNull();
  });
});

describe('however the columns are separated', () => {
  it('reads a semicolon-separated export', () => {
    // A spreadsheet saved where the comma is the decimal point writes semicolons.
    const rows = parseCsv('"Contest";"ChipTime";"Run Pace"\n"FULL MARATHON";"2:39:16";"3:44"');
    expect(Object.keys(rows[0])).toEqual(['Contest', 'ChipTime', 'Run Pace']);
    expect(rows[0]['Contest']).toBe('FULL MARATHON');
  });

  it.each([
    [',', 'comma'],
    [';', 'semicolon'],
    ['\t', 'tab'],
    ['|', 'pipe'],
  ])('reads %s-separated (%s)', (d) => {
    const rows = parseCsv(`Contest${d}ChipTime\n10K${d}0:42:00`);
    expect(rows[0]).toEqual({ Contest: '10K', ChipTime: '0:42:00' });
  });

  it('does not let a separator inside a field name win the vote', () => {
    // One comma in a quoted heading against three real semicolons.
    const rows = parseCsv('"Contest";"Time, net";"Pace";"Status"\n"5K";"0:25:00";"5:00";""');
    expect(Object.keys(rows[0])).toEqual(['Contest', 'Time, net', 'Pace', 'Status']);
  });

  it('still reads a comma file whose fields contain semicolons', () => {
    const rows = parseCsv('Contest,Note\n10K,"first; second"');
    expect(rows[0]['Note']).toBe('first; second');
  });
});
