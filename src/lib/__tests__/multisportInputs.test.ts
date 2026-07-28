import { describe, expect, it } from 'vitest';
import {
  autoMapMultisport,
  buildCourseRestriction,
  buildLegDistanceInputs,
  legCourseName,
  synthesizeAthletesFromBands,
  type MultisportProfile,
} from '../multisportInputs';
import {
  detectPlacemarkLeg,
  instantiateTemplate,
  type MultisportPlan,
  type MultisportRace,
} from '../multisport';
import { arrivalPercentilesFromPaceBand, projectSampleArrivals } from '../paceModel';
import { parseClockTimeToSeconds } from '../time';
import type { Course } from '../snap';

/** A straight course of the requested length, so `totalKm` is exactly what a test asks for. */
function course(name: string, totalKm: number): Course {
  return {
    name,
    // The vertices are never walked here; only `totalKm` is read.
    vertices: [
      { lat: 0, lon: 0, cumulativeKm: 0 },
      { lat: 0, lon: totalKm / 111.32, cumulativeKm: totalKm },
    ],
    totalKm,
  };
}

function triathlon(overrides: Partial<MultisportRace> = {}): MultisportRace {
  const race = instantiateTemplate('triathlon', 'ms-1', 'Test 70.3');
  race.startTimeClock = '06:00';
  race.startSpreadMinutes = 0;
  race.runnerCountText = '4';
  race.legs[0].distanceKm = 1.9;
  race.legs[2].courseName = 'Bike';
  race.legs[2].distanceKm = 90;
  race.legs[4].courseName = 'Run';
  race.legs[4].distanceKm = 21;
  return { ...race, ...overrides };
}

const COURSES = [course('Bike', 90), course('Run', 21)];

/**
 * A reference field of one athlete with the leg times the plan's crux test names, so the
 * folded offset can be asserted to the second.
 */
function oneAthleteProfile(): MultisportProfile {
  return {
    key: 'full',
    distanceSource: 'measured' as const,
    label: 'Reference',
    legs: [
      { kind: 'swim', label: 'Swim', distanceKm: 1.9 },
      { kind: 'transition', label: 'T1', distanceKm: 0 },
      { kind: 'bike', label: 'Bike', distanceKm: 90 },
      { kind: 'transition', label: 'T2', distanceKm: 0 },
      { kind: 'run', label: 'Run', distanceKm: 21 },
    ],
    athletes: [{ raceOffsetSeconds: 0, legSeconds: [3600, 300, 18000, 240, 7560] }],
    rows: 1,
    usable: 1,
    attrition: [],
    warnings: [],
  };
}

