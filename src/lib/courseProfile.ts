import { buildCourse } from './geo';
import { describeTrack, type RawTrack, type TrackQuality } from './gpx';
import {
  elevationCharacter,
  elevationTotals,
  flatEquivalentKm,
  segmentClimbs,
  type Climb,
  type ElevationCharacterResult,
  type ElevationTotals,
  type ProfilePoint,
} from './elevation';

/** Everything one route file turns out to say about its course. */
export interface CourseProfile {
  name: string;
  totalKm: number;
  quality: TrackQuality;
  /** Empty where the file carries no usable elevation. */
  profile: ProfilePoint[];
  character: ElevationCharacterResult | null;
  totals: ElevationTotals | null;
  climbs: Climb[];
  flatEquivalentKm: number | null;
}

export interface CourseProfileOptions {
  /** Smallest rise or fall worth naming as a climb. */
  minClimbMetres?: number;
  /**
   * Name to use where the track carries none of its own. Real route files rarely name
   * their track, and "Track 1" tells a race director nothing — whereas the file they
   * chose is almost always named for the distance it holds.
   */
  fallbackName?: string;
}

/**
 * Reads one track into the shape the screen needs.
 *
 * Elevation is treated as absent unless every point carries it. A profile with holes is
 * worse than none: on a real file that had kept altitude on 1.6% of its points, the
 * surviving fragments happened to sit in the course's lowest valley and made the whole
 * route look like it ran along a riverbed.
 */
export function readCourseProfile(track: RawTrack, options: CourseProfileOptions = {}): CourseProfile {
  const quality = describeTrack(track);
  // A generated "Track 1" is a placeholder, not a name, so the caller's suggestion wins.
  const name = /^Track \d+$/.test(track.name) && options.fallbackName ? options.fallbackName : track.name;
  const course = buildCourse(track.points);
  const totalKm = course.length > 0 ? course[course.length - 1].cumulativeKm : 0;

  if (quality.elevationCoverage < 1 || course.length < 2) {
    return {
      name,
      totalKm,
      quality,
      profile: [],
      character: null,
      totals: null,
      climbs: [],
      flatEquivalentKm: null,
    };
  }

  const profile: ProfilePoint[] = course.map((vertex, i) => ({
    cumulativeKm: vertex.cumulativeKm,
    ele: track.points[i].ele as number,
  }));
  const elevations = profile.map((p) => p.ele);
  const character = elevationCharacter(elevations);

  return {
    name,
    totalKm,
    quality,
    profile,
    character,
    totals: elevationTotals(elevations, character.thresholdMetres),
    climbs: segmentClimbs(profile, { minChangeMetres: options.minClimbMetres ?? 150 }),
    flatEquivalentKm: flatEquivalentKm(profile),
  };
}

export interface ProfileBand {
  km: number;
  low: number;
  high: number;
}

/**
 * Thins a profile down to a drawable number of columns, keeping the extremes in each.
 *
 * A 65,699-point course cannot be drawn point for point, and sampling every nth point
 * would drop the summits — precisely the features anyone reads a profile for. Carrying
 * the lowest and highest reading in each column instead keeps every peak and valley at
 * whatever width the chart happens to be.
 */
export function resampleProfile(profile: ProfilePoint[], columns: number): ProfileBand[] {
  if (profile.length === 0 || columns < 1) return [];

  const totalKm = profile[profile.length - 1].cumulativeKm;
  if (totalKm <= 0) return [{ km: 0, low: profile[0].ele, high: profile[0].ele }];

  const bands: (ProfileBand | undefined)[] = new Array(columns);
  for (const point of profile) {
    const index = Math.min(columns - 1, Math.floor((point.cumulativeKm / totalKm) * columns));
    const band = bands[index];
    if (!band) {
      bands[index] = { km: point.cumulativeKm, low: point.ele, high: point.ele };
    } else {
      if (point.ele < band.low) band.low = point.ele;
      if (point.ele > band.high) band.high = point.ele;
    }
  }

  return bands.filter((b): b is ProfileBand => b !== undefined);
}

/** A station as it appears on a course's profile: where it is, and whether it counts anyone. */
export interface StationMark {
  name: string;
  kmFromStart: number;
  /** Which pass this is, for a station a course crosses more than once. */
  passIndex: number;
  passCount: number;
  isTimed: boolean;
}

/**
 * Every station one course passes, in the order it meets them.
 *
 * A pass rather than a station: an out-and-back reads its mat twice and the two are
 * different moments on the profile, hours apart, with the whole field between them.
 */
export function stationMarks(
  stations: {
    schedule: { name: string };
    crossings: { courseName: string; kmFromStart: number; passIndex: number; passCount: number }[];
    isTimed: boolean;
  }[],
  courseName: string
): StationMark[] {
  const marks: StationMark[] = [];
  for (const station of stations) {
    for (const crossing of station.crossings) {
      if (crossing.courseName !== courseName) continue;
      marks.push({
        name: station.schedule.name,
        kmFromStart: crossing.kmFromStart,
        passIndex: crossing.passIndex,
        passCount: crossing.passCount,
        isTimed: station.isTimed,
      });
    }
  }
  return marks.sort((a, b) => a.kmFromStart - b.kmFromStart);
}

export interface PlacedLabel {
  /** Index into the marks array this label belongs to. */
  index: number;
  /** Which row it was given, counting down from the top. */
  row: number;
  x: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface LabelLayout {
  placed: PlacedLabel[];
  /** How many rows were needed. */
  rows: number;
  /** Labels that would not fit anywhere without overlapping, by mark index. */
  dropped: number[];
}

/**
 * Fits station labels above a profile without letting any two touch.
 *
 * Staggering by position alone is not enough: "CP Topas Ecolodge (2)" is four times the
 * width of "CP5", so two labels can sit on different rows and still collide with a third.
 * Each label is measured, then given the first row where it clears whatever is already
 * there — which is why a crowded stretch of course grows rows instead of overprinting.
 *
 * A label with nowhere to go is dropped rather than drawn on top of another, because an
 * unreadable label is worse than an absent one and the dot is still there to hover.
 */
export function layoutLabels(
  labels: { x: number; text: string }[],
  options: { width: number; maxRows?: number; charWidth?: number; gap?: number } = { width: 900 }
): LabelLayout {
  const maxRows = options.maxRows ?? 6;
  const charWidth = options.charWidth ?? 5.4;
  const gap = options.gap ?? 6;

  const order = labels.map((label, index) => ({ ...label, index })).sort((a, b) => a.x - b.x);
  const rowEnds: number[] = [];
  const placed: PlacedLabel[] = [];
  const dropped: number[] = [];

  for (const label of order) {
    const width = label.text.length * charWidth;
    // Labels near an edge are anchored to it, so they lean inwards rather than off the page.
    const anchor: PlacedLabel['anchor'] =
      label.x < width / 2 ? 'start' : label.x > options.width - width / 2 ? 'end' : 'middle';
    const left = anchor === 'start' ? label.x : anchor === 'end' ? label.x - width : label.x - width / 2;
    const right = left + width;

    let row = -1;
    for (let candidate = 0; candidate < maxRows; candidate++) {
      if ((rowEnds[candidate] ?? -Infinity) + gap <= left) {
        row = candidate;
        break;
      }
    }

    if (row === -1) {
      dropped.push(label.index);
      continue;
    }
    rowEnds[row] = right;
    placed.push({ index: label.index, row, x: label.x, anchor });
  }

  return { placed, rows: rowEnds.length, dropped };
}
