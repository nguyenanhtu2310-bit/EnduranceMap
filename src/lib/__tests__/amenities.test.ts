import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AMENITIES,
  DEFAULT_AMENITY_RULES,
  nextAmenityKey,
  resolveAmenities,
  totalAmenities,
} from '../amenities';

describe('resolveAmenities', () => {
  it('gives every station the basics regardless of traffic', () => {
    for (const level of ['Low', 'Medium', 'High'] as const) {
      const set = resolveAmenities(level, DEFAULT_AMENITY_RULES, undefined);
      expect(set.water).toBe(true);
      expect(set.electrolyte).toBe(true);
      expect(set.portaToilet).toBe(true);
    }
  });

  it('adds solid food only from medium traffic upward', () => {
    expect(resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined).banana).toBe(false);
    expect(resolveAmenities('Medium', DEFAULT_AMENITY_RULES, undefined).banana).toBe(true);
  });

  it('reserves medical cover for the busiest stations', () => {
    expect(resolveAmenities('Medium', DEFAULT_AMENITY_RULES, undefined).ambulance).toBe(false);
    expect(resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined).ambulance).toBe(true);
  });

  it('lets a hand edit win over the rule, in both directions', () => {
    const added = resolveAmenities('Low', DEFAULT_AMENITY_RULES, { medical: true });
    expect(added.medical).toBe(true);

    const removed = resolveAmenities('High', DEFAULT_AMENITY_RULES, { ambulance: false });
    expect(removed.ambulance).toBe(false);
  });

  it('leaves untouched amenities following the rule when one is edited', () => {
    const set = resolveAmenities('Low', DEFAULT_AMENITY_RULES, { medical: true });
    expect(set.water).toBe(true);
    expect(set.banana).toBe(false);
  });

  it('reports every known amenity so a row never has holes', () => {
    const set = resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined);
    expect(Object.keys(set).sort()).toEqual(DEFAULT_AMENITIES.map((a) => a.key).sort());
  });
});

describe('totalAmenities', () => {
  it('counts each column across the stops', () => {
    const totals = totalAmenities([
      resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined),
      resolveAmenities('Low', DEFAULT_AMENITY_RULES, undefined),
    ]);
    expect(totals.water).toBe(2);
    expect(totals.ambulance).toBe(1);
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
      sections: { schedule: true, perDistance: false, splits: false, distribution: false, cutoffs: false },
    });
    expect(scheduleOnly).toContain('Station operating schedule');
    expect(scheduleOnly).not.toContain('Cut-off times');

    const cutoffsOnly = buildReportHtml(result, {
      ...base,
      sections: { schedule: false, perDistance: false, splits: false, distribution: false, cutoffs: true },
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

  it('marks exactly one row per station as final', async () => {
    const { result, html } = await build('dark');
    const stations = new Set(result.cutoffTable.map((r) => r.stationName));
    const finals = (html.match(/class="final-row"/g) ?? []).length;
    expect(finals).toBe(stations.size);
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
    // Labels are the operator's; keys are the app's. Renaming "Watermelon" to "Orange
    // slices" must not quietly untick every station that already carried it.
    const renamed = DEFAULT_AMENITIES.map((a) =>
      a.key === 'watermelon' ? { ...a, label: 'Orange slices', icon: '🍊' } : a
    );
    const overrides = { watermelon: true };

    const before = resolveAmenities('Low', DEFAULT_AMENITY_RULES, overrides, DEFAULT_AMENITIES);
    const after = resolveAmenities('Low', DEFAULT_AMENITY_RULES, overrides, renamed);

    expect(after.watermelon).toBe(true);
    expect(after).toEqual(before);
  });

  it('gives a column added by the operator a key of its own', () => {
    const added = [...DEFAULT_AMENITIES, { key: nextAmenityKey(DEFAULT_AMENITIES), label: 'Gels', icon: '🍫', group: 'station' as const }];
    const keys = added.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);

    // It starts unticked everywhere, since no rule mentions it.
    const set = resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined, added);
    expect(set[added[added.length - 1].key]).toBe(false);
  });

  it('drops a removed column from the totals rather than counting a ghost', () => {
    const fewer = DEFAULT_AMENITIES.filter((a) => a.key !== 'ambulance');
    const sets = [resolveAmenities('High', DEFAULT_AMENITY_RULES, undefined, DEFAULT_AMENITIES)];
    expect(totalAmenities(sets, fewer)).not.toHaveProperty('ambulance');
  });
});
