export interface ParsedLabel {
  /** The km-from-start position embedded in the name, e.g. 7.4 from "KM7.4/42". */
  kmFromName?: number;
  /** The race distance embedded alongside the km, e.g. 42 from "KM7.4/42". */
  raceDistanceFromName?: number;
  /** An operating time window embedded in the name, e.g. "(03:00 - 09:30)". */
  timeWindow?: { open: string; close: string };
  /** The name with recognized tokens stripped, for display purposes. */
  cleanName: string;
}

// "KM7.4/42", "Km 21.1 / 42.2", etc. — a km mark followed by the race's total distance.
const KM_WITH_DISTANCE_RE = /KM\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i;
// A bare km mark with no trailing "/distance", e.g. "KM7.4".
const KM_ONLY_RE = /KM\s*(\d+(?:\.\d+)?)(?!\s*\/)/i;
// "(03:00 - 09:30)" style operating windows.
const TIME_WINDOW_RE = /\(\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*\)/;

export function parsePlacemarkLabel(rawName: string): ParsedLabel {
  const name = rawName.trim();

  let kmFromName: number | undefined;
  let raceDistanceFromName: number | undefined;

  const withDistance = name.match(KM_WITH_DISTANCE_RE);
  const kmOnly = withDistance ? null : name.match(KM_ONLY_RE);

  if (withDistance) {
    kmFromName = parseFloat(withDistance[1]);
    raceDistanceFromName = parseFloat(withDistance[2]);
  } else if (kmOnly) {
    kmFromName = parseFloat(kmOnly[1]);
  }

  const timeMatch = name.match(TIME_WINDOW_RE);
  const timeWindow = timeMatch ? { open: timeMatch[1], close: timeMatch[2] } : undefined;

  const kmToken = withDistance?.[0] ?? kmOnly?.[0] ?? '';
  let cleanName = name
    .replace(kmToken, '')
    .replace(timeMatch?.[0] ?? '', '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-:,]+|[\s\-:,]+$/g, '')
    .trim();

  if (cleanName.length === 0) cleanName = name;

  return { kmFromName, raceDistanceFromName, timeWindow, cleanName };
}
