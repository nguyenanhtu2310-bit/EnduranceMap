import type { ActivityLevel } from './schedule';

/**
 * What a station hands out or houses. The set mirrors the columns race operations
 * already plan against, so a generated sheet drops straight into the existing workflow.
 */
export interface Amenity {
  key: string;
  label: string;
  icon: string;
  /** Grouping used for the header band, as on the operations sheet. */
  group: 'station' | 'medical';
}

/**
 * What a station hands out by default. Deliberately just the two every race has an
 * opinion about — water at every point, medical cover at the busy ones — because a
 * sheet that arrives pre-filled with eight guessed columns takes longer to correct than
 * an empty one takes to fill. Every race provisions differently, so the operator renames,
 * re-icons, adds and removes from here. Keys stay fixed while labels change, so a rename
 * never loses the per-station decisions stored against them.
 */
export const DEFAULT_AMENITIES: Amenity[] = [
  { key: 'water', label: 'Water', icon: '💧', group: 'station' },
  { key: 'medical', label: 'Medical', icon: '⛑️', group: 'medical' },
];

export type AmenitySet = Record<string, boolean>;

/** Which amenities a traffic level implies, before any per-station edits. */
export type AmenityRules = Record<ActivityLevel, AmenitySet>;

const on = (...keys: string[]): AmenitySet => Object.fromEntries(keys.map((k) => [k, true]));

/**
 * Starting rules, not house rules. Every station carries water; only the busiest carry
 * medical cover. These are a first guess at the categorisation and are meant to be
 * edited — the real thresholds belong to whoever plans the race.
 */
export const DEFAULT_AMENITY_RULES: AmenityRules = {
  Low: on('water'),
  Medium: on('water'),
  High: on('water', 'medical'),
};

/**
 * Resolves what one station stocks: the rule for its traffic level, with any explicit
 * per-station edit taking precedence. An edit is stored per amenity rather than as a
 * whole set, so changing a rule still flows through to everything not hand-set.
 */
export function resolveAmenities(
  level: ActivityLevel,
  rules: AmenityRules,
  overrides: Partial<AmenitySet> | undefined,
  amenities: Amenity[] = DEFAULT_AMENITIES
): AmenitySet {
  const base = rules[level] ?? {};
  const resolved: AmenitySet = {};
  for (const amenity of amenities) {
    const override = overrides?.[amenity.key];
    resolved[amenity.key] = override !== undefined ? override : base[amenity.key] === true;
  }
  return resolved;
}

/**
 * Amenity keys that have been renamed since a race file could have been saved with
 * them. Hand edits are stored per amenity key, so without this a rename would silently
 * drop the operator's decisions when an older file is reopened.
 */
const RENAMED_AMENITY_KEYS: Record<string, string> = {
  cdTank: 'iceBucket',
};

/** Brings a saved override set onto the current amenity keys. */
export function migrateAmenityOverrides(
  overrides: Record<string, Partial<AmenitySet>>
): Record<string, Partial<AmenitySet>> {
  const migrated: Record<string, Partial<AmenitySet>> = {};

  for (const [station, set] of Object.entries(overrides ?? {})) {
    const next: Partial<AmenitySet> = {};
    for (const [key, value] of Object.entries(set ?? {})) {
      next[RENAMED_AMENITY_KEYS[key] ?? key] = value;
    }
    migrated[station] = next;
  }

  return migrated;
}

/** Column totals for the footer row of the operations sheet. */
export function totalAmenities(
  sets: AmenitySet[],
  amenities: Amenity[] = DEFAULT_AMENITIES
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const amenity of amenities) {
    totals[amenity.key] = sets.reduce((sum, set) => sum + (set[amenity.key] ? 1 : 0), 0);
  }
  return totals;
}

/** Emoji offered in the icon picker, grouped roughly as a station is stocked. */
export const AMENITY_ICONS = [
  '💧', '🥤', '🧃', '⚡', '🧂', '🍌', '🍉', '🍊', '🍇', '🥨',
  '🍫', '🧊', '🧽', '🚻', '🩹', '➕', '🚑', '🏥', '📻', '🔦',
  '⛑️', '🧴', '☂️', '🪑', '🗑️', '🎽', '🚴', '🏊', '🏃', '⏱️',
];

/** A distinct key for a newly added amenity, so it never collides with an existing one. */
export function nextAmenityKey(amenities: Amenity[]): string {
  const taken = new Set(amenities.map((a) => a.key));
  for (let i = 1; ; i++) {
    const key = `custom${i}`;
    if (!taken.has(key)) return key;
  }
}
