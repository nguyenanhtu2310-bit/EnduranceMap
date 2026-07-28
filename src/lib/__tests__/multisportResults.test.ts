import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectRaceFromName,
  detectResultsFormat,
  parseMultisportResultsCsv,
  summarizeMultisportProfile,
} from '../multisportResults';

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/test/fixtures', name), 'utf-8');
}

const csv = loadFixture('multisport-results.csv');
const parsed = parseMultisportResultsCsv(csv);

describe('detectResultsFormat', () => {
  it('recognises a multisport export by its transition columns', () => {
    expect(detectResultsFormat(csv)).toBe('multisport');
  });

  it('leaves a single-sport export to the existing parser', () => {
    expect(detectResultsFormat(loadFixture('sample-results.csv'))).toBe('single');
  });

  it('still reads a multisport export that names its contests', () => {
    // Requiring the absence of a contest column sent a triathlon file to the running-race
    // parser, which then tried to work out a pace per kilometre for "Sprint".
    expect(detectResultsFormat('Contest,Start_TD,T1_TD\nSprint,05:00:00,05:01:00\n')).toBe('multisport');
  });
});

describe('parseMultisportResultsCsv', () => {
  it('splits the file into two races by how deep their splits run', () => {
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles.map((p) => p.label)).toEqual(['Full distance', 'Half distance']);
    expect(parsed.profiles.map((p) => p.usable)).toEqual([6, 6]);
  });

  it('reads the leg sequence from the columns present', () => {
    expect(parsed.profiles[0].legs.map((l) => l.kind)).toEqual([
      'swim',
      'transition',
      'bike',
      'transition',
      'run',
    ]);
  });

  it('infers each race distance from the deepest split it reaches', () => {
    const [full, half] = parsed.profiles;
    expect(full.legs[2].distanceKm).toBeCloseTo(180.2, 1);
    expect(full.legs[4].distanceKm).toBeCloseTo(42.2, 1);
    expect(half.legs[2].distanceKm).toBeCloseTo(90.1, 1);
    expect(half.legs[4].distanceKm).toBeCloseTo(21.1, 1);
  });

  it('measures offsets against the first start of that race, not the file', () => {
    // The two races start an hour apart; each field is relative to its own gun.
    for (const profile of parsed.profiles) {
      const offsets = profile.athletes.map((a) => a.raceOffsetSeconds).sort((a, b) => a - b);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(150); // six starters, thirty seconds apart
    }
  });

  it('reads leg durations back exactly', () => {
    const full = parsed.profiles[0];
    const first = full.athletes.find((a) => a.raceOffsetSeconds === 0)!;
    expect(first.legSeconds).toEqual([3600, 300, 21600, 240, 15120]);
  });

  it('drops an athlete who never reached a boundary, and says so', () => {
    // The abandon on the bike is a starter but not a usable sample.
    expect(parsed.profiles.reduce((n, p) => n + p.usable, 0)).toBe(12);
    expect(parsed.warnings.join(' ')).toContain('are missing a leg time');
  });

  it('drops a row whose times run backwards rather than rescuing it as a rollover', () => {
    // Unwrapping a mistyped time of day would turn it into a sixteen-hour bike leg.
    const bikeSeconds = parsed.profiles.flatMap((p) =>
      p.athletes.map((a) => a.legSeconds[2])
    );
    expect(Math.max(...bikeSeconds)).toBeLessThan(8 * 3600);
  });

  it('reports an attrition ladder counting everyone who started', () => {
    // Counting only finishers would make the ladder flat and say nothing. The point is
    // where the race lost people, so the abandon and the corrupt row are starters too.
    const half = parsed.profiles[1];
    expect(half.attrition[0]).toEqual({ label: 'Started', reached: 8 });
    expect(half.attrition[half.attrition.length - 1]).toEqual({ label: 'Run done', reached: 7 });
    expect(half.rows).toBe(8);
    expect(half.usable).toBe(6);

    // Never climbs: nobody finishes a leg they did not start.
    const reached = half.attrition.map((a) => a.reached);
    expect(reached).toEqual([...reached].sort((a, b) => b - a));
  });

  it('does not read a half-distance field as a full one when it trips deep run mats', () => {
    // Run mats are named for the longest race in the file, so half-distance athletes
    // record splits labelled past their own run leg — 31 km of a 21 km run. Treating
    // those as a lower bound on the run distance rules out the race they belong to, and
    // the field comes out as a full distance riding at 60 km/h.
    const half = parsed.profiles[1];
    expect(half.label).toBe('Half distance');
    expect(half.legs[2].distanceKm).toBeCloseTo(90.1, 1);

    const medianBike = [...half.athletes.map((a) => a.legSeconds[2])].sort((a, b) => a - b)[3];
    const impliedKmh = half.legs[2].distanceKm / (medianBike / 3600);
    expect(impliedKmh).toBeGreaterThan(20);
    expect(impliedKmh).toBeLessThan(45);
  });

  it('carries a race over midnight instead of wrapping it back', () => {
    // Pushed nine hours later, this athlete finishes at 02:51 the next morning, so every
    // boundary after midnight reads as earlier than the one before it.
    const [header, first] = csv.split('\n');
    const shifted = first.replace(/(\d{2}):(\d{2}):(\d{2})/g, (_, h, m, s) => {
      const at = (Number(h) + 9) % 24;
      return `${String(at).padStart(2, '0')}:${m}:${s}`;
    });

    const late = parseMultisportResultsCsv(`${header}\n${shifted}\n`);
    expect(late.profiles[0].athletes[0].legSeconds).toEqual([3600, 300, 21600, 240, 15120]);
  });
});

