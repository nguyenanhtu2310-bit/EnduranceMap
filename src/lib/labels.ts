import { parseClockTimeToSeconds } from './time';

export interface KmMark {
  /** Km-from-start position claimed by the label. */
  km: number;
  /** The race distance this km mark belongs to, e.g. 42 in "KM7.4/42". */
  raceDistanceKm?: number;
  /** Set when the source text was malformed and had to be normalized, e.g. "14.4.5". */
  rawText?: string;
}

export interface CutoffSpec extends KmMark {
  /** Cut-off clock time as written, e.g. "4:10 AM". */
  cutoffClock: string;
  /** Seconds since midnight, for comparison. */
  cutoffSeconds: number;
}

export interface ParsedLabel {
  /** Every km/distance pair found anywhere in the name. */
  kmMarks: KmMark[];
  /** Km/distance pairs that carry an explicit single cut-off time. */
  cutoffs: CutoffSpec[];
  /** A two-time operating window, e.g. "(03:00 - 09:30)" on medical stations. */
  timeWindow?: { open: string; close: string };
  /** Race distances named without a km position, e.g. [21, 10] from "U-turn 21km/10km". */
  distancesServed: number[];
  /** The name with recognized tokens stripped, for display. */
  cleanName: string;
  /** Data-quality problems worth surfacing to the user rather than silently guessing. */
  warnings: string[];

  /** Convenience accessor: the first km mark. Kept for simple single-mark placemarks. */
  kmFromName?: number;
  /** Convenience accessor: the first km mark's race distance. */
  raceDistanceFromName?: number;
}

