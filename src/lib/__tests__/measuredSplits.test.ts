import { describe, expect, it } from 'vitest';
import {
  matCoverage,
  readAttrition,
  splitsUsedBy,
  parseSplitSeconds,
  readMeasuredSplits,
  splitColumnsOf,
} from '../measuredSplits';

const H = (h: number, m = 0, s = 0) => (h * 60 + m) * 60 + s;

describe('parseSplitSeconds', () => {
  it('reads an ordinary duration', () => {
    expect(parseSplitSeconds('00:55:57')).toBe(H(0, 55, 57));
  });

  it('reads an elapsed time past a day, which a 49-hour race writes on every finisher', () => {
    expect(parseSplitSeconds('41:34:15')).toBe(H(41, 34, 15));
  });

  it('reads the day prefix a timing export writes across midnight', () => {
    // "1:03:00:04" is day one at three in the morning.
    expect(parseSplitSeconds('1:03:00:04')).toBe(H(27, 0, 4));
  });

  it('reads a sub-hour split as minutes and seconds', () => {
    // This used to be refused, on the reasoning that a two-part time was too ambiguous to
    // act on. A real trail export settled it: every leg under the hour is written this
    // way, and refusing them emptied eleven checkpoint columns at once. Hours and minutes
    // would put a runner two days late at their first mat, so it is not the reading.
    expect(parseSplitSeconds('12:34')).toBe(12 * 60 + 34);
    expect(parseSplitSeconds('42:50')).toBe(42 * 60 + 50);
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseSplitSeconds('')).toBeNull();
    expect(parseSplitSeconds('nope:nope:nope')).toBeNull();
    expect(parseSplitSeconds('12')).toBeNull();
    expect(parseSplitSeconds('1:2:3:4:5')).toBeNull();
  });
});

describe('splitColumnsOf', () => {
  it('takes every column that is not one with a fixed meaning', () => {
    expect(
      splitColumnsOf(['Contest', 'Start TOD', 'CP_M1', 'CP_TEL', 'Chip Time', 'Status'])
    ).toEqual(['CP_M1', 'CP_TEL']);
  });
});

const rows = (over: Partial<Record<string, string>>[] = []) =>
  over.map((o) => ({ Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '', CP2: '', ...o }));

describe('readMeasuredSplits', () => {
  it('places an elapsed split on the event clock by adding the runner’s own gun', () => {
    const out = readMeasuredSplits(rows([{ CP1: '01:00:00' }, { CP1: '02:00:00' }]));
    expect(out.contests[0].reading).toBe('elapsed');
    expect(out.contests[0].arrivalsBySplit.get('CP1')).toEqual([H(6), H(7)]);
  });

  it('carries a per-runner start rather than one for the field', () => {
    // Chip time: everyone's clock starts when they crossed, not when the gun went.
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '01:00:00' },
      { Contest: '100km', 'Start TOD': '05:10:00', Status: '', CP1: '01:00:00' },
    ]);
    expect(out.contests[0].arrivalsBySplit.get('CP1')).toEqual([H(6), H(6, 10)]);
  });

  it('reads times of day as they stand', () => {
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '06:30:00' },
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '07:00:00' },
    ]);
    expect(out.contests[0].reading).toBe('time-of-day');
    expect(out.contests[0].arrivalsBySplit.get('CP1')).toEqual([H(6, 30), H(7)]);
  });

  it('calls a split past 24 hours elapsed whatever else it looks like', () => {
    // No time of day is 41:34:15.
    const out = readMeasuredSplits([
      { Contest: '100 miles', 'Start TOD': '08:00:00', Status: '', CP1: '41:34:15' },
    ]);
    expect(out.contests[0].reading).toBe('elapsed');
  });

  it('keeps a runner who retired, because the crews before that point served them', () => {
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '05:00:00', Status: 'DNF', CP1: '01:00:00', CP2: '' },
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '01:10:00', CP2: '03:00:00' },
    ]);
    expect(out.contests[0].arrivalsBySplit.get('CP1')).toHaveLength(2);
    expect(out.contests[0].arrivalsBySplit.get('CP2')).toHaveLength(1);
  });

  it('drops a runner who never started', () => {
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '', Status: 'DNS', CP1: '' },
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '01:00:00' },
    ]);
    expect(out.contests[0].starters).toBe(1);
  });

  it('keeps each contest apart', () => {
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP1: '01:00:00' },
      { Contest: '70km', 'Start TOD': '03:00:00', Status: '', CP1: '01:00:00' },
    ]);
    expect(out.contests.map((c) => c.contest).sort()).toEqual(['100km', '70km']);
    expect(out.contests.find((c) => c.contest === '70km')!.arrivalsBySplit.get('CP1')).toEqual([H(4)]);
  });

  it('returns arrivals in the order they happened', () => {
    const out = readMeasuredSplits(rows([{ CP1: '03:00:00' }, { CP1: '01:00:00' }]));
    const arrivals = out.contests[0].arrivalsBySplit.get('CP1')!;
    expect(arrivals).toEqual([...arrivals].sort((a, b) => a - b));
  });

  it('says so when a file carries no splits at all', () => {
    const out = readMeasuredSplits([{ Contest: '10km', 'Start TOD': '09:00:00', Status: '' }]);
    expect(out.warnings[0]).toMatch(/no split columns/i);
  });

  it('says so when a contest has no start times to place its splits against', () => {
    const out = readMeasuredSplits([
      { Contest: '100km', 'Start TOD': '', Status: '', CP1: '01:00:00' },
    ]);
    expect(out.warnings[0]).toContain('100km');
  });
});

