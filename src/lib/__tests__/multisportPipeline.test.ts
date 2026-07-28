import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKml } from '../kml';
import { buildCourses } from '../snap';
import { runPipeline } from '../pipeline';
import { autoBindCourses, detectPlacemarkLeg, instantiateTemplate, type MultisportPlan } from '../multisport';
import { buildCourseRestriction, buildLegDistanceInputs } from '../multisportInputs';

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/test/fixtures', name), 'utf-8');
}

function coursesOf(kml: string) {
  return buildCourses(parseKml(kml).courses);
}

/** Everything App does between "operator pressed calculate" and `runPipeline`. */
function schedule(
  kml: string,
  plan: MultisportPlan,
  options: { excludeNames?: string[]; skip?: string[] } = {}
) {
  const courses = coursesOf(kml);
  const bound = autoBindCourses(plan, courses);
  const { inputs } = buildLegDistanceInputs(bound, { courses, bandSampleSize: 20 });

  return {
    bound,
    result: runPipeline(kml, inputs, {
      stationFolders: ['TIMING'],
      excludePlacemarkNames: options.excludeNames ?? [],
      excludePlacemarkContaining: options.skip ?? [],
      restrictCoursesFor: buildCourseRestriction(bound, detectPlacemarkLeg),
    }),
  };
}

describe('triathlon through the pipeline', () => {
  const kml = loadFixture('triathlon.kml');
  const plan = (): MultisportPlan => ({ races: [instantiateTemplate('triathlon', 'ms-1', 'Test 70.3')] });

  it('binds all three drawn routes, swim included', () => {
    const { bound } = schedule(kml, plan());
    const legs = bound.races[0].legs;

    expect(legs[0].courseName).toBe('Swim Course (70.3)');
    expect(legs[2].courseName).toBe('Bike Course (IM70.3)');
    expect(legs[4].courseName).toBe('Run Course (IM70.3)');
  });

  it('keeps a run point on the run leg even though it sits on the bike line', () => {
    // "Run 1" is drawn on the stretch the bike and the run share, so proximity alone
    // would put it on both. The name is the only thing that can settle it.
    const { result } = schedule(kml, plan());
    const run1 = result.stations.find((s) => s.mapName === 'Run 1 - 70.3 Uturn')!;

    expect(run1).toBeDefined();
    expect(new Set(run1.crossings.map((c) => c.courseName))).toEqual(new Set(['Test 70.3 — Run']));
  });

  it('finds one pass per lap of a three-lap run', () => {
    const { result } = schedule(kml, plan());
    const run1 = result.stations.find((s) => s.mapName === 'Run 1 - 70.3 Uturn')!;
    expect(run1.crossings).toHaveLength(3);
  });

  it('leaves a point that names no sport to the geometry', () => {
    const { result } = schedule(kml, plan());
    const water = result.stations.find((s) => s.mapName === 'Water point')!;
    expect(water.crossings.map((c) => c.courseName)).toEqual(['Test 70.3 — Bike']);
  });

  it('orders every bike position ahead of every run position', () => {
    // The bike is the longer leg, so ranking by distance alone would file a late run
    // point above a late bike point. The kids point is dropped here because it names no
    // leading sport, so it sits on both legs and has no single place in the order.
    const { result } = schedule(kml, plan(), { excludeNames: ['Kids_ Run 1 - Uturn (6 - 8yo)'] });
    const legOf = (name: string) => (name.endsWith('Bike') ? 0 : 1);
    const order = result.stations.map((s) => legOf(s.crossings[0].courseName));

    expect(order).toEqual([0, 0, 1]);
  });

  it('puts an unhinted point on every leg that runs past it', () => {
    // The kids point sits where the bike and run share tarmac and names no leading
    // sport, so the geometry is all there is and it lands on both. Found by its source
    // name because the display name has the "Kids_" prefix cleaned off it.
    const { result } = schedule(kml, plan());
    const kids = result.stations.find((s) => s.sourceNames.some((n) => n.startsWith('Kids_')))!;

    expect(new Set(kids.crossings.map((c) => c.courseName))).toEqual(
      new Set(['Test 70.3 — Bike', 'Test 70.3 — Run'])
    );
    // One pass on the bike, then one per lap of the run.
    expect(kids.crossings).toHaveLength(4);
  });

  it('drops the kids point when it is excluded by name', () => {
    const { result } = schedule(kml, plan(), { excludeNames: ['Kids_ Run 1 - Uturn (6 - 8yo)'] });
    expect(result.stations.map((s) => s.mapName)).not.toContain('Kids_ Run 1 - Uturn (6 - 8yo)');
    expect(result.stations).toHaveLength(3);
  });

  it('opens the run leg long after the bike leg', () => {
    const { result } = schedule(kml, plan(), { excludeNames: ['Kids_ Run 1 - Uturn (6 - 8yo)'] });
    const bike = result.stations.find((s) => s.mapName === 'Bike 1 - 70.3 Uturn')!;
    const run = result.stations.find((s) => s.mapName === 'Run 1 - 70.3 Uturn')!;

    // A run position cannot open before the fastest athlete has swum, ridden and racked.
    expect(run.schedule.openClockTime > bike.schedule.openClockTime).toBe(true);
  });
});

