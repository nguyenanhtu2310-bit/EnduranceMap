import { parsePlacemarkLabel, type ParsedLabel } from './labels';
import type { LatLon } from './geo';

export interface RawCourse {
  name: string;
  points: LatLon[];
}

export interface RawPlacemark {
  name: string;
  /** Name of the immediate containing folder, e.g. "CUT-OFF TIME". */
  folder: string;
  coord: LatLon;
  label: ParsedLabel;
}

export interface KmlParseResult {
  courses: RawCourse[];
  placemarks: RawPlacemark[];
  warnings: string[];
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

function handlePlacemark(placemarkEl: Element, folderName: string, result: KmlParseResult) {
  const name = getChildText(placemarkEl, 'name')?.trim() || '(unnamed)';

  const lineString = findDescendant(placemarkEl, 'LineString');
  if (lineString) {
    const coordsEl = findDescendant(lineString, 'coordinates');
    const points = coordsEl ? parseCoordinatesText(coordsEl.textContent ?? '') : [];
    if (points.length < 2) {
      result.warnings.push(`Course "${name}" has fewer than 2 valid coordinate points and was skipped.`);
      return;
    }
    result.courses.push({ name, points });
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

function walkFolder(folderEl: Element, folderName: string, result: KmlParseResult) {
  for (const child of Array.from(folderEl.children)) {
    const tag = localName(child);
    if (tag === 'Folder') {
      const nestedName = getChildText(child, 'name')?.trim() || folderName;
      walkFolder(child, nestedName, result);
    } else if (tag === 'Placemark') {
      handlePlacemark(child, folderName, result);
    }
  }
}

export function parseKml(xmlText: string): KmlParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`Invalid KML/XML: ${parserError.textContent?.trim() ?? 'unknown parse error'}`);
  }

  const result: KmlParseResult = { courses: [], placemarks: [], warnings: [] };

  const documentEl = doc.getElementsByTagName('Document')[0] ?? doc.documentElement;
  walkFolder(documentEl, '', result);

  if (result.courses.length === 0) {
    result.warnings.push(
      'No course LineStrings found — expected a "RACE ROUTE" folder with one LineString per distance.'
    );
  }

  return result;
}
