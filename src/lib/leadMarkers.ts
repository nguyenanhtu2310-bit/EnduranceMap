import type { LeadArrival } from './pipeline';

/** Anything carrying lead markers: a station, or one half of a split start/finish. */
interface HasLeads {
  leadArrivals?: LeadArrival[];
}

/**
 * Layout shared by the on-screen chart and the printed one, so a report handed to an
 * organiser shows the same marks in the same places as the screen it was made from.
 */

/**
 * A station's lead markers, earliest first. Tolerates a race saved before the field
 * existed, which would otherwise throw on reopening.
 */
export function leadsForStation(station: HasLeads): LeadArrival[] {
  return [...(station.leadArrivals ?? [])].sort((a, b) => a.seconds - b.seconds);
}

/**
 * Stacks a row's markers so every glyph is drawn.
 *
 * Markers arrive in time order. Each takes the topmost lane whose last glyph has
 * cleared, so two leaders a minute apart sit one above the other rather than one of
 * them going unlabelled — a mark without its ♂ or ♀ has had the only thing it was
 * there to say taken off it.
 */
export function assignLeadLanes(xs: number[], glyphWidth: number): number[] {
  const lastInLane: number[] = [];
  return xs.map((x) => {
    let lane = 0;
    while (lastInLane[lane] !== undefined && x - lastInLane[lane] < glyphWidth) lane++;
    lastInLane[lane] = x;
    return lane;
  });
}

/** The mark itself: ♂ for a man, ♀ for a woman. */
export function sexGlyph(sex: LeadArrival['sex']): string {
  return sex === 'M' ? '♂' : '♀';
}

/** How the sex is named wherever there is room for words. */
export function sexLabel(sex: LeadArrival['sex']): string {
  return sex === 'M' ? 'First Male' : 'First Female';
}

/** The earliest lead arrival of one sex at a station, across every distance through it. */
export function firstLeadOfSex(
  station: HasLeads,
  sex: LeadArrival['sex']
): LeadArrival | undefined {
  return leadsForStation(station).find((l) => l.sex === sex);
}
