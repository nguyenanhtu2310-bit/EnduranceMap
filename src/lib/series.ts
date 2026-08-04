/**
 * Categorical slots in fixed order — a distance keeps its colour no matter how many
 * others are on screen, so filtering never repaints the survivors, and the overview
 * chart, the per-station charts and the report all colour a race the same.
 *
 * Values are the validated reference palette; the CSS variables live in index.css.
 */
const SERIES_SLOTS = 8;

export function seriesVar(index: number): string {
  return `var(--series-${(index % SERIES_SLOTS) + 1})`;
}