/** A time, optionally with a meridiem: "4:10 AM", "03:00". */
const TIME_TEXT = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?`;

/*
 * These are built fresh per use rather than shared as module constants: they carry
 * the /g flag, and a shared global regex keeps mutable `lastIndex` state that would
 * make results depend on call order.
 */

/**
 * A km/distance pair. The "KM" prefix is optional because real files contain both
 * "KM27.5/42" and bare "27.5/42". The km part tolerates a malformed extra decimal
 * group (e.g. "14.4.5") so it can be normalized and flagged rather than dropped.
 */
const kmPairRe = () => new RegExp(String.raw`(?:KM\s*)?(\d+(?:\.\d+)+|\d+)\s*\/\s*(\d+(?:\.\d+)?)`, 'gi');

/** A bare km mark with no "/distance" suffix, e.g. "KM7.4". Requires the KM prefix to avoid matching stray numbers. */
const kmOnlyRe = () => /KM\s*(\d+(?:\.\d+)+|\d+)(?!\s*[/\d])/gi;

/** Race distances written as "21km" / "10km", as in "U-turn 21km/10km". */
const distanceKmRe = () => /(\d+(?:\.\d+)?)\s*km/gi;

const TIME_WINDOW_RE = new RegExp(String.raw`(${TIME_TEXT})\s*[-–—]\s*(${TIME_TEXT})`);
const SINGLE_TIME_RE = new RegExp(String.raw`[-–—]\s*(${TIME_TEXT})\s*$`);

/**
 * Normalizes a possibly-malformed decimal number. Real KML contains typos like
 * "14.4.5"; we keep the integer part and the final fragment ("14.5") and report it,
 * rather than dropping the checkpoint or silently inventing a value.
 */
function parseLooseNumber(text: string): { value: number; malformed: boolean } {
  const parts = text.split('.');
  if (parts.length <= 2) return { value: parseFloat(text), malformed: false };
  const normalized = `${parts[0]}.${parts[parts.length - 1]}`;
  return { value: parseFloat(normalized), malformed: true };
}

/** Extracts the parenthesized groups of a name, plus the text outside them. */
function splitParenGroups(name: string): { groups: string[]; outside: string } {
  const groups: string[] = [];
  let outside = '';
  let depth = 0;
  let current = '';

  for (const char of name) {
    if (char === '(') {
      if (depth === 0) current = '';
      else current += char;
      depth++;
    } else if (char === ')' && depth > 0) {
      depth--;
      if (depth === 0) groups.push(current);
      else current += char;
    } else if (depth > 0) {
      current += char;
    } else {
      outside += char;
    }
  }

  if (depth > 0 && current.trim()) groups.push(current);

  return { groups, outside };
}

function extractKmMarks(text: string, warnings: string[]): KmMark[] {
  const marks: KmMark[] = [];

  for (const m of text.matchAll(kmPairRe())) {
    const { value, malformed } = parseLooseNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    if (malformed) {
      warnings.push(`Malformed km value "${m[1]}" interpreted as ${value} — verify against the source map.`);
    }
    marks.push({ km: value, raceDistanceKm: parseFloat(m[2]), rawText: malformed ? m[1] : undefined });
  }

  if (marks.length === 0) {
    for (const m of text.matchAll(kmOnlyRe())) {
      const { value, malformed } = parseLooseNumber(m[1]);
      if (!Number.isFinite(value)) continue;
      if (malformed) {
        warnings.push(`Malformed km value "${m[1]}" interpreted as ${value} — verify against the source map.`);
      }
      marks.push({ km: value, rawText: malformed ? m[1] : undefined });
    }
  }

  return marks;
}

/**
 * Strips km-position tokens from a display name. Race-distance tokens ("42km",
 * "21km/10km") are deliberately kept: they are what distinguishes two U-turns on the
 * same street, so removing them would collapse distinct stations to one name.
 */
function stripKmTokens(text: string): string {
  return text.replace(kmPairRe(), ' ').replace(kmOnlyRe(), ' ');
}

export function parsePlacemarkLabel(rawName: string): ParsedLabel {
  const name = rawName.replace(/\s+/g, ' ').trim();
  const warnings: string[] = [];

  const { groups, outside } = splitParenGroups(name);

  const kmMarks: KmMark[] = [];
  const cutoffs: CutoffSpec[] = [];
  let timeWindow: ParsedLabel['timeWindow'];

  for (const group of groups) {
    const groupMarks = extractKmMarks(group, warnings);
    kmMarks.push(...groupMarks);

    const windowMatch = group.match(TIME_WINDOW_RE);
    if (windowMatch) {
      // Two times in one group is an operating window (medical stations), not a cut-off.
      if (!timeWindow) timeWindow = { open: windowMatch[1].trim(), close: windowMatch[2].trim() };
      continue;
    }

    const singleMatch = group.match(SINGLE_TIME_RE);
    if (!singleMatch) continue;

    const cutoffClock = singleMatch[1].trim();
    const cutoffSeconds = parseClockTimeToSeconds(cutoffClock);
    if (cutoffSeconds === null) {
      warnings.push(`Could not parse cut-off time "${cutoffClock}".`);
      continue;
    }

    if (groupMarks.length === 0) {
      cutoffs.push({ km: NaN, cutoffClock, cutoffSeconds });
    } else {
      // One cut-off time can cover several distances, e.g. "(KM15.3/42 & KM10.3/21 - 5:25 AM)".
      for (const mark of groupMarks) cutoffs.push({ ...mark, cutoffClock, cutoffSeconds });
    }
  }

  // Km marks written outside any parentheses still count.
  kmMarks.push(...extractKmMarks(outside, warnings));

  // Distances named as bare "21km/10km" (typical of U-turn placemarks), excluding
  // anything already accounted for as a km-from-start mark.
  const distancesServed: number[] = [];
  for (const m of outside.matchAll(distanceKmRe())) {
    const value = parseFloat(m[1]);
    if (Number.isFinite(value) && !distancesServed.includes(value)) distancesServed.push(value);
  }

  let cleanName = stripKmTokens(outside)
    .replace(/\s{2,}/g, ' ')
    // Separators orphaned by token removal, e.g. "U-turn / : X" from "U-turn 21km/10km: X".
    .replace(/\s+[/&]\s+/g, ' ')
    .replace(/\s+([:,])/g, '$1')
    .replace(/^[\s\-:,&/]+|[\s\-:,&/]+$/g, '')
    .trim();
  if (cleanName.length === 0) cleanName = name;

  return {
    kmMarks,
    cutoffs,
    timeWindow,
    distancesServed,
    cleanName,
    warnings,
    kmFromName: kmMarks[0]?.km,
    raceDistanceFromName: kmMarks[0]?.raceDistanceKm,
  };
}