describe('buildLegDistanceInputs', () => {
  it('folds every preceding leg into the run leg start offset', () => {
    const plan: MultisportPlan = { races: [triathlon()] };
    const { inputs } = buildLegDistanceInputs(plan, {
      courses: COURSES,
      profileByRaceId: new Map([['ms-1', oneAthleteProfile()]]),
    });

    const run = inputs.find((i) => i.legIndex === 4)!;
    // swim 3600 + T1 300 + bike 18000 + T2 240
    expect(run.samples![0].startOffsetSeconds).toBe(22140);
  });

  it('places a run-leg arrival at the gun plus the fold plus the leg pace', () => {
    const plan: MultisportPlan = { races: [triathlon()] };
    const { inputs } = buildLegDistanceInputs(plan, {
      courses: COURSES,
      profileByRaceId: new Map([['ms-1', oneAthleteProfile()]]),
    });

    const run = inputs.find((i) => i.legIndex === 4)!;
    const gun = parseClockTimeToSeconds('06:00')!;
    const pace = run.samples![0].paceMinPerKm;
    const arrivals = projectSampleArrivals(run.samples!, run, 10);

    expect(pace).toBeCloseTo(7560 / 60 / 21, 10);
    for (const arrival of arrivals) {
      expect(arrival).toBeCloseTo(gun + 22140 + pace * 10 * 60, 6);
    }
  });

  it('gives the bike leg only what came before it', () => {
    const plan: MultisportPlan = { races: [triathlon()] };
    const { inputs } = buildLegDistanceInputs(plan, {
      courses: COURSES,
      profileByRaceId: new Map([['ms-1', oneAthleteProfile()]]),
    });

    const bike = inputs.find((i) => i.legIndex === 2)!;
    expect(bike.samples![0].startOffsetSeconds).toBe(3900); // swim + T1
    expect(bike.samples![0].paceMinPerKm).toBeCloseTo(18000 / 60 / 90, 10);
  });

  it('reproduces the pace-band model exactly when nothing precedes the leg', () => {
    // A single routed leg starting at the gun is an ordinary one-course race, and must
    // come out of the samples path identical to what the band path would have produced.
    const race = instantiateTemplate('triathlon', 'ms-1', 'Solo');
    race.startTimeClock = '05:00';
    race.startSpreadMinutes = 12;
    race.runnerCountText = '8';
    race.legs = [race.legs[4]];
    race.legs[0].courseName = 'Run';
    race.legs[0].distanceKm = 21;

    const { inputs } = buildLegDistanceInputs({ races: [race] }, {
      courses: COURSES,
      bandSampleSize: 8,
    });
    const run = inputs[0];

    const quantiles = Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * 100);
    const expected = arrivalPercentilesFromPaceBand(run, run, 7.5, quantiles).map((p) => p.seconds);

    expect(projectSampleArrivals(run.samples!, run, 7.5)).toEqual(expected);
  });

  it('rescales a reference leg onto a shorter course', () => {
    // Half the bike, so the bike's contribution to the run offset halves while the
    // transitions either side of it stay exactly as they were.
    const plan: MultisportPlan = { races: [triathlon()] };
    const { inputs } = buildLegDistanceInputs(plan, {
      courses: [course('Bike', 45), course('Run', 21)],
      profileByRaceId: new Map([['ms-1', oneAthleteProfile()]]),
    });

    const run = inputs.find((i) => i.legIndex === 4)!;
    expect(run.samples![0].startOffsetSeconds).toBe(3600 + 300 + 9000 + 240);
  });

  it('puts the finish cut-off on the last routed leg only', () => {
    const race = triathlon({ organizerCutoffClock: '14:30' });
    const { inputs } = buildLegDistanceInputs({ races: [race] }, { courses: COURSES });

    expect(inputs.find((i) => i.legIndex === 2)!.organizerCutoffClock).toBeUndefined();
    expect(inputs.find((i) => i.legIndex === 4)!.organizerCutoffClock).toBe('14:30');
  });

  it('names legs rather than reusing the drawn route, so two laps stay separate', () => {
    const race = instantiateTemplate('duathlon', 'ms-1', 'City Du');
    race.legs[0].courseName = 'Loop';
    race.legs[2].courseName = 'Bike';
    race.legs[4].courseName = 'Loop';

    const { inputs } = buildLegDistanceInputs({ races: [race] }, {
      courses: [course('Loop', 5), course('Bike', 40)],
    });

    expect(inputs.map((i) => i.courseName)).toEqual([
      'City Du — Run 1',
      'City Du — Bike',
      'City Du — Run 2',
    ]);
    // Both run legs follow the same drawn line but schedule independently.
    expect(inputs[0].sourceCourseName).toBe('Loop');
    expect(inputs[2].sourceCourseName).toBe('Loop');
    expect(inputs[2].samples![0].startOffsetSeconds).toBeGreaterThan(
      inputs[0].samples![0].startOffsetSeconds
    );
  });

  it('produces one input per routed leg for an aquathlon', () => {
    const race = instantiateTemplate('aquathlon', 'ms-1', 'Aqua');
    race.legs[2].courseName = 'Run';
    const { inputs } = buildLegDistanceInputs({ races: [race] }, { courses: COURSES });

    expect(inputs).toHaveLength(1);
    expect(inputs[0].legIndex).toBe(2);
  });

  it('falls back to the pace band when a reference field has different legs', () => {
    const wrong: MultisportProfile = {
      ...oneAthleteProfile(),
      legs: oneAthleteProfile().legs.slice(0, 3),
    };
    const { inputs, warnings } = buildLegDistanceInputs({ races: [triathlon()] }, {
      courses: COURSES,
      profileByRaceId: new Map([['ms-1', wrong]]),
      bandSampleSize: 4,
    });

    expect(warnings.join(' ')).toContain('does not match the legs');
    expect(inputs.find((i) => i.legIndex === 4)!.samples).toHaveLength(4);
  });

  it('skips a leg whose route is missing from the map', () => {
    const race = triathlon();
    race.legs[2].courseName = 'Gone';
    const { inputs, warnings } = buildLegDistanceInputs({ races: [race] }, { courses: COURSES });

    expect(inputs.map((i) => i.legIndex)).toEqual([4]);
    expect(warnings.join(' ')).toContain('"Gone" is not on this map');
  });
});

