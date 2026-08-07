/**
 * How often to write a time along a chart's bottom edge.
 *
 * An hourly tick is right for a road race and unreadable for a trail one: a 49-hour
 * course puts forty-nine labels along an axis that has room for a dozen, and on paper
 * they merge into a grey band. The span decides the interval, not habit.
 *
 * The choices are the ones a race actually thinks in — quarter hours, halves, then whole
 * hours doubling up to a day. A "nice" interval computed from the span arithmetically
 * lands on things like 47 minutes, which is correct, fits, and reads as a mistake.
 */
const TICK_CHOICES = [
  15 * 60,
  30 * 60,
  3600,
  2 * 3600,
  3 * 3600,
  4 * 3600,
  6 * 3600,
  12 * 3600,
  24 * 3600,
];

/** The coarsest interval is a day: past that a chart needs fewer stations, not fewer ticks. */
export const MAX_TICK_SECONDS = TICK_CHOICES[TICK_CHOICES.length - 1];

/**
 * The smallest interval from that list which keeps the label count inside the budget.
 *
 * Smallest, so a chart is never coarser than it needs to be — a two-hour race gets its
 * quarter hours and a two-day one gets its six-hourly marks, from the same rule.
 */
export function axisTickSeconds(spanSeconds: number, maxLabels: number): number {
  if (!(spanSeconds > 0) || !(maxLabels > 0)) return TICK_CHOICES[0];
  for (const step of TICK_CHOICES) {
    if (spanSeconds / step <= maxLabels) return step;
  }
  return MAX_TICK_SECONDS;
}

/**
 * The moments to label, aligned to the interval rather than to where the race began.
 *
 * A four-hourly axis starting from a 05:37 gun would read 05:37, 09:37, 13:37 — true,
 * and nothing anybody can navigate by. Aligned, it reads 08:00, 12:00, 16:00, and a crew
 * chief can find the hour they are looking for without doing arithmetic.
 */
export function axisTicks(
  startSeconds: number,
  endSeconds: number,
  maxLabels: number
): { seconds: number; step: number }[] {
  const span = endSeconds - startSeconds;
  const step = axisTickSeconds(span, maxLabels);
  const first = Math.ceil(startSeconds / step) * step;

  const out: { seconds: number; step: number }[] = [];
  for (let t = first; t <= endSeconds; t += step) out.push({ seconds: t, step });
  return out;
}
