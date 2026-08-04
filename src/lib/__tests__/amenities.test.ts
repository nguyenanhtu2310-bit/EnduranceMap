import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AMENITIES,
  DEFAULT_AMENITY_RULES,
  nextAmenityKey,
  resolveAmenities,
  totalAmenities,
  type Amenity,
  type AmenityRules,
} from '../amenities';

/**
 * A stand-in catalogue for the mechanics below. What is under test is the rules engine,
 * not which columns happen to ship, so these stay put when the shipped defaults change —
 * an operator's own list is just as valid an input as ours.
 */
const CATALOGUE: Amenity[] = [
  { key: 'water', label: 'Water', icon: '💧', group: 'station' },
  { key: 'banana', label: 'Banana', icon: '🍌', group: 'station' },
  { key: 'medical', label: 'Medical', icon: '⛑️', group: 'medical' },
];

const RULES: AmenityRules = {
  Low: { water: true },
  Medium: { water: true, banana: true },
  High: { water: true, banana: true, medical: true },
};

describe('the columns a new race starts with', () => {
  it('offers water and medical cover, and nothing else to correct', () => {
    expect(DEFAULT_AMENITIES.map((a) => a.key)).toEqual(['water', 'medical']);
    expect(DEFAULT_AMENITIES.map((a) => a.label)).toEqual(['Water', 'Medical']);
  });

  it('gives each the icon it is recognised by', () => {
    expect(DEFAULT_AMENITIES.find((a) => a.key === 'water')!.icon).toBe('💧');
    expect(DEFAULT_AMENITIES.find((a) => a.key === 'medical')!.icon).toBe('⛑️');
  });

  it('waters every station and reserves medical cover for the busiest', () => {
    for (const level of ['Low', 'Medium', 'High'] as const) {
      expect(resolveAmenities(level, DEFAULT_AMENITY_RULES, undefined).water).toBe(true);
    }
    expect(resolveAmenities('Medium', DEFAULT_AMENITY_RULES, undefined).medical).toBe(false);
    expect(resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined).medical).toBe(true);
  });

  it('mentions no column it does not ship, so nothing resolves to a ghost', () => {
    const keys = new Set(DEFAULT_AMENITIES.map((a) => a.key));
    for (const level of Object.values(DEFAULT_AMENITY_RULES)) {
      for (const key of Object.keys(level)) expect(keys.has(key)).toBe(true);
    }
  });
});

describe('resolveAmenities', () => {
  it('gives every station the basics regardless of traffic', () => {
    for (const level of ['Low', 'Medium', 'High'] as const) {
      expect(resolveAmenities(level, RULES, undefined, CATALOGUE).water).toBe(true);
    }
  });

  it('adds solid food only from medium traffic upward', () => {
    expect(resolveAmenities('Low', RULES, undefined, CATALOGUE).banana).toBe(false);
    expect(resolveAmenities('Medium', RULES, undefined, CATALOGUE).banana).toBe(true);
  });

  it('reserves medical cover for the busiest stations', () => {
    expect(resolveAmenities('Medium', RULES, undefined, CATALOGUE).medical).toBe(false);
    expect(resolveAmenities('High', RULES, undefined, CATALOGUE).medical).toBe(true);
  });

  it('lets a hand edit win over the rule, in both directions', () => {
    expect(resolveAmenities('Low', RULES, { medical: true }, CATALOGUE).medical).toBe(true);
    expect(resolveAmenities('High', RULES, { medical: false }, CATALOGUE).medical).toBe(false);
  });

  it('leaves untouched amenities following the rule when one is edited', () => {
    const set = resolveAmenities('Low', RULES, { medical: true }, CATALOGUE);
    expect(set.water).toBe(true);
    expect(set.banana).toBe(false);
  });

  it('reports every known amenity so a row never has holes', () => {
    const set = resolveAmenities('Low', RULES, undefined, CATALOGUE);
    expect(Object.keys(set).sort()).toEqual(CATALOGUE.map((a) => a.key).sort());
  });
});

