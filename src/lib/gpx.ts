import type { LatLon } from './geo';

/**
 * A point on a recorded or plotted track.
 *
 * Elevation is optional because it is optional in the wild: a GPX written by a timing
 * provider from a road-book carries none, and a KML round-trip can lose it. Everything
 * downstream must cope with a course that has no profile rather than assume zero, which
 * is a real altitude and would read as sea level.
 */
export interface TrackPoint extends LatLon {
  ele?: number;
  /** Seconds since the Unix epoch, where the file records when each point was reached. */
  timeSeconds?: number;
}

export interface RawTrack {
  name: string;
  points: TrackPoint[];
}

export interface RawWaypoint {
  name: string;
  coord: TrackPoint;
}

export interface GpxParseResult {
  tracks: RawTrack[];
  waypoints: RawWaypoint[];
  /** The `creator` attribute, which usually names the device or service that wrote it. */
  creator: string;
  warnings: string[];
}

function localName(el: Element): string {
  return el.tagName.replace(/^.*:/, '');
}

/**
 * Descendants by local name, ignoring namespace.
 *
 * `querySelectorAll` rather than `getElementsByTagName*` because the latter returns a
 * *live* collection, and reading it by index inside an element re-walks that element's
 * subtree every time. On a real 31,270-point track that turned a two-second parse into
 * five minutes. A static list makes the same work take 160ms.
 *
 * A type selector carrying no namespace prefix matches any namespace, so this reads both
 * the default-namespaced files most tools write and the prefixed ones some do.
 */
function byTag(root: ParentNode, tag: string): NodeListOf<Element> {
  return root.querySelectorAll(tag);
}

function childText(el: Element, tag: string): string | undefined {
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    if (localName(children[i]) === tag) return children[i].textContent ?? undefined;
  }
  return undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** ISO 8601 to epoch seconds, or undefined where the stamp is missing or unreadable. */
function parseTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function readPoint(el: Element): TrackPoint | null {
  const lat = parseNumber(el.getAttribute('lat') ?? undefined);
  const lon = parseNumber(el.getAttribute('lon') ?? undefined);
  if (lat === undefined || lon === undefined) return null;

  const point: TrackPoint = { lat, lon };
  const ele = parseNumber(childText(el, 'ele'));
  // A GPX may carry an <ele> element that is empty or unparseable; treating that as 0
  // would place the point at sea level, so it is dropped instead.
  if (ele !== undefined) point.ele = ele;
  const time = parseTime(childText(el, 'time'));
  if (time !== undefined) point.timeSeconds = time;
  return point;
}

/**
 * Reads a GPX file into tracks and waypoints.
 *
 * Handles GPX 1.0 and 1.1 alike — the difference is a namespace and where metadata sits,
 * neither of which changes what a trackpoint means. Segments within one track are joined:
 * a `<trkseg>` break marks a pause in recording, not a break in the course, and a race
 * route that stopped and restarted the watch is still one route.
 */
export function parseGpx(xmlText: string): GpxParseResult {
  const result: GpxParseResult = { tracks: [], waypoints: [], creator: '', warnings: [] };

  const trimmed = xmlText.trim();
  if (!trimmed) {
    result.warnings.push('The file is empty.');
    return result;
  }

  // A failed download is not malformed XML, and saying so helps nobody. Four of the route
  // files handed to this tool arrived as sixteen bytes of placeholder from an export that
  // had silently failed; each looked like a real file until it was opened.
  if (!trimmed.startsWith('<')) {
    throw new Error(
      `This is not a GPX file — it holds ${xmlText.length} bytes of something else, ` +
        `starting "${trimmed.slice(0, 20)}". A download that failed often looks like this; ` +
        `try exporting it again.`
    );
  }

  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Invalid GPX/XML: ${parserError.textContent?.trim() ?? 'unknown parse error'}`);
  }

  const root = doc.documentElement;
  if (!root || localName(root) !== 'gpx') {
    throw new Error(`Not a GPX file: the root element is <${root ? localName(root) : 'nothing'}>.`);
  }

  result.creator = root.getAttribute('creator')?.trim() ?? '';

  const waypoints = byTag(root, 'wpt');
  for (let i = 0, n = waypoints.length; i < n; i++) {
    const coord = readPoint(waypoints[i]);
    if (!coord) continue;
    result.waypoints.push({
      name: childText(waypoints[i], 'name')?.trim() || '(unnamed)',
      coord,
    });
  }

  let unnamed = 0;
  const tracks = byTag(root, 'trk');
  for (let t = 0, tn = tracks.length; t < tn; t++) {
    const trk = tracks[t];

    const points: TrackPoint[] = [];
    const trkpts = byTag(trk, 'trkpt');
    for (let i = 0, n = trkpts.length; i < n; i++) {
      const point = readPoint(trkpts[i]);
      if (point) points.push(point);
    }

    const name = childText(trk, 'name')?.trim() || `Track ${++unnamed}`;
    if (points.length < 2) {
      result.warnings.push(`Track "${name}" has fewer than 2 valid points and was skipped.`);
      continue;
    }
    result.tracks.push({ name, points });
  }

  if (result.tracks.length === 0 && result.warnings.length === 0) {
    result.warnings.push('The file contains no tracks.');
  }

  return result;
}

/**
 * What a file turned out to hold, for the import panel to show before anything is planned
 * on it.
 *
 * Written because four of the route files handed to this tool were silently unusable —
 * two were sixteen bytes of placeholder, one carried 21,713 points and no elevation at
 * all, and one had kept elevation on 1.6% of its points. Every one of them looked fine in
 * a file listing. A bad file should announce itself at import, not three screens later in
 * a cut-off time.
 */
export interface TrackQuality {
  pointCount: number;
  /** Share of points carrying elevation, 0 to 1. */
  elevationCoverage: number;
  hasTimestamps: boolean;
}

export function describeTrack(track: RawTrack): TrackQuality {
  const withElevation = track.points.filter((p) => p.ele !== undefined).length;
  return {
    pointCount: track.points.length,
    elevationCoverage: track.points.length === 0 ? 0 : withElevation / track.points.length,
    hasTimestamps: track.points.some((p) => p.timeSeconds !== undefined),
  };
}
