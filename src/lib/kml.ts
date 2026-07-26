import { parsePlacemarkLabel, type ParsedLabel } from './labels';
import type { LatLon } from './geo';

export interface RawCourse {
  name: string;
  folder: string;
  points: LatLon[];
}

/** A LineString outside the course folder — road-closure/setup segments, kept for reference. */
export interface RawSegment {
  name: string;
  folder: string;
  points: LatLon[];
  label: ParsedLabel;
}

export interface RawPlacemark {
  name: string;
  /** Name of the immediate containing folder, e.g. "CUT-OFF TIME". */
  folder: string;
  coord: LatLon;
  label: ParsedLabel;
}

export interface KmlParseResult {
  /** LineStrings inside the course folder — the actual race routes. */
  courses: RawCourse[];
  /** LineStrings everywhere else — road closures and course setup, not race routes. */
  segments: RawSegment[];
  placemarks: RawPlacemark[];
  warnings: string[];
}

export interface KmlParseOptions {
  /**
   * Name of the folder holding the race-route LineStrings. Real maps carry hundreds of
   * other LineStrings (barrier runs, road-closure spans) that must not be mistaken for
   * courses, so only this folder's lines are treated as routes.
   */
  courseFolderName?: string;
}

export const DEFAULT_COURSE_FOLDER_NAME = 'RACE ROUTE';

function normalizeFolderName(name: string): string {
  return name.trim().toLowerCase();
}

function localName(el: Element): string {
  return el.tagName.replace(/^.*:/, '');
}

function getChildText(el: Element, tag: string): string | undefined {
  const child = Array.from(el.children).find((c) => localName(c) === tag);
  return child?.textContent ?? undefined;
}

function findDescendant(el: Element, tag: string): Element | undefined {
  return Array.from(el.getElementsByTagName('*')).find((c) => localName(c) === tag);
}

function parseCoordinatesText(text: string): LatLon[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((triplet) => {
      const [lon, lat] = triplet.split(',').map(Number);
      return { lat, lon };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function handlePlacemark(placemarkEl: Element, folderName: string, courseFolder: string, result: KmlParseResult) {
  const name = getChildText(placemarkEl, 'name')?.trim() || '(unnamed)';

  const lineString = findDescendant(placemarkEl, 'LineString');
  if (lineString) {
    const coordsEl = findDescendant(lineString, 'coordinates');
    const points = coordsEl ? parseCoordinatesText(coordsEl.textContent ?? '') : [];
    if (points.length < 2) {
      result.warnings.push(`Line "${name}" has fewer than 2 valid coordinate points and was skipped.`);
      return;
    }
    if (normalizeFolderName(folderName) === courseFolder) {
      result.courses.push({ name, folder: folderName, points });
    } else {
      result.segments.push({ name, folder: folderName, points, label: parsePlacemarkLabel(name) });
    }
    return;
  }

  const point = findDescendant(placemarkEl, 'Point');
  if (point) {
    const coordsEl = findDescendant(point, 'coordinates');
    const points = coordsEl ? parseCoordinatesText(coordsEl.textContent ?? '') : [];
    if (points.length === 0) {
      result.warnings.push(`Placemark "${name}" has no valid coordinates and was skipped.`);
      return;
    }
    result.placemarks.push({
      name,
      folder: folderName,
      coord: points[0],
      label: parsePlacemarkLabel(name),
    });
    return;
  }

  // Placemarks with other geometry types (Polygon, MultiGeometry, ...) are out of scope for the MVP.
}

function walkFolder(folderEl: Element, folderName: string, courseFolder: string, result: KmlParseResult) {
  for (const child of Array.from(folderEl.children)) {
    const tag = localName(child);
    if (tag === 'Folder') {
      const nestedName = getChildText(child, 'name')?.trim() || folderName;
      walkFolder(child, nestedName, courseFolder, result);
    } else if (tag === 'Placemark') {
      handlePlacemark(child, folderName, courseFolder, result);
    }
  }
}

export function parseKml(xmlText: string, options: KmlParseOptions = {}): KmlParseResult {
  const courseFolderName = options.courseFolderName ?? DEFAULT_COURSE_FOLDER_NAME;
  const courseFolder = normalizeFolderName(courseFolderName);

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Invalid KML/XML: ${parserError.textContent?.trim() ?? 'unknown parse error'}`);
  }

  const result: KmlParseResult = { courses: [], segments: [], placemarks: [], warnings: [] };

  const documentEl = doc.getElementsByTagName('Document')[0] ?? doc.documentElement;
  walkFolder(documentEl, '', courseFolder, result);

  if (result.courses.length === 0) {
    const seen = Array.from(new Set(result.segments.map((s) => s.folder))).filter(Boolean);
    result.warnings.push(
      `No course LineStrings found in a folder named "${courseFolderName}".` +
        (seen.length ? ` Folders containing lines: ${seen.map((f) => `"${f}"`).join(', ')}.` : '')
    );
  }

  return result;
}