describe('the parser cannot carry participant data', () => {
  it('keeps every identifying field out of the profiles', () => {
    // The real export carries Email, Birthdate, names, Club and Comment, and profiles are
    // written into saved race files and exported reports. This is what stops a future
    // row spread putting a participant list somewhere it gets shared.
    const serialized = JSON.stringify(parsed.profiles);
    for (const fragment of ['Test', 'Email', 'Birthdate', 'Club', 'Comment', 'M40-44']) {
      expect(serialized).not.toContain(fragment);
    }
  });

  it('gives an athlete nowhere to put anything but times', () => {
    expect(Object.keys(parsed.profiles[0].athletes[0]).sort()).toEqual([
      'legSeconds',
      'raceOffsetSeconds',
    ]);
  });
});

describe('summarizeMultisportProfile', () => {
  it('reports a spread per leg', () => {
    const summary = summarizeMultisportProfile(parsed.profiles[0]);
    expect(summary).toHaveLength(5);
    const bike = summary[2];
    expect(bike.p1Seconds).toBeLessThanOrEqual(bike.p50Seconds);
    expect(bike.p50Seconds).toBeLessThanOrEqual(bike.p99Seconds);
  });
});

describe('unusable files', () => {
  it('explains a file with no leg columns', () => {
    const result = parseMultisportResultsCsv('Place,Bib\n1,7\n');
    expect(result.profiles).toEqual([]);
    expect(result.warnings.join(' ')).toContain('Could not find the leg columns');
  });
});

describe('a name states the distances', () => {
  const half = (() => {
    // Just the half-distance rows, so the file holds a single race.
    const lines = csv.split('\n').filter(Boolean);
    return [lines[0], ...lines.slice(7, 13)].join('\n') + '\n';
  })();

  it('takes the distances from a file name that agrees with the times', () => {
    const { profiles } = parseMultisportResultsCsv(half, { fileName: 'IM70.3 Danang.csv' });
    expect(profiles[0].label).toBe('Half distance');
    expect(profiles[0].warnings.join(' ')).toContain('from the name');
  });

  it('falls back to the times when the name says nothing', () => {
    const { profiles } = parseMultisportResultsCsv(half, { fileName: 'IMDN26 export.csv' });
    expect(profiles[0].label).toBe('Half distance');
    expect(profiles[0].warnings.join(' ')).toContain('from the times');
  });

  it('will not let one name describe a file holding two races', () => {
    // IMDN26 carries a full and a half; naming it "IM70.3" must not shrink both.
    const { profiles } = parseMultisportResultsCsv(csv, { fileName: 'IM70.3.csv' });
    expect(profiles.map((p) => p.label)).toEqual(['Full distance', 'Half distance']);
  });
});

