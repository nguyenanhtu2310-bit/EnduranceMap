import { describe, expect, it } from 'vitest';
import {
  inferContestDistanceKm,
  normalizeSex,
  parseElapsedToSeconds,
  parseResultsCsv,
  summarizeProfile,
} from '../results';
import { arrivalPercentilesFromSamples, projectSampleArrivals } from '../paceModel';

/** Mirrors a real finish-line export: BOM, contest column, chip/gun times, statuses. */
const CSV =
  '﻿"Contest","Name","Bib","Gender","startTOD","GunTime","ChipTime","finishTOD","Status"\n' +
  '"Full Marathon","A","1","M","03:00:00","3:00:00","3:00:00","06:00:00",""\n' +
  '"Full Marathon","B","2","F","03:01:00","4:00:00","3:59:00","07:01:00",""\n' +
  '"Full Marathon","C","3","M","03:02:00","5:02:00","5:00:00","08:04:00",""\n' +
  '"Full Marathon","D","4","M","03:00:00","","","","DNF"\n' +
  '"Full Marathon","E","5","F","","","","","DNS"\n' +
  '"10K","F","6","M","05:00:00","0:50:00","0:50:00","05:50:00",""\n' +
  '"10K","G","7","F","05:00:30","1:10:00","1:09:30","06:10:00",""\n';

describe('parseElapsedToSeconds', () => {
  it('parses H:MM:SS and MM:SS', () => {
    expect(parseElapsedToSeconds('2:25:44')).toBe(2 * 3600 + 25 * 60 + 44);
    expect(parseElapsedToSeconds('50:00')).toBe(50 * 60);
  });

  it('accepts durations past 24 hours, which a clock time may not', () => {
    expect(parseElapsedToSeconds('30:15:00')).toBe(30 * 3600 + 15 * 60);
  });

  // A timing system that writes hundredths used to have its whole field discarded:
  // every chip time failed to parse, so the contest reported nought finishers.
  it('drops the hundredths some timing systems write, as the official time does', () => {
    expect(parseElapsedToSeconds('2:31:30.52')).toBe(2 * 3600 + 31 * 60 + 30);
    expect(parseElapsedToSeconds('2:31:30.71')).toBe(2 * 3600 + 31 * 60 + 30);
    expect(parseElapsedToSeconds('50:00.00')).toBe(50 * 60);
  });

  it('reads a decimal comma, as a European export writes it', () => {
    expect(parseElapsedToSeconds('2:31:30,52')).toBe(2 * 3600 + 31 * 60 + 30);
  });

  it('rejects nonsense', () => {
    expect(parseElapsedToSeconds('')).toBeNull();
    expect(parseElapsedToSeconds('abc')).toBeNull();
    expect(parseElapsedToSeconds('1:75:00')).toBeNull();
    expect(parseElapsedToSeconds('1:00:60.5')).toBeNull();
    expect(parseElapsedToSeconds('2:31:30.')).toBeNull();
  });
});

describe('inferContestDistanceKm', () => {
  it('reads the standard road distances', () => {
    expect(inferContestDistanceKm('Full Marathon')).toBeCloseTo(42.195, 3);
    expect(inferContestDistanceKm('Half Marathon')).toBeCloseTo(21.0975, 4);
    expect(inferContestDistanceKm('10K')).toBe(10);
    expect(inferContestDistanceKm('5km')).toBe(5);
  });

  it('returns undefined rather than guessing at an unknown name', () => {
    expect(inferContestDistanceKm('Kids Dash')).toBeUndefined();
  });
});