describe('duathlon running one drawn loop twice', () => {
  const kml = loadFixture('duathlon-shared-loop.kml');

  function duathlonPlan(): MultisportPlan {
    return { races: [instantiateTemplate('duathlon', 'ms-1', 'City Du')] };
  }

  it('binds both run legs to the single drawn loop', () => {
    const { bound } = schedule(kml, duathlonPlan());
    expect(bound.races[0].legs[0].courseName).toBe('Run Loop');
    expect(bound.races[0].legs[4].courseName).toBe('Run Loop');
  });

  it('gives each lap its own crossings rather than letting one overwrite the other', () => {
    const { result } = schedule(kml, duathlonPlan());
    const run = result.stations.find((s) => s.mapName === 'Run 1 - Uturn')!;
    const courses = run.crossings.map((c) => c.courseName);

    expect(courses).toContain('City Du — Run 1');
    expect(courses).toContain('City Du — Run 2');
  });

  it('reaches the second lap later than the first', () => {
    const { result } = schedule(kml, duathlonPlan());
    const run = result.stations.find((s) => s.mapName === 'Run 1 - Uturn')!;
    const first = run.crossings.find((c) => c.courseName === 'City Du — Run 1')!;
    const second = run.crossings.find((c) => c.courseName === 'City Du — Run 2')!;

    // Same spot on the ground, so the same kilometre — what differs is when.
    expect(second.kmFromStart).toBeCloseTo(first.kmFromStart, 6);
  });
});

describe('a station takes its leg from any placemark standing at it', () => {
  const kml = loadFixture('triathlon.kml');
  const plan = (): MultisportPlan => ({ races: [instantiateTemplate('triathlon', 'ms-1', 'Test 70.3')] });

  it('does not let an unticked neighbour drag the bike leg onto a run station', () => {
    // "TA 2/4/6" sits ten metres from "Run 1" and names no sport, so alone it lands on
    // the bike route too. Merged into the run station it would bring those passes with
    // it — and a window running from the first rider to the last runner.
    const { result } = schedule(kml, plan(), { skip: ['Kids'] });
    const run1 = result.stations.find((s) => s.sourceNames.includes('Run 1 - 70.3 Uturn'))!;

    expect(new Set(run1.crossings.map((c) => c.courseName))).toEqual(new Set(['Test 70.3 — Run']));
    // Still merged — the cut-off it might carry is not lost, only its leg is settled.
    expect(run1.coLocatedNames.join(' ')).toContain('TA');
  });

  it('leaves points out by name fragment, across folders', () => {
    // One map carries several events whose points share folders with this race.
    const { result } = schedule(kml, plan(), { skip: ['Kids'] });
    expect(result.stations.flatMap((s) => s.sourceNames).join(' ')).not.toContain('Kids');
  });

  it('keeps the kids point when nothing is skipped', () => {
    const { result } = schedule(kml, plan());
    expect(result.stations.flatMap((s) => s.sourceNames).join(' ')).toContain('Kids');
  });
});

describe('legs read in the order they are raced', () => {
  it('keeps a duathlon short second run after the bike it follows', () => {
    // Sorting by length would put both 5 km runs ahead of the 40 km bike, which is the
    // opposite of the order an athlete meets them.
    const { result } = schedule(loadFixture('duathlon-shared-loop.kml'), {
      races: [instantiateTemplate('duathlon', 'ms-1', 'City Du')],
    });

    expect(result.legOrdered).toBe(true);
    expect(result.courseOrder).toEqual(['City Du — Run 1', 'City Du — Bike', 'City Du — Run 2']);
  });

  it('leaves an ordinary race to be read longest first', () => {
    // A single-sport race has no legs, so nothing should claim its distances are a
    // sequence — they are alternatives, and the views still sort them by length.
    const kml = loadFixture('sample.kml');
    const result = runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 100,
        fastestMinPerKm: 3.5,
        typicalMinPerKm: 6.5,
        slowestMinPerKm: 10,
      },
    ]);

    expect(result.legOrdered).toBe(false);
  });
});
