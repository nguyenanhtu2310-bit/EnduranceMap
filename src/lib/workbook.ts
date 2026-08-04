import { isEndZoneStop, type PipelineResult, type PipelineStation } from './pipeline';
import {
  DEFAULT_AMENITIES,
  resolveAmenities,
  type Amenity,
  type AmenityRules,
  type AmenitySet,
} from './amenities';
import { formatDuration, parseClockTimeToSeconds, secondsToClockTime, windowSeconds } from './time';
import { peakRunnersPerWindow } from './schedule';
import { firstLeadOfSex, leadsForStation } from './leadMarkers';
import type { ReportSections } from './report';
import type { Sheet, CellValue } from './xlsx';

/**
 * The plan as a workbook, one sheet per section.
 *
 * The HTML report is a document to read; this is the same content as something to work
 * with — sorted, filtered, pasted into a supplier's order form, split between marshals.
 * Numbers are written as numbers rather than formatted text so they stay summable, and
 * the kilometre a point falls at gets its own column per distance rather than being
 * folded into one cell, because a spreadsheet has no trouble with width.
 */
export interface WorkbookOptions {
  raceName: string;
  rules: AmenityRules;
  overrides: Record<string, Partial<AmenitySet>>;
  amenities?: Amenity[];
  notes?: Record<string, string>;
  sections?: ReportSections;
}

function hm(clock: string): string {
  return clock.slice(0, 5);
}

/** Course columns in the order the distribution stacks them. */
function coursesOf(result: PipelineResult) {
  return result.courses.filter((c) => result.courseOrder.includes(c.name));
}

function scheduleSheet(result: PipelineResult, options: WorkbookOptions): Sheet {
  const notes = options.notes ?? {};
  const rows: CellValue[][] = [
    ['Station', 'Map name', 'Note', 'Open', 'Close', 'Duration', 'Peak window', `Peak /${result.binMinutes} min`, 'Activity', 'Cut-off risk', 'Crossings'],
  ];

  for (const station of result.stations) {
    const seconds = windowSeconds(station.schedule.openClockTime, station.schedule.closeClockTime);
    rows.push([
      station.schedule.name,
      station.sourceNames.join(', '),
      notes[station.mapName] ?? '',
      hm(station.schedule.openClockTime),
      hm(station.schedule.closeClockTime),
      seconds && seconds > 0 ? formatDuration(seconds) : '',
      (() => {
        const bin = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
        return bin
          ? `${hm(secondsToClockTime(bin.binStartSeconds))}–${hm(secondsToClockTime(bin.binEndSeconds))}`
          : '';
      })(),
      peakRunnersPerWindow(station.schedule.peakRunnersPerHour, result.binMinutes),
      station.schedule.activityLevel,
      station.schedule.cutoffExceeded ? 'yes' : '',
      station.crossings
        .map((c) => `${c.courseName} ${c.kmFromStart.toFixed(1)}km`)
        .join(' / '),
    ]);
  }

  return { name: 'Station schedule', rows };
}

/**
 * One row per point per distance, with the kilometre it falls at.
 *
 * A point a course passes twice gets a row per pass, so the outbound and returning
 * readings can be sorted and filtered rather than living in one cell.
 */
function splitsSheet(result: PipelineResult): Sheet {
  const rows: CellValue[][] = [
    ['Distance', 'Station', 'Km', 'Pass', 'Of', 'Open', 'Close', 'Duration', 'Cut-off'],
  ];

  for (const course of coursesOf(result)) {
    const stops: { station: PipelineStation; km: number; pass: number; of: number; cot?: string }[] = [];
    for (const station of result.stations) {
      for (const crossing of station.crossings) {
        if (crossing.courseName !== course.name) continue;
        stops.push({
          station,
          km: crossing.kmFromStart,
          pass: crossing.passIndex + 1,
          of: crossing.passCount,
          cot: crossing.officialCutoffClock,
        });
      }
    }
    stops.sort((a, b) => a.km - b.km);

    for (const stop of stops) {
      const seconds = windowSeconds(
        stop.station.schedule.openClockTime,
        stop.station.schedule.closeClockTime
      );
      rows.push([
        course.name,
        stop.station.schedule.name,
        Number(stop.km.toFixed(2)),
        stop.pass,
        stop.of,
        hm(stop.station.schedule.openClockTime),
        hm(stop.station.schedule.closeClockTime),
        seconds && seconds > 0 ? formatDuration(seconds) : '',
        stop.cot ? hm(stop.cot) : '',
      ]);
    }
  }

  return { name: 'Split calculation', rows };
}

/**
 * What each point stocks, per distance, with the gap from the previous point.
 *
 * Start and finish furniture is listed but marked, matching the on-screen view where it
 * is greyed out and left out of the counts — spacing is about what lies between the
 * lines, not the lines themselves.
 */