describe('parseResultsCsv', () => {
  const { profiles, warnings } = parseResultsCsv(CSV);

  it('strips the byte-order mark so the first column still matches', () => {
    expect(warnings).toEqual([]);
    expect(profiles.map((p) => p.contest)).toEqual(['Full Marathon', '10K']);
  });

  it('excludes DNS and DNF from the finisher counts', () => {
    const marathon = profiles.find((p) => p.contest === 'Full Marathon')!;
    expect(marathon.entrants).toBe(5);
    expect(marathon.finishers).toBe(3);
    expect(marathon.samples).toHaveLength(3);
  });

  it('derives pace from chip time over the contest distance', () => {
    const marathon = profiles.find((p) => p.contest === 'Full Marathon')!;
    // 3:00:00 over 42.195 km = 4.266 min/km.
    expect(marathon.samples[0].paceMinPerKm).toBeCloseTo(180 / 42.195, 3);
  });

  it('measures each start offset from the first starter in that contest', () => {
    const marathon = profiles.find((p) => p.contest === 'Full Marathon')!;
    expect(marathon.samples.map((s) => s.startOffsetSeconds)).toEqual([0, 60, 120]);
  });

  it('keeps contests separate, each with its own first start', () => {
    const tenK = profiles.find((p) => p.contest === '10K')!;
    expect(tenK.samples.map((s) => s.startOffsetSeconds)).toEqual([0, 30]);
  });

  it('falls back to finish minus start when no elapsed column parses', () => {
    const noElapsed = CSV.replace(/"3:00:00","3:00:00"/, '"",""');
    const marathon = parseResultsCsv(noElapsed).profiles.find((p) => p.contest === 'Full Marathon')!;
    expect(marathon.samples[0].paceMinPerKm).toBeCloseTo(180 / 42.195, 3);
  });

  it('reports a missing contest column instead of parsing nothing silently', () => {
    const result = parseResultsCsv('"Name","Time"\n"A","1:00:00"\n');
    expect(result.profiles).toEqual([]);
    expect(result.warnings[0]).toMatch(/contest column/i);
  });

  it('flags a contest whose distance cannot be inferred', () => {
    const odd = CSV.replace(/"10K"/g, '"Fun Run"');
    const funRun = parseResultsCsv(odd).profiles.find((p) => p.contest === 'Fun Run')!;
    expect(funRun.distanceKm).toBe(0);
    expect(funRun.warnings[0]).toMatch(/distance/i);
  });

  it('accepts a manual distance override for an unnamed contest', () => {
    const odd = CSV.replace(/"10K"/g, '"Fun Run"');
    const funRun = parseResultsCsv(odd, { distanceOverrides: { 'Fun Run': 10 } }).profiles.find(
      (p) => p.contest === 'Fun Run'
    )!;
    expect(funRun.distanceKm).toBe(10);
    expect(funRun.samples).toHaveLength(2);
  });
});

describe('summarizeProfile', () => {
  it('reports the pace spread and the observed start spread', () => {
    const marathon = parseResultsCsv(CSV).profiles.find((p) => p.contest === 'Full Marathon')!;
    const summary = summarizeProfile(marathon)!;
    expect(summary.pace.p1).toBeLessThan(summary.pace.p50);
    expect(summary.pace.p50).toBeLessThan(summary.pace.p99);
    expect(summary.startSpreadSeconds.max).toBe(120);
  });
});

describe('projecting a real field onto a new race', () => {
  const marathon = parseResultsCsv(CSV).profiles.find((p) => p.contest === 'Full Marathon')!;

  it('replays each runner at the new gun time, keeping their own offset and pace', () => {
    const arrivals = projectSampleArrivals(marathon.samples, {
      startTimeClock: '06:00',
      runnerCount: 3,
    }, 42.195);

    // Runner A: 06:00 gun, no corral delay, 3:00:00 of running.
    expect(arrivals[0]).toBe(9 * 3600);
    // Runner B: started 60s back, ran 3:59:00.
    expect(arrivals[1]).toBe(6 * 3600 + 60 + 239 * 60);
  });

  it('scales a reference field up to a larger planned entry list', () => {
    const arrivals = projectSampleArrivals(marathon.samples, {
      startTimeClock: '06:00',
      runnerCount: 300,
    }, 42.195);
    expect(arrivals).toHaveLength(300);
    expect(Math.min(...arrivals)).toBe(9 * 3600);
  });

  it('produces percentiles ordered from fastest to slowest', () => {
    const results = arrivalPercentilesFromSamples(
      marathon.samples,
      { startTimeClock: '06:00', runnerCount: 300 },
      42.195
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i].seconds).toBeGreaterThanOrEqual(results[i - 1].seconds);
    }
  });

  it('returns nothing when the field is empty', () => {
    expect(projectSampleArrivals([], { startTimeClock: '06:00', runnerCount: 100 }, 10)).toEqual([]);
    expect(projectSampleArrivals(marathon.samples, { startTimeClock: '06:00', runnerCount: 0 }, 10)).toEqual([]);
  });
});

