import { describe, expect, it } from 'vitest';
import {
  autoBindCourses,
  detectLegBinding,
  detectPlacemarkLeg,
  instantiateTemplate,
  skipsNamingOwnRace,
  unboundCourses,
  validatePlan,
  type MultisportPlan,
} from '../multisport';
import type { Course } from '../snap';

function course(name: string, totalKm: number): Course {
  return {
    name,
    vertices: [
      { lat: 0, lon: 0, cumulativeKm: 0 },
      { lat: 0, lon: totalKm / 111.32, cumulativeKm: totalKm },
    ],
    totalKm,
  };
}

/* The three routes exactly as a real IRONMAN 70.3 map names them. */
const SUBIC = [
  course('Run Course (IM70.3)', 21.21),
  course('Swim Course (70.3)', 1.9),
  course('Bike Course (IM70.3)', 90.11),
];

describe('detectLegBinding', () => {
  it('reads the sport and the race from a real map name', () => {
    expect(detectLegBinding('Bike Course (IM70.3)')).toMatchObject({ kind: 'bike', raceKey: '70.3' });
    expect(detectLegBinding('Run Course (IM70.3)')).toMatchObject({ kind: 'run', raceKey: '70.3' });
  });

  it('groups legs whose race key is written inconsistently', () => {
    // The same map wrote "(70.3)" on the swim and "(IM70.3)" on the other two.
    const swim = detectLegBinding('Swim Course (70.3)')!;
    const bike = detectLegBinding('Bike Course (IM70.3)')!;
    expect(swim.raceKey).toBe(bike.raceKey);
  });

  it('handles the sport written without the word course', () => {
    expect(detectLegBinding('Bike Course 70.3')).toMatchObject({ kind: 'bike', raceKey: '70.3' });
    expect(detectLegBinding('RUN — 140.6')).toMatchObject({ kind: 'run', raceKey: '140.6' });
  });

  it('reads a duathlon ordinal', () => {
    expect(detectLegBinding('140.6 Run 2')).toMatchObject({ kind: 'run', ordinal: 2, raceKey: '140.6' });
  });

  it('recognises a bike written in another language', () => {
    expect(detectLegBinding('Vélo')).toMatchObject({ kind: 'bike' });
  });

  it('returns null for a route that names no sport', () => {
    expect(detectLegBinding('Aid Route')).toBeNull();
    expect(detectLegBinding('Road closure')).toBeNull();
  });

  it('leaves a compound sport it has no template for unbound', () => {
    // Swimrun is neither a swim nor a run leg, and guessing either would be worse than
    // handing it to the operator to bind.
    expect(detectLegBinding('Swimrun leg')).toBeNull();
  });

  it('picks the first sport when a name mentions two', () => {
    expect(detectLegBinding('Swim to run transition')).toMatchObject({ kind: 'swim' });
  });
});

describe('detectPlacemarkLeg', () => {
  // Every timing point of a real 70.3 map, and what each has to resolve to.
  it.each([
    ['Run 1 - 70.3 only (Uturn)', 'run'],
    ['Run 2 - Sprint Uturn', 'run'],
    ['Run 3 - 70.3 Uturn', 'run'],
    ['Bike 1 - Sprint Uturn', 'bike'],
    ['Bike 2 - 70.3 Uturn Loop', 'bike'],
    ['Bike 3 - 70.3 Uturn', 'bike'],
  ])('reads %s as the %s leg', (name, kind) => {
    expect(detectPlacemarkLeg(name)).toBe(kind);
  });

  it('ignores a sport named part way through, which is describing a place', () => {
    expect(detectPlacemarkLeg('Water station near the bike path')).toBeUndefined();
  });

  it('leaves a point with no sport to the geometry', () => {
    expect(detectPlacemarkLeg('TA 2/4/6 (4.2/11.2/18.3)')).toBeUndefined();
  });
});

describe('autoBindCourses', () => {
  it('binds every leg of a triathlon and takes the measured distance', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1', 'IRONMAN 70.3')] };
    const bound = autoBindCourses(plan, SUBIC).races[0];

    expect(bound.legs[0].courseName).toBe('Swim Course (70.3)');
    expect(bound.legs[2].courseName).toBe('Bike Course (IM70.3)');
    expect(bound.legs[4].courseName).toBe('Run Course (IM70.3)');
    expect(bound.legs[2].distanceKm).toBe(90.11);
    expect(bound.legs[4].distanceKm).toBe(21.21);
  });

  it('never binds a route to a transition', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1')] };
    const bound = autoBindCourses(plan, SUBIC).races[0];
    expect(bound.legs[1].courseName).toBeUndefined();
    expect(bound.legs[3].courseName).toBeUndefined();
  });

  it('leaves a hand-picked route alone', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1')] };
    plan.races[0].legs[4].courseName = 'Bike Course (IM70.3)';
    plan.races[0].legs[4].courseIsManual = true;

    const bound = autoBindCourses(plan, SUBIC).races[0];
    expect(bound.legs[4].courseName).toBe('Bike Course (IM70.3)');
  });

  it('clears a binding whose route is no longer on the map', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1')] };
    plan.races[0].legs[2].courseName = 'Bike Course (2024)';
    plan.races[0].legs[2].courseIsManual = true;

    const bound = autoBindCourses(plan, [course('Only Run', 21)]).races[0];
    expect(bound.legs[2].courseName).toBeUndefined();
  });

  it('binds both laps of a duathlon to the one drawn loop', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('duathlon', 'ms-1', 'City Du')] };
    const bound = autoBindCourses(plan, [course('Run Loop', 5), course('Bike Course', 40)]).races[0];

    expect(bound.legs[0].courseName).toBe('Run Loop');
    expect(bound.legs[4].courseName).toBe('Run Loop');
    expect(bound.legs[2].courseName).toBe('Bike Course');
  });
});

