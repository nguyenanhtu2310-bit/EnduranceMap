/**
 * The timing system's own list of where it reads chips, and what each read is called.
 *
 * This is the naming authority for a race. A course map's placemarks are drawn to mark
 * positions, and on real maps they are called "Điểm 5" and "Point 23" because naming
 * twenty-nine pins by hand is nobody's evening. The timing configuration, by contrast,
 * has to be exact — its names become the column headers of the results file — so it is
 * the file worth trusting, and matching a placemark to it by kilometre gives the pin its
 * real name without anyone editing the map.
 *
 * RaceResult exports it as `.lvs`, which is JSON.
 */

export interface TimingPoint {
  /** The name that becomes a column in the results export. */
  name: string;
  /** What to call it on screen — the timer's own label, or the name where there is none. */
  label: string;
  /**
   * The physical mat. Two timing points naming the same mat are two passes over one
   * place, not two places: a course that runs out and back reads the same hardware twice.
   */
  mat: string;
  /** A second reader at the same place, where one was set up. */
  backupMat: string;
  kmFromStart: number;
  /** RaceResult's sport code — 255 marks the start, 100 running. */
  sportCode: number;
}

export interface TimingPointSet {
  points: TimingPoint[];
  warnings: string[];
}

/** Shape of one split as RaceResult writes it. Everything else in the record is ignored. */
interface RawSplit {
  Name?: unknown;
  Label?: unknown;
  TimingPoint?: unknown;
  Backup?: unknown;
  Distance?: unknown;
  DistanceUnit?: unknown;
  TypeOfSport?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Distance in kilometres, whatever unit the file states it in.
 *
 * Real exports mix the two within one file — the start line is written in metres and
 * every checkpoint in kilometres — so a reader that assumes either one places the start
 * of the race a thousand kilometres along the course, or every checkpoint a metre in.
 */
function toKm(distance: unknown, unit: unknown): number | null {
  const value = typeof distance === 'number' ? distance : Number(distance);
  if (!Number.isFinite(value) || value < 0) return null;

  switch (text(unit).toLowerCase()) {
    case 'km':
    case '':
      return value;
    case 'm':
      return value / 1000;
    case 'mi':
    case 'mile':
    case 'miles':
      return value * 1.609344;
    default:
      return null;
  }
}

export function parseTimingPoints(fileText: string): TimingPointSet {
  const result: TimingPointSet = { points: [], warnings: [] };

  // A byte-order mark is legal at the head of a UTF-8 file and fatal to JSON.parse, and
  // this export carries one.
  const trimmed = fileText.replace(/^﻿/, '').trim();
  if (!trimmed) {
    result.warnings.push('The file is empty.');
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'This is not a RaceResult split file — it is not JSON. Export the splits from the ' +
        'timing program as .lvs and try again.'
    );
  }

  const splits = (parsed as { Splits?: unknown })?.Splits;
  if (!Array.isArray(splits)) {
    throw new Error('This file has no "Splits" list, so it is not a RaceResult split export.');
  }

  for (const raw of splits as RawSplit[]) {
    const name = text(raw?.Name);
    const mat = text(raw?.TimingPoint);
    // A split with neither a name nor a mat is a blank row in the timer's table.
    if (!name && !mat) continue;

    const kmFromStart = toKm(raw?.Distance, raw?.DistanceUnit);
    if (kmFromStart === null) {
      result.warnings.push(
        `"${name || mat}" has no usable distance (${String(raw?.Distance)} ${text(raw?.DistanceUnit)}) ` +
          `and was skipped.`
      );
      continue;
    }

    const sport = typeof raw?.TypeOfSport === 'number' ? raw.TypeOfSport : 0;
    result.points.push({
      name: name || mat,
      label: text(raw?.Label) || name || mat,
      mat,
      backupMat: text(raw?.Backup),
      kmFromStart,
      sportCode: sport,
    });
  }

  if (result.points.length === 0) result.warnings.push('The file lists no timing points.');
  result.points.sort((a, b) => a.kmFromStart - b.kmFromStart);
  return result;
}

/**
 * The mats a course passes more than once, with every pass over each.
 *
 * The tool already models one physical place crossed several times; this is the timing
 * system saying the same thing in its own words, and the two must agree. A real 100 km
 * reads its Lếch Mông mat at 17.6 km and again at 95.6 km — one crew, one tent, thirty-
 * eight hours, and two entirely different columns in the results file.
 */
export function matsCrossedTwice(points: TimingPoint[]): Map<string, TimingPoint[]> {
  const byMat = new Map<string, TimingPoint[]>();
  for (const point of points) {
    if (!point.mat) continue;
    const passes = byMat.get(point.mat);
    if (passes) passes.push(point);
    else byMat.set(point.mat, [point]);
  }

  for (const [mat, passes] of byMat) {
    if (passes.length < 2) byMat.delete(mat);
  }
  return byMat;
}