describe('splitsUsedBy', () => {
  it('keeps only the mats a contest actually crossed', () => {
    // One export carries every mat the event owns; a contest passes a subset.
    const rows = [
      { Contest: '100km', 'Start TOD': '05:00:00', Status: '', CP_M1: '', CP_M2: '01:00:00' },
    ];
    expect(splitsUsedBy(rows, ['CP_M1', 'CP_M2'])).toEqual(['CP_M2']);
  });
});

describe('matCoverage', () => {
  const runner = (splits: Record<string, string>) => ({
    Contest: '100km',
    'Start TOD': '05:00:00',
    Status: '',
    CP1: '',
    CP2: '',
    CP3: '',
    ...splits,
  });

  it('reports a working mat as complete', () => {
    const out = matCoverage(
      [runner({ CP1: '01:00:00', CP2: '02:00:00' }), runner({ CP1: '01:10:00', CP2: '02:10:00' })],
      ['CP1', 'CP2']
    );
    expect(out.map((c) => c.rate)).toEqual([1, 1]);
  });

  it('does not read attrition as a hardware fault', () => {
    // Two runners reach CP1; one retires. CP1 read everyone who passed it.
    const out = matCoverage(
      [runner({ CP1: '01:00:00', CP2: '02:00:00' }), runner({ CP1: '01:10:00' })],
      ['CP1', 'CP2']
    );
    expect(out[0].rate).toBe(1);
    expect(out[0].read).toBe(2);
    expect(out[1].read).toBe(1);
  });

  it('counts a runner seen further on as having passed the mat that missed them', () => {
    // The real signal: CP2 recorded nobody, but both were read at CP3.
    const out = matCoverage(
      [
        runner({ CP1: '01:00:00', CP3: '03:00:00' }),
        runner({ CP1: '01:10:00', CP3: '03:10:00' }),
      ],
      ['CP1', 'CP2', 'CP3']
    );
    expect(out[1]).toMatchObject({ split: 'CP2', read: 0, passed: 2, rate: 0 });
  });

  it('finds a mat that read half of what went by', () => {
    const out = matCoverage(
      [
        runner({ CP1: '01:00:00', CP2: '02:00:00', CP3: '03:00:00' }),
        runner({ CP1: '01:10:00', CP3: '03:10:00' }),
      ],
      ['CP1', 'CP2', 'CP3']
    );
    expect(out[1].rate).toBe(0.5);
  });

  it('has nothing to say about a mat nobody is known to have passed', () => {
    expect(matCoverage([runner({})], ['CP1'])[0].rate).toBeNull();
  });

  it('leaves out anyone who never started', () => {
    const out = matCoverage(
      [
        { Contest: '100km', 'Start TOD': '', Status: 'DNS', CP1: '' },
        runner({ CP1: '01:00:00' }),
      ],
      ['CP1']
    );
    expect(out[0].passed).toBe(1);
  });
});

describe('a split cell that carries its pace too', () => {
  it('reads the time and ignores the pace beside it', () => {
    // A real trail export writes "42:50 / 5:29" in every checkpoint column. Read whole,
    // this parsed to nothing, and all eleven checkpoints came back empty — which looks
    // exactly like a race where every mat failed.
    expect(parseSplitSeconds('42:50 / 5:29')).toBe(42 * 60 + 50);
    expect(parseSplitSeconds('1:23:10 / 5:28')).toBe(3600 + 23 * 60 + 10);
    expect(parseSplitSeconds('4:53:03 / 5:31')).toBe(4 * 3600 + 53 * 60 + 3);
  });

  it('still reads a plain time, and still refuses nonsense', () => {
    expect(parseSplitSeconds('10:08:20')).toBe(10 * 3600 + 8 * 60 + 20);
    expect(parseSplitSeconds('1:02:00:00')).toBe(26 * 3600);
    expect(parseSplitSeconds(' / 5:29')).toBeNull();
    expect(parseSplitSeconds('nonsense / 5:29')).toBeNull();
  });
});