describe('a contest column names the races', () => {
  /** The same rows, with a Contest column naming each race outright. */
  const withContest = (() => {
    const lines = csv.split('\n').filter(Boolean);
    const header = 'Contest,' + lines[0];
    const body = lines.slice(1).map((line, i) => `"${i < 6 ? 'IM140.6' : 'IM70.3'}",${line}`);
    return [header, ...body].join('\n') + '\n';
  })();

  it('is still recognised as multisport', () => {
    expect(detectResultsFormat(withContest)).toBe('multisport');
  });

  it('groups by contest rather than by which mats athletes tripped', () => {
    const { profiles } = parseMultisportResultsCsv(withContest);
    expect(profiles.map((p) => p.label).sort()).toEqual(['IM140.6', 'IM70.3']);
  });

  it('takes each race distance from its contest name', () => {
    const { profiles } = parseMultisportResultsCsv(withContest);
    const half = profiles.find((p) => p.label === 'IM70.3')!;
    const full = profiles.find((p) => p.label === 'IM140.6')!;

    expect(half.legs.map((l) => l.distanceKm)).toEqual([1.9, 0, 90.1, 0, 21.1]);
    expect(full.legs.map((l) => l.distanceKm)).toEqual([3.8, 0, 180.2, 0, 42.2]);
    expect(half.warnings.join(' ')).toContain('from the name');
  });

  it('keys the profile by contest so a mapping survives a re-parse', () => {
    const { profiles } = parseMultisportResultsCsv(withContest);
    expect(profiles.map((p) => p.key).sort()).toEqual(['IM140.6', 'IM70.3']);
  });
});

describe('detectRaceFromName', () => {
  it.each([
    ['Sprint', 'Sprint'],
    ['Sunrise Sprint', 'Sprint'],
    ['Olympic', 'Olympic'],
    ['5150 Dapitan', 'Olympic'],
    ['IM70.3', 'Half distance'],
    ['70.3', 'Half distance'],
    ['IM140.6', 'Full distance'],
    ['Full Distance Triathlon', 'Full distance'],
  ])('reads %s as %s', (name, label) => {
    expect(detectRaceFromName(name)?.label).toBe(label);
  });

  it.each(['Relay', 'Aquabike', 'IMDN26', ''])('leaves %s unnamed', (name) => {
    expect(detectRaceFromName(name)).toBeUndefined();
  });

  it('settles nothing when a name mentions two distances', () => {
    expect(detectRaceFromName('IM70.3 and 140.6 combined.csv')).toBeUndefined();
  });
});

describe('files that state each leg duration outright', () => {
  // Most exports carry Swim/T1/Bike/T2/Run as durations and no times of day at all.
  // Requiring Start_TD sent every one of them to the single-sport parser.
  const elapsed = loadFixture('multisport-elapsed.csv');

  it('is recognised by its transition column alone', () => {
    expect(detectResultsFormat(elapsed)).toBe('multisport');
  });

  it('reads the legs without needing a time of day anywhere', () => {
    const { profiles } = parseMultisportResultsCsv(elapsed, { fileName: 'Sprint.csv' });
    const sprint = profiles.find((p) => p.label === 'Sprint')!;

    expect(sprint.legs.map((l) => l.kind)).toEqual(['swim', 'transition', 'bike', 'transition', 'run']);
    expect(sprint.legs.map((l) => l.distanceKm)).toEqual([0.75, 0, 20, 0, 5]);
    expect(sprint.athletes[0].legSeconds).toEqual([720, 120, 2160, 60, 1500]);
  });

  it('separates the relay from the individual race', () => {
    const { profiles } = parseMultisportResultsCsv(elapsed);
    expect(profiles.map((p) => p.label).sort()).toEqual(['Sprint', 'Sprint Relay']);
  });

  it('models everyone off the gun when no start time is recorded', () => {
    const { profiles } = parseMultisportResultsCsv(elapsed);
    const sprint = profiles.find((p) => p.label === 'Sprint')!;
    expect(sprint.athletes.every((a) => a.raceOffsetSeconds === 0)).toBe(true);
  });

  it('counts a did-not-start as never having started', () => {
    const { profiles } = parseMultisportResultsCsv(elapsed);
    const sprint = profiles.find((p) => p.label === 'Sprint')!;
    // Six finishers and one abandon on the bike; the DNS row left no time at all.
    expect(sprint.usable).toBe(6);
    expect(sprint.rows).toBe(7);
  });

  it('keeps participant data out of this shape too', () => {
    const serialized = JSON.stringify(parseMultisportResultsCsv(elapsed).profiles);
    for (const fragment of ['Test', 'Birthdate', 'Club', 'M30-34', 'Alpha']) {
      expect(serialized).not.toContain(fragment);
    }
  });
});

