import { describe, expect, it } from 'vitest';
import { coursesWithoutProfile, matchProfiles } from '../profileMatch';

/** Stands in for a real profile — matching never looks inside one. */
const p = (id: string) => ({ id });

describe('pairing a course with its profile', () => {
  it('matches on the name where the two agree', () => {
    const out = matchProfiles(['100km', '50km'], new Map([['100km', p('a')], ['50km', p('b')]]));
    expect(out.get('100km')).toEqual(p('a'));
    expect(out.get('50km')).toEqual(p('b'));
  });

  it('follows a renamed distance back to the route it runs', () => {
    // "21km Day 1" and "21km Day 2" are the same trail run twice, which is the whole
    // point of being able to rename a distance. Both want the 21 km profile.
    const profiles = new Map([['21km', p('trail')]]);
    const routeOf = new Map([
      ['21km Day 1', '21km'],
      ['21km Day 2', '21km'],
    ]);
    const out = matchProfiles(['21km Day 1', '21km Day 2'], profiles, { routeOf });
    expect(out.get('21km Day 1')).toEqual(p('trail'));
    expect(out.get('21km Day 2')).toEqual(p('trail'));
  });

  it('ignores spacing and punctuation when nothing exact is found', () => {
    const profiles = new Map([['100 Miles', p('long')], ['DUT 2026 - 75km', p('mid')]]);
    const out = matchProfiles(['100miles', 'DUT2026-75KM'], profiles);
    expect(out.get('100miles')).toEqual(p('long'));
    expect(out.get('DUT2026-75KM')).toEqual(p('mid'));
  });

  it('prefers an exact name over a flattened one', () => {
    // Two profiles that flatten alike; the course names one of them outright.
    const profiles = new Map([['50 km', p('spaced')], ['50km', p('tight')]]);
    expect(matchProfiles(['50km'], profiles).get('50km')).toEqual(p('tight'));
    expect(matchProfiles(['50 km'], profiles).get('50 km')).toEqual(p('spaced'));
  });

  it('prefers the course’s own name over its route’s', () => {
    // A renamed distance that also happens to have a profile of its own keeps it.
    const profiles = new Map([['21km', p('route')], ['21km Day 2', p('own')]]);
    const routeOf = new Map([['21km Day 2', '21km']]);
    expect(matchProfiles(['21km Day 2'], profiles, { routeOf }).get('21km Day 2')).toEqual(p('own'));
  });

  it('leaves a course out rather than guessing between two of the same length', () => {
    // Nothing is matched on distance. A race with two 21 km courses is ordinary, and a
    // wrong profile is worse than a missing one: it draws climbs that are not there.
    const out = matchProfiles(['Unnamed route'], new Map([['21km', p('a')], ['21km B', p('b')]]));
    expect(out.has('Unnamed route')).toBe(false);
  });

  it('names who is missing, so a gap can be reported', () => {
    // The symptom this whole module exists for: a six-distance race offering three, with
    // nothing on screen saying why.
    const names = ['100km', '75km', '50km', '21km', '15km', '5km'];
    const matched = matchProfiles(names, new Map([['100km', p('a')], ['50km', p('b')], ['15km', p('c')]]));
    expect(matched.size).toBe(3);
    expect(coursesWithoutProfile(names, matched)).toEqual(['75km', '21km', '5km']);
  });

  it('is empty, not broken, when no route files have been dropped', () => {
    const names = ['100km', '50km'];
    const matched = matchProfiles(names, new Map());
    expect(matched.size).toBe(0);
    expect(coursesWithoutProfile(names, matched)).toEqual(names);
  });
});