describe('validatePlan', () => {
  function planWith(mutate: (p: MultisportPlan) => void): MultisportPlan {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1', 'Test')] };
    plan.races[0].legs[2].courseName = 'Bike Course (IM70.3)';
    plan.races[0].legs[4].courseName = 'Run Course (IM70.3)';
    mutate(plan);
    return plan;
  }

  it('accepts a fully bound plan', () => {
    expect(validatePlan(planWith(() => {}), SUBIC)).toEqual([]);
  });

  it('catches a routed leg with no route', () => {
    const problems = validatePlan(planWith((p) => (p.races[0].legs[2].courseName = undefined)), SUBIC);
    expect(problems.map((p) => p.message).join(' ')).toContain('choose the route');
  });

  it('catches a route that is not on the map', () => {
    const problems = validatePlan(planWith((p) => (p.races[0].legs[2].courseName = 'Nope')), SUBIC);
    expect(problems.map((p) => p.message).join(' ')).toContain('not on this map');
  });

  it('rejects two different sports sharing one route', () => {
    const problems = validatePlan(
      planWith((p) => (p.races[0].legs[4].courseName = 'Bike Course (IM70.3)')),
      SUBIC
    );
    expect(problems.map((p) => p.message).join(' ')).toContain('already the');
  });

  it('allows a duathlon to run one loop twice', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('duathlon', 'ms-1', 'Du')] };
    plan.races[0].legs[0].courseName = 'Loop';
    plan.races[0].legs[2].courseName = 'Bike';
    plan.races[0].legs[4].courseName = 'Loop';

    expect(validatePlan(plan, [course('Loop', 5), course('Bike', 40)])).toEqual([]);
  });

  it('catches a malformed start time and an empty field', () => {
    const problems = validatePlan(
      planWith((p) => {
        p.races[0].startTimeClock = 'dawn';
        p.races[0].runnerCountText = '';
      }),
      SUBIC
    );
    expect(problems.map((p) => p.message).join(' ')).toContain('start time must be HH:MM');
    expect(problems.map((p) => p.message).join(' ')).toContain('how many athletes');
  });

  it('catches a band whose fastest is slower than its typical', () => {
    const problems = validatePlan(
      planWith((p) => {
        p.races[0].legs[4].band = { mode: 'pace', fastestMinPerKm: 9, typicalMinPerKm: 6, slowestMinPerKm: 10 };
      }),
      SUBIC
    );
    expect(problems.map((p) => p.message).join(' ')).toContain('must be in order');
  });

  it('catches a zero swim distance', () => {
    const problems = validatePlan(planWith((p) => (p.races[0].legs[0].distanceKm = 0)), SUBIC);
    expect(problems.map((p) => p.message).join(' ')).toContain('distance must be above zero');
  });

  it('asks for a race before anything else', () => {
    expect(validatePlan({ races: [] }, SUBIC)).toHaveLength(1);
  });
});

describe('unboundCourses', () => {
  it('names the routes no leg claims', () => {
    const plan: MultisportPlan = { races: [instantiateTemplate('triathlon', 'ms-1')] };
    const bound = autoBindCourses(plan, SUBIC);
    expect(unboundCourses(bound, [...SUBIC, course('Sprint Bike', 20)])).toEqual(['Sprint Bike']);
  });
});

describe('skipsNamingOwnRace', () => {
  function planNamed(name: string): MultisportPlan {
    return { races: [instantiateTemplate('triathlon', 'ms-1', name)] };
  }

  it('says nothing when the skips name other events', () => {
    expect(skipsNamingOwnRace('Kids, Sprint', planNamed('IRONMAN 70.3'))).toEqual([]);
  });

  it('catches a seeded skip that would delete the race being planned', () => {
    // The seed is right on a 70.3 map and disastrous on a sprint one.
    expect(skipsNamingOwnRace('Kids, Sprint', planNamed('Sunrise Sprint'))).toEqual(['sprint']);
  });

  it('ignores blank fragments and stray commas', () => {
    expect(skipsNamingOwnRace(' , Kids ,, ', planNamed('Kids Aquathlon'))).toEqual(['kids']);
  });

  it('has nothing to say about a single-sport race', () => {
    expect(skipsNamingOwnRace('Kids, Sprint', null)).toEqual([]);
  });
});