describe('totalAmenities', () => {
  it('counts each column across the stops', () => {
    const totals = totalAmenities(
      [
        resolveAmenities('High', RULES, undefined, CATALOGUE),
        resolveAmenities('Low', RULES, undefined, CATALOGUE),
      ],
      CATALOGUE
    );
    expect(totals.water).toBe(2);
    expect(totals.medical).toBe(1);
  });

  it('returns zeroes rather than nothing for an empty course', () => {
    const totals = totalAmenities([]);
    expect(totals.water).toBe(0);
    expect(Object.keys(totals)).toHaveLength(DEFAULT_AMENITIES.length);
  });
});

describe('report sections', () => {
  it('includes only the sections asked for', async () => {
    const { buildReportHtml, ALL_REPORT_SECTIONS } = await import('../report');
    const { runPipeline } = await import('../pipeline');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');
    const result = runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 100,
        fastestMinPerKm: 4,
        typicalMinPerKm: 6,
        slowestMinPerKm: 9,
      },
    ]);

    const base = { raceName: 'Test', rules: DEFAULT_AMENITY_RULES, overrides: {} };

    const all = buildReportHtml(result, { ...base, sections: ALL_REPORT_SECTIONS });
    expect(all).toContain('Station operating schedule');
    expect(all).toContain('Cut-off times');

    const scheduleOnly = buildReportHtml(result, {
      ...base,
      sections: { schedule: true, perDistance: false, splits: false, distribution: false, stationTraffic: false, cutoffs: false },
    });
    expect(scheduleOnly).toContain('Station operating schedule');
    expect(scheduleOnly).not.toContain('Cut-off times');

    const cutoffsOnly = buildReportHtml(result, {
      ...base,
      sections: { schedule: false, perDistance: false, splits: false, distribution: false, stationTraffic: false, cutoffs: true },
    });
    expect(cutoffsOnly).not.toContain('Station operating schedule');
  });

  it('embeds the Sportstats mark so the report stays self-contained offline', async () => {
    const { buildReportHtml } = await import('../report');
    const { runPipeline } = await import('../pipeline');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');
    const result = runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 100,
        fastestMinPerKm: 4,
        typicalMinPerKm: 6,
        slowestMinPerKm: 9,
      },
    ]);

    const html = buildReportHtml(result, {
      raceName: 'Test',
      rules: DEFAULT_AMENITY_RULES,
      overrides: {},
    });

    expect(html).toContain('Powered by');
    expect(html).toContain('data:image/png;base64,');
    // Nothing may be fetched at open time — no scripts, no remote hosts.
    expect(html).not.toMatch(/<script/i);
    expect(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '')).not.toMatch(/https?:\/\//);
  });

  it('escapes race names so a stray quote cannot break the markup', async () => {
    const { buildReportHtml } = await import('../report');
    const { runPipeline } = await import('../pipeline');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');
    const result = runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 100,
        fastestMinPerKm: 4,
        typicalMinPerKm: 6,
        slowestMinPerKm: 9,
      },
    ]);

    const html = buildReportHtml(result, {
      raceName: 'Tam & "Đảo" <Trail>',
      rules: DEFAULT_AMENITY_RULES,
      overrides: {},
    });
    expect(html).toContain('Tam &amp; &quot;Đảo&quot; &lt;Trail&gt;');
    expect(html).not.toContain('<Trail>');
  });
});

describe('migrateAmenityOverrides', () => {
  it('carries a renamed key onto its replacement so saved edits survive', async () => {
    const { migrateAmenityOverrides } = await import('../amenities');
    const migrated = migrateAmenityOverrides({ 'CP5 Bán Dọi': { cdTank: true, water: false } });
    expect(migrated['CP5 Bán Dọi']).toEqual({ iceBucket: true, water: false });
  });

  it('leaves current keys untouched', async () => {
    const { migrateAmenityOverrides } = await import('../amenities');
    const set = { 'CP1': { iceBucket: false, medical: true } };
    expect(migrateAmenityOverrides(set)).toEqual(set);
  });

  it('survives an empty or missing override set', async () => {
    const { migrateAmenityOverrides } = await import('../amenities');
    expect(migrateAmenityOverrides({})).toEqual({});
    expect(migrateAmenityOverrides(undefined as never)).toEqual({});
  });
});