describe('normalizeSex', () => {
  it('reads the plain codes an operator would type', () => {
    expect(normalizeSex('m')).toBe('M');
    expect(normalizeSex('F')).toBe('F');
    expect(normalizeSex(' Male ')).toBe('M');
    expect(normalizeSex('Female')).toBe('F');
    expect(normalizeSex('W')).toBe('F');
  });

  it('takes the sex off a division code, which is all some exports carry', () => {
    expect(normalizeSex('F30-34')).toBe('F');
    expect(normalizeSex('M35-39')).toBe('M');
  });

  it('refuses to guess from anything else', () => {
    expect(normalizeSex('')).toBeNull();
    expect(normalizeSex('Mixed')).toBeNull();
    expect(normalizeSex('Relay')).toBeNull();
    expect(normalizeSex('40-44')).toBeNull();
  });
});

describe('lead athletes', () => {
  const { profiles } = parseResultsCsv(CSV);
  const marathon = profiles.find((p) => p.contest === 'Full Marathon')!;

  it('names one leader per sex, the fastest of each', () => {
    expect(marathon.leaders.map((l) => l.sex)).toEqual(['M', 'F']);
    expect(marathon.leaders.map((l) => l.finishSeconds)).toEqual([3 * 3600, 3 * 3600 + 59 * 60]);
  });

  it('keeps the leader’s own offset and pace, so the marker moves as they did', () => {
    const [man, woman] = marathon.leaders;
    expect(man.startOffsetSeconds).toBe(0);
    expect(woman.startOffsetSeconds).toBe(60);
    expect(man.paceMinPerKm).toBeCloseTo(180 / 42.195, 3);
  });

  it('never carries a name or a bib out of the file', () => {
    expect(Object.keys(marathon.leaders[0]).sort()).toEqual([
      'finishSeconds',
      'paceMinPerKm',
      'sex',
      'startOffsetSeconds',
    ]);
  });

  it('ignores a runner the status column excluded', () => {
    // "E" is a DNS woman with no time; the lead woman must still be B.
    expect(marathon.leaders.find((l) => l.sex === 'F')!.finishSeconds).toBe(3 * 3600 + 59 * 60);
  });

  it('leaves the markers off when the export never says who is which', () => {
    const noGender = CSV.replace(/,"Gender"/, ',"Nation"');
    const p = parseResultsCsv(noGender).profiles.find((x) => x.contest === 'Full Marathon')!;
    expect(p.leaders).toEqual([]);
    // The field itself is unaffected — only the markers are missing.
    expect(p.samples.length).toBe(3);
  });

  it('passes over a leader timed faster than any human, and says so', () => {
    const bogus = CSV.replace('"Full Marathon","A","1","M","03:00:00","3:00:00","3:00:00"',
      '"Full Marathon","A","1","M","03:00:00","1:00:00","1:00:00"');
    const p = parseResultsCsv(bogus).profiles.find((x) => x.contest === 'Full Marathon')!;
    // A 1:00:00 marathon is 1.42 min/km — the next man, at 5:00:00, leads instead.
    expect(p.leaders.find((l) => l.sex === 'M')!.finishSeconds).toBe(5 * 3600);
    expect(p.warnings.join(' ')).toMatch(/faster than any human/i);
  });
});
