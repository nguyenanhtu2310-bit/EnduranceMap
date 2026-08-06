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