describe('cut-off highlighting in the report', () => {
  async function build(theme: 'light' | 'dark') {
    const { buildReportHtml } = await import('../report');
    const { runPipeline } = await import('../pipeline');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const kml = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.kml'), 'utf-8');
    const result = runPipeline(kml, [
      {
        courseName: '10km',
        startTimeClock: '05:00',
        runnerCount: 100,
        fastestMinPerKm: 4,
        typicalMinPerKm: 6,
        slowestMinPerKm: 9,
      },
      {
        courseName: 'Half Marathon',
        startTimeClock: '04:30',
        runnerCount: 100,
        fastestMinPerKm: 4,
        typicalMinPerKm: 6,
        slowestMinPerKm: 9,
      },
    ]);

    return {
      result,
      html: buildReportHtml(result, {
        raceName: 'Test',
        theme,
        rules: DEFAULT_AMENITY_RULES,
        overrides: {},
      }),
    };
  }

  it('marks the final cut-off in both themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { html } = await build(theme);
      expect(html).toContain('final-row');
      expect(html).toContain('cot-final');
      expect(html).toContain('>final<');
    }
  });

  it('marks every station’s closing time, and marks nothing earlier', async () => {
    // Not one row per station: two distances can round up to the same quarter hour, and
    // when they do both rows genuinely are when that station shuts. What must hold is
    // that a tagged row always carries its station's latest proposal, and that no
    // station is left without one.
    const { result, html } = await build('dark');

    const latest = new Map<string, string>();
    for (const row of result.cutoffTable) {
      const held = latest.get(row.stationName);
      if (!held || row.suggestedClockTime > held) latest.set(row.stationName, row.suggestedClockTime);
    }

    const expected = result.cutoffTable.filter(
      (row) => row.suggestedClockTime === latest.get(row.stationName)
    ).length;
    const finals = (html.match(/class="final-row"/g) ?? []).length;

    expect(finals).toBe(expected);
    expect(finals).toBeGreaterThanOrEqual(latest.size);
  });

  it('picks the latest proposal at a station served by several distances', async () => {
    const { result } = await build('dark');
    const shared = [...new Set(result.cutoffTable.map((r) => r.stationName))].find(
      (name) => result.cutoffTable.filter((r) => r.stationName === name).length > 1
    );
    expect(shared).toBeDefined();

    const rows = result.cutoffTable.filter((r) => r.stationName === shared);
    const latest = rows.map((r) => r.suggestedClockTime).sort().at(-1);
    expect(rows.some((r) => r.suggestedClockTime === latest)).toBe(true);
  });
});

describe('renaming a column', () => {
  it('keeps what each station already had ticked', () => {
    // Labels are the operator's; keys are the app's. Renaming "Banana" to "Orange
    // slices" must not quietly untick every station that already carried it.
    const renamed = CATALOGUE.map((a) =>
      a.key === 'banana' ? { ...a, label: 'Orange slices', icon: '🍊' } : a
    );
    const overrides = { banana: true };

    const before = resolveAmenities('Low', RULES, overrides, CATALOGUE);
    const after = resolveAmenities('Low', RULES, overrides, renamed);

    expect(after.banana).toBe(true);
    expect(after).toEqual(before);
  });

  it('gives a column added by the operator a key of its own', () => {
    const added = [
      ...DEFAULT_AMENITIES,
      { key: nextAmenityKey(DEFAULT_AMENITIES), label: 'Gels', icon: '🍫', group: 'station' as const },
    ];
    const keys = added.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);

    // It starts unticked everywhere, since no rule mentions it.
    const set = resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined, added);
    expect(set[added[added.length - 1].key]).toBe(false);
  });

  it('drops a removed column from the totals rather than counting a ghost', () => {
    const fewer = CATALOGUE.filter((a) => a.key !== 'medical');
    const sets = [resolveAmenities('High', RULES, undefined, CATALOGUE)];
    expect(totalAmenities(sets, fewer)).not.toHaveProperty('medical');
  });
});