describe('synthesizeAthletesFromBands', () => {
  it('spreads the field across the corral by percentile', () => {
    const race = triathlon({ startSpreadMinutes: 10 });
    const athletes = synthesizeAthletesFromBands(race, new Map(COURSES.map((c) => [c.name, c])), 4);

    expect(athletes).toHaveLength(4);
    expect(athletes[0].raceOffsetSeconds).toBeLessThan(athletes[3].raceOffsetSeconds);
    expect(athletes[3].raceOffsetSeconds).toBeLessThanOrEqual(600);
  });

  it('times a routed leg over the drawn route, not the typed distance', () => {
    const race = triathlon();
    race.legs[4].distanceKm = 1; // deliberately disagrees with the 21 km route
    const athletes = synthesizeAthletesFromBands(race, new Map(COURSES.map((c) => [c.name, c])), 3);

    const typical = race.legs[4].band.mode === 'pace' ? race.legs[4].band.typicalMinPerKm : 0;
    // Middle athlete runs 21 km at roughly the typical pace.
    expect(athletes[1].legSeconds[4]).toBeCloseTo(typical * 21 * 60, -1);
  });
});

describe('buildCourseRestriction', () => {
  const plan: MultisportPlan = { races: [triathlon()] };
  const restrict = buildCourseRestriction(plan, detectPlacemarkLeg);

  it('confines a run point to the run leg even when it sits on the bike line', () => {
    expect(restrict('Run 3 - 70.3 Uturn')).toEqual([legCourseName(plan.races[0], plan.races[0].legs[4])]);
  });

  it('confines a bike point to the bike leg', () => {
    expect(restrict('Bike 2 - 70.3 Uturn Loop')).toEqual([
      legCourseName(plan.races[0], plan.races[0].legs[2]),
    ]);
  });

  it('leaves a point that names no sport to the geometry', () => {
    expect(restrict('Water station')).toBeUndefined();
  });

  it('drops a point naming a sport this race does not schedule', () => {
    expect(restrict('Swim exit')).toEqual([]);
  });
});

describe('autoMapMultisport', () => {
  function profile(key: string, swim: number, bike: number, run: number): MultisportProfile {
    return {
      key,
      distanceSource: 'measured',
      label: key,
      legs: [
        { kind: 'swim', label: 'Swim', distanceKm: swim },
        { kind: 'transition', label: 'T1', distanceKm: 0 },
        { kind: 'bike', label: 'Bike', distanceKm: bike },
        { kind: 'transition', label: 'T2', distanceKm: 0 },
        { kind: 'run', label: 'Run', distanceKm: run },
      ],
      athletes: [{ raceOffsetSeconds: 0, legSeconds: [1, 1, 1, 1, 1] }],
      rows: 1,
      usable: 1,
      attrition: [],
      warnings: [],
    };
  }

  const full = profile('depth-155', 3.8, 180.2, 42.2);
  const half = profile('depth-65', 1.9, 90.1, 21.1);

  it('gives a lone half-distance plan the half-distance field', () => {
    // Ranking by size instead of matching on it would hand this the full-distance field
    // and double every leg time — the plan is 113 km, the two fields 226 and 113.
    const plan: MultisportPlan = { races: [triathlon()] };
    expect(autoMapMultisport([full, half], plan)).toEqual({ 'depth-65': 'ms-1' });
  });

  it('pairs both races when the plan holds both', () => {
    const long = { ...triathlon(), id: 'ms-2', name: 'Full' };
    long.legs = long.legs.map((l) =>
      l.kind === 'bike'
        ? { ...l, distanceKm: 180 }
        : l.kind === 'run'
          ? { ...l, distanceKm: 42 }
          : l.kind === 'swim'
            ? { ...l, distanceKm: 3.8 }
            : l
    );

    const mapping = autoMapMultisport([full, half], { races: [triathlon(), long] });
    expect(mapping).toEqual({ 'depth-65': 'ms-1', 'depth-155': 'ms-2' });
  });

  it('leaves a race unmapped when nothing in the file is close', () => {
    const sprint = { ...triathlon(), id: 'ms-9' };
    sprint.legs = sprint.legs.map((l) => ({ ...l, distanceKm: l.distanceKm / 10 }));
    expect(autoMapMultisport([full], { races: [sprint] })).toEqual({});
  });

  it('maps nothing without a plan', () => {
    expect(autoMapMultisport([full, half], null)).toEqual({});
  });
});