function amenitiesSheet(result: PipelineResult, options: WorkbookOptions): Sheet {
  const amenities = options.amenities ?? DEFAULT_AMENITIES;
  const rows: CellValue[][] = [
    ['Distance', '#', 'Station', 'Km', 'Gap from previous', 'Open', 'Close', 'Activity', 'On course', ...amenities.map((a) => a.label)],
  ];

  for (const course of coursesOf(result)) {
    const stops: { station: PipelineStation; km: number }[] = [];
    for (const station of result.stations) {
      for (const crossing of station.crossings) {
        if (crossing.courseName === course.name) stops.push({ station, km: crossing.kmFromStart });
      }
    }
    stops.sort((a, b) => a.km - b.km);

    let previousKm = 0;
    let counted = 0;
    for (const stop of stops) {
      const gap = stop.km - previousKm;
      previousKm = stop.km;
      const onCourse = !isEndZoneStop(stop.station.mapName, stop.km, course.totalKm);
      if (onCourse) counted++;

      const set = resolveAmenities(
        stop.station.schedule.activityLevel,
        options.rules,
        options.overrides[stop.station.mapName],
        amenities
      );

      rows.push([
        course.name,
        onCourse ? counted : '',
        stop.station.schedule.name,
        Number(stop.km.toFixed(2)),
        Number(gap.toFixed(2)),
        hm(stop.station.schedule.openClockTime),
        hm(stop.station.schedule.closeClockTime),
        stop.station.schedule.activityLevel,
        onCourse ? 'yes' : 'start/finish',
        ...amenities.map((a) => (set[a.key] ? 'yes' : '')),
      ]);
    }
  }

  return { name: 'Course amenities', rows };
}

/** Minutes between the modelled tail and the proposed cut-off, as on screen. */
function marginMinutes(suggested: string, modeled: string): number | null {
  const a = parseClockTimeToSeconds(suggested);
  const b = parseClockTimeToSeconds(modeled);
  return a === null || b === null ? null : Math.round((a - b) / 60);
}

function cutoffSheet(result: PipelineResult): Sheet {
  const rows: CellValue[][] = [
    [
      'Distance',
      'Station',
      'Km',
      'Slowest arrival',
      'Proposed cut-off',
      'Margin (min)',
      'Provided COT',
      'Provided is tighter',
    ],
  ];

  for (const row of result.cutoffTable) {
    const margin = marginMinutes(row.suggestedClockTime, row.modeledLastArrivalClockTime);
    rows.push([
      row.courseName,
      row.stationName,
      Number(row.kmFromStart.toFixed(2)),
      hm(row.modeledLastArrivalClockTime),
      hm(row.suggestedClockTime),
      margin === null ? '' : margin,
      row.mapClockTime ? hm(row.mapClockTime) : '',
      row.mapIsTighter ? 'yes' : '',
    ]);
  }

  return { name: 'Cut-off times', rows };
}

/**
 * The distribution as numbers rather than bars: peak window, what came through it, and
 * the head of the field. The chart is the thing to look at; this is the thing to sort.
 */
function distributionSheet(result: PipelineResult): Sheet {
  const anyLeads = result.stations.some((s) => leadsForStation(s).length > 0);
  const rows: CellValue[][] = [
    [
      'Station',
      'Peak window',
      `Through in ${result.binMinutes} min`,
      'Busiest distance',
      'Activity',
      ...(anyLeads ? ['First Male', 'First Male distance', 'First Female', 'First Female distance'] : []),
    ],
  ];

  for (const station of result.stations) {
    const peak = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
    const window = peak
      ? `${hm(secondsToClockTime(peak.binStartSeconds))}–${hm(secondsToClockTime(peak.binEndSeconds))}`
      : '';

    let busiest = '';
    if (peak) {
      let bestCount = 0;
      peak.byCourse.forEach((count, i) => {
        if (count > bestCount) {
          bestCount = count;
          busiest = result.courseOrder[i];
        }
      });
    }

    const lead = (sex: 'M' | 'F'): CellValue[] => {
      const first = firstLeadOfSex(station, sex);
      return first ? [hm(secondsToClockTime(first.seconds)), first.courseName] : ['', ''];
    };

    rows.push([
      station.schedule.name,
      window,
      peak ? peak.total : 0,
      busiest,
      station.schedule.activityLevel,
      ...(anyLeads ? [...lead('M'), ...lead('F')] : []),
    ]);
  }

  return { name: 'Crossing distribution', rows };
}

/** A cover sheet, so a shared file explains itself without the covering email. */
function summarySheet(result: PipelineResult, options: WorkbookOptions): Sheet {
  const rows: CellValue[][] = [
    ['Race', options.raceName || 'Untitled race'],
    ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ['Stations', result.stations.length],
    [],
    ['Distance', 'Measured km', 'Start', 'Stations on course'],
  ];

  for (const course of coursesOf(result)) {
    const input = result.distanceInputs.find((d) => d.courseName === course.name);
    const onCourse = result.stations.filter((s) =>
      s.crossings.some(
        (c) => c.courseName === course.name && !isEndZoneStop(s.mapName, c.kmFromStart, course.totalKm)
      )
    ).length;
    rows.push([course.name, Number(course.totalKm.toFixed(2)), input ? hm(input.startTimeClock) : '', onCourse]);
  }

  if (result.warnings.length > 0) {
    rows.push([], ['Warnings']);
    for (const warning of result.warnings) rows.push([warning]);
  }

  return { name: 'Summary', rows };
}

export function buildReportSheets(result: PipelineResult, options: WorkbookOptions): Sheet[] {
  const wanted = options.sections;
  const sheets: Sheet[] = [summarySheet(result, options)];

  if (!wanted || wanted.schedule) sheets.push(scheduleSheet(result, options));
  if (!wanted || wanted.perDistance) sheets.push(amenitiesSheet(result, options));
  if (!wanted || wanted.splits) sheets.push(splitsSheet(result));
  if (!wanted || wanted.distribution) sheets.push(distributionSheet(result));
  if (!wanted || wanted.cutoffs) sheets.push(cutoffSheet(result));

  return sheets;
}
