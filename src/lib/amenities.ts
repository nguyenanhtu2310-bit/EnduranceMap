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

export const AMENITIES: Amenity[] = [
  { key: 'water', label: 'Water', icon: '💧', group: 'station' },
  { key: 'electrolyte', label: 'Electrolyte', icon: '⚡', group: 'station' },
  { key: 'banana', label: 'Banana', icon: '🍌', group: 'station' },
  { key: 'watermelon', label: 'Watermelon', icon: '🍉', group: 'station' },
  { key: 'cdTank', label: 'CD tank', icon: '🪣', group: 'station' },
  { key: 'portaToilet', label: 'Porta toilet', icon: '🚻', group: 'station' },
  { key: 'medical', label: 'Medical', icon: '➕', group: 'medical' },
  { key: 'ambulance', label: 'Ambulance', icon: '🚑', group: 'medical' },
];

export type AmenitySet = Record<string, boolean>;

/** Which amenities a traffic level implies, before any per-station edits. */
export type AmenityRules = Record<ActivityLevel, AmenitySet>;

const on = (...keys: string[]): AmenitySet => Object.fromEntries(keys.map((k) => [k, true]));

/**
 * Starting rules, not house rules. Every station carries water, electrolyte and a
 * toilet; busier ones add solid food and cooling; only the busiest carry medical cover.
 * These are a first guess at the categorisation and are meant to be edited — the real
 * thresholds belong to whoever plans the race.
 */
export const DEFAULT_AMENITY_RULES: AmenityRules = {
  Low: on('water', 'electrolyte', 'portaToilet'),
  Medium: on('water', 'electrolyte', 'portaToilet', 'banana', 'watermelon'),
  High: on('water', 'electrolyte', 'portaToilet', 'banana', 'watermelon', 'cdTank', 'medical', 'ambulance'),
};

/**
 * Resolves what one station stocks: the rule for its traffic level, with any explicit
 * per-station edit taking precedence. An edit is stored per amenity rather than as a
 * whole set, so changing a rule still flows through to everything not hand-set.
 */
export function resolveAmenities(
  level: ActivityLevel,
  rules: AmenityRules,
  overrides: Partial<AmenitySet> | undefined
): AmenitySet {
  const base = rules[level] ?? {};
  const resolved: AmenitySet = {};
  for (const amenity of AMENITIES) {
    const override = overrides?.[amenity.key];
    resolved[amenity.key] = override !== undefined ? override : base[amenity.key] === true;
  }
  return resolved;
}

/** Column totals for the footer row of the operations sheet. */
export function totalAmenities(sets: AmenitySet[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const amenity of AMENITIES) {
    totals[amenity.key] = sets.reduce((sum, set) => sum + (set[amenity.key] ? 1 : 0), 0);
  }
  return totals;
}