describe('when a name and the times disagree', () => {
  const elapsed = loadFixture('multisport-elapsed.csv');

  it('disbelieves the name and says so', () => {
    // A file called "5150 Dapitan Sprint" held Olympic racing. Believing the name put
    // the field on a 20 km bike at 16.6 km/h and a 5 km run at 10.8 min/km. Here the
    // contest claims a full distance over times that took barely an hour and a quarter.
    const mislabelled = elapsed.replace(/"Sprint"/g, '"IM140.6"');
    const { profiles } = parseMultisportResultsCsv(mislabelled);
    const race = profiles.find((p) => p.key === 'IM140.6')!;

    expect(race.legs.map((l) => l.distanceKm)).toEqual([0.75, 0, 20, 0, 5]);
    expect(race.warnings.join(' ')).toContain('but the times fit');
  });

  it('lets the contest name outrank the file name', () => {
    // The row says what race it is; the file name is only a guess about the whole file.
    const { profiles } = parseMultisportResultsCsv(elapsed, { fileName: 'IM140.6 Danang.csv' });
    expect(profiles.find((p) => p.key === 'Sprint')!.legs[2].distanceKm).toBe(20);
  });

  it('still believes a name that only makes the field look slow', () => {
    const { profiles } = parseMultisportResultsCsv(elapsed, { fileName: 'Sprint.csv' });
    const sprint = profiles.find((p) => p.key === 'Sprint')!;
    expect(sprint.legs[2].distanceKm).toBe(20);
    expect(sprint.warnings.join(' ')).toContain('from the name');
  });
});

describe('a race named Full is not always an Ironman', () => {
  it.each(['Half Aqua Warriors', 'Full Marathon Relay', 'Full Send Challenge'])(
    'leaves %s to be measured rather than assumed',
    (name) => {
      // "Full" on its own is a word an organizer uses freely; only a qualified name
      // means the Ironman distance.
      expect(detectRaceFromName(name)).toBeUndefined();
    }
  );

  it.each([
    ['Full distance', 'Full distance'],
    ['Full Ironman', 'Full distance'],
    ['IM140.6', 'Full distance'],
    ['Half distance', 'Half distance'],
    ['IM70.3', 'Half distance'],
  ])('still reads %s as %s', (name, label) => {
    expect(detectRaceFromName(name)?.label).toBe(label);
  });
});

describe('the Aqua Warriors series', () => {
  // A recurring client whose names mean distances of its own choosing.
  it.each([
    ['Ultra Aqua Warriors', 5, 21],
    ['Full Aqua Warriors', 3, 15],
    ['Olympic Aqua Warriors', 1.5, 10],
    ['Sprint Aqua Warriors', 0.75, 5],
    ['Junior Aqua Warriors', 0.3, 2],
    ['Kids Aqua Warriors', 0.15, 1],
  ])('reads %s as %s km swim and %s km run', (name, swimKm, runKm) => {
    const race = detectRaceFromName(name)!;
    expect(race.swimKm).toBe(swimKm);
    expect(race.runKm).toBe(runKm);
  });

  it('does not let the series steal a name it has no claim on', () => {
    expect(detectRaceFromName('Sprint')?.label).toBe('Sprint');
    expect(detectRaceFromName('IM140.6')?.label).toBe('Full distance');
  });
});
