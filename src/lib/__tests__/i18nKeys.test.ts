import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The dictionary is one object literal keyed by the English string, which JavaScript
 * will happily let you write twice — the later entry silently wins and the earlier
 * translation disappears. That has happened five times while this file grew, always
 * caught by the compiler rather than by anyone reading it, so it is checked here where
 * the message can say which key.
 */
describe('the Vietnamese dictionary', () => {
  const source = readFileSync('src/lib/i18n.tsx', 'utf8');
  const dictionary = source.slice(source.indexOf('const VI'), source.lastIndexOf('};'));
  const keys = Array.from(
    dictionary.matchAll(/^  (?:'((?:[^'\\]|\\.)*)'|([A-Za-z_][A-Za-z0-9_]*)):/gm),
    (m) => m[1] ?? m[2]
  );

  it('has entries at all, so a broken regex fails loudly rather than passing', () => {
    expect(keys.length).toBeGreaterThan(150);
  });

  it('translates each English string exactly once', () => {
    // Counted rather than filtered through a Set: `seen.add(key)` returns the Set, which
    // is always truthy, so the obvious `!seen.add(key)` is always false and this test
    // passed against every duplicate it existed to catch — including one added the same
    // afternoon it was checked. The compiler caught that one, as it had caught the five
    // before it, which is exactly what this was written to stop relying on.
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const duplicates = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
    expect(duplicates).toEqual([]);
  });

  it('fails when a key really is written twice', () => {
    // The guard above is only worth having if it bites, and the version it replaced did
    // not. This checks the check.
    const doubled = [...keys, keys[0]];
    const counts = new Map<string, number>();
    for (const key of doubled) counts.set(key, (counts.get(key) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n > 1).map(([key]) => key)).toEqual([keys[0]]);
  });
});