describe('who retired, and where they were last seen', () => {
  const CPS = ['CP1', 'CP2', 'CP3'];
  const runner = (
    contest: string,
    status: string,
    start: string,
    finish: string,
    splits: Record<string, string>
  ) => ({ Contest: contest, Status: status, Start: start, ChipTime: finish, CP1: '', CP2: '', CP3: '', ...splits });

  const rows = [
    runner('50KM', '', '05:00:00', '6:10:00', { CP1: '1:02:00 / 6:12', CP2: '2:40:00 / 6:20', CP3: '4:30:00 / 6:31' }),
    runner('50KM', '', '05:00:01', '6:40:00', { CP1: '1:10:00 / 7:00', CP2: '2:55:00 / 7:02', CP3: '4:50:00 / 7:04' }),
    runner('50KM', 'DNF', '05:00:02', '', { CP1: '1:20:00 / 8:00', CP2: '3:10:00 / 8:05' }),
    runner('50KM', 'DNF', '05:00:03', '', { CP1: '1:22:00 / 8:12', CP2: '3:14:00 / 8:14' }),
    runner('50KM', 'DNF', '05:00:04', '', { CP1: '1:25:00 / 8:30' }),
    // Retired holding a finishing time: stopped at a cut-off rather than withdrawn.
    runner('50KM', 'DNF', '05:00:05', '9:59:00', { CP1: '1:30:00 / 9:00', CP2: '3:30:00 / 9:02', CP3: '7:00:00 / 9:30' }),
    // Never read at the start; the checkpoints still place them.
    runner('50KM', 'DNF', '', '', { CP1: '1:40:00 / 10:00' }),
    runner('50KM', 'DNS', '', '', {}),
  ];

  it('takes the count the file states rather than working it out', () => {
    const [reading] = readAttrition(rows, CPS);
    expect(reading.basis).toBe('stated');
    expect(reading.retired).toBe(5);
    expect(reading.finishers).toBe(2);
    // The runner who never started is in neither count.
    expect(reading.starters).toBe(7);
  });

  it('says where each group was last read, in course order', () => {
    const [reading] = readAttrition(rows, CPS);
    expect(reading.byLastSeen).toEqual([
      { lastSeen: 'CP1', count: 2 },
      { lastSeen: 'CP2', count: 2 },
      { lastSeen: 'CP3', count: 1 },
    ]);
  });

  it('flags the two things that make the count read wrong', () => {
    const [reading] = readAttrition(rows, CPS);
    expect(reading.caveats.join(' ')).toContain('1 of these hold a finishing time');
    expect(reading.caveats.join(' ')).toContain('1 were never read at the start');
  });

  it('falls back to working it out when the file states no status', () => {
    // Same runners, statuses stripped: start read and no finish time.
    const silent = rows
      .filter((r) => r.Status !== 'DNS')
      .map((r) => ({ ...r, Status: '' }));
    const [reading] = readAttrition(silent, CPS);
    expect(reading.basis).toBe('inferred');
    // Four of the five: the cut-off runner holds a finish time and the one the start mat
    // never read has no start. Both are invisible this way, which the caveat says.
    expect(reading.retired).toBe(3);
    expect(reading.caveats.join(' ')).toContain('93%');
  });

  it('keeps each contest apart', () => {
    const mixed = [...rows, runner('21KM', 'DNF', '08:00:00', '', { CP1: '30:00 / 6:00' })];
    const readings = readAttrition(mixed, CPS);
    expect(readings.map((r) => r.contest)).toEqual(['50KM', '21KM']);
    expect(readings[1].retired).toBe(1);
    expect(readings[1].byLastSeen).toEqual([{ lastSeen: 'CP1', count: 1 }]);
  });
});

describe('telling a mat from everything else in the file', () => {
  // The header of a real trail export, verbatim.
  const HEADER = [
    'Contest','Nation','Firstname','Bib','Gender','Overall Rank','Gender Rank','AG',
    'Age Group Rank','Start','CP1','CP2','CP3','CP4','CP5','TrailBox','CP6','CP7','CP8',
    'CP9','CP10','GunTime (official)','ChipTime','Average Pace','Status','Email','Comment',
  ];

  it('keeps the eleven mats and nothing else', () => {
    expect(splitColumnsOf(HEADER)).toEqual([
      'CP1','CP2','CP3','CP4','CP5','TrailBox','CP6','CP7','CP8','CP9','CP10',
    ]);
  });

  it('does not mistake a pace column for a checkpoint', () => {
    // "Average Pace" holds "6:07", which is a perfectly good six-minute split, and it sits
    // after the last checkpoint — so every retirement was reported as last seen there.
    expect(splitColumnsOf(HEADER)).not.toContain('Average Pace');
    expect(parseSplitSeconds('6:07')).toBe(367);
  });

  it('keeps names and addresses out of the timing data', () => {
    for (const column of ['Firstname', 'Email', 'Comment', 'Nation', 'Bib']) {
      expect(splitColumnsOf(HEADER)).not.toContain(column);
    }
  });

  it('reads a finish column however it is labelled', () => {
    expect(splitColumnsOf(HEADER)).not.toContain('ChipTime');
    expect(splitColumnsOf(HEADER)).not.toContain('GunTime (official)');
    expect(splitColumnsOf(['Chip Time', 'CP1'])).toEqual(['CP1']);
  });
});