describe('a transition the timing system never recorded', () => {
  /** A reference field of swim and run only, as an aquathlon export often arrives. */
  function swimRunProfile(): MultisportProfile {
    return {
      key: 'aqua',
      distanceSource: 'measured',
      label: 'Sprint Aqua Warriors',
      legs: [
        { kind: 'swim', label: 'Swim', distanceKm: 0.75 },
        { kind: 'run', label: 'Run', distanceKm: 5 },
      ],
      athletes: [{ raceOffsetSeconds: 0, legSeconds: [900, 1500] }],
      rows: 1,
      usable: 1,
      attrition: [],
      warnings: [],
    };
  }

  function aquathlon() {
    const race = instantiateTemplate('aquathlon', 'ms-1', 'Sprint Aqua');
    race.startTimeClock = '06:00';
    race.startSpreadMinutes = 0;
    // Planned at the same distances the reference field raced, so nothing is rescaled
    // and the offsets can be asserted to the second.
    race.legs[0].distanceKm = 0.75;
    race.legs[2].courseName = 'Run';
    race.legs[2].distanceKm = 5;
    return race;
  }

  const courses = [course('Run', 5)];

  it('still uses the real field rather than falling back to a typed band', () => {
    const { inputs, warnings } = buildLegDistanceInputs({ races: [aquathlon()] }, {
      courses,
      profileByRaceId: new Map([['ms-1', swimRunProfile()]]),
    });

    expect(warnings).toEqual([]);
    // The swim alone, with the untimed transition costing nothing.
    expect(inputs[0].samples![0].startOffsetSeconds).toBe(900);
    expect(inputs[0].samples![0].paceMinPerKm).toBeCloseTo(1500 / 60 / 5, 10);
  });

  it('adds the transition back when the file does record one', () => {
    const withT1: MultisportProfile = {
      ...swimRunProfile(),
      legs: [
        { kind: 'swim', label: 'Swim', distanceKm: 0.75 },
        { kind: 'transition', label: 'T1', distanceKm: 0 },
        { kind: 'run', label: 'Run', distanceKm: 5 },
      ],
      athletes: [{ raceOffsetSeconds: 0, legSeconds: [900, 120, 1500] }],
    };

    const { inputs } = buildLegDistanceInputs({ races: [aquathlon()] }, {
      courses,
      profileByRaceId: new Map([['ms-1', withT1]]),
    });
    expect(inputs[0].samples![0].startOffsetSeconds).toBe(1020);
  });

  it('still refuses a field that is missing a leg anyone actually races', () => {
    // A swim-only file cannot describe a race with a run, and guessing would be worse.
    const swimOnly: MultisportProfile = {
      ...swimRunProfile(),
      legs: [{ kind: 'swim', label: 'Swim', distanceKm: 0.75 }],
      athletes: [{ raceOffsetSeconds: 0, legSeconds: [900] }],
    };

    const { warnings } = buildLegDistanceInputs({ races: [aquathlon()] }, {
      courses,
      profileByRaceId: new Map([['ms-1', swimOnly]]),
      bandSampleSize: 4,
    });
    expect(warnings.join(' ')).toContain('does not match the legs');
  });
});

describe('a swim planned at a different distance from the reference', () => {
  it('scales the swim, and with it everything that follows', () => {
    // The reference swam 0.75 km; this race swims 1 km, so the swim takes a third longer
    // and the run starts that much later.
    const profile: MultisportProfile = {
      key: 'aqua',
      distanceSource: 'measured',
      label: 'Sprint Aqua Warriors',
      legs: [
        { kind: 'swim', label: 'Swim', distanceKm: 0.75 },
        { kind: 'run', label: 'Run', distanceKm: 5 },
      ],
      athletes: [{ raceOffsetSeconds: 0, legSeconds: [900, 1500] }],
      rows: 1,
      usable: 1,
      attrition: [],
      warnings: [],
    };

    const race = instantiateTemplate('aquathlon', 'ms-1', 'Longer swim');
    race.startTimeClock = '06:00';
    race.startSpreadMinutes = 0;
    race.legs[0].distanceKm = 1;
    race.legs[2].courseName = 'Run';
    race.legs[2].distanceKm = 5;

    const { inputs } = buildLegDistanceInputs({ races: [race] }, {
      courses: [course('Run', 5)],
      profileByRaceId: new Map([['ms-1', profile]]),
    });
    expect(inputs[0].samples![0].startOffsetSeconds).toBe(1200);
  });
});
