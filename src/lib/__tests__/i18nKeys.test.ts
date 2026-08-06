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
    const seen = new Set<string>();
    const duplicates = keys.filter((key) => !seen.add(key));
    expect(duplicates).toEqual([]);
  });
});
