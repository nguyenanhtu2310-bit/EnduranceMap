import { useState } from 'react';
import { isEndZoneStop, passKey, type PipelineResult, type PipelineStation } from '../lib/pipeline';
import { useT } from '../lib/i18n';
import type { CrossingOverride, RaceOverrides } from '../lib/overrides';
import { EditableCell } from './EditableCell';
import { eventDayLabel, parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';
import {
  DEFAULT_AMENITIES,
  resolveAmenities,
  totalAmenities,
  type Amenity,
  type AmenityRules,
  type AmenitySet,
} from '../lib/amenities';

interface Props {
  result: PipelineResult;
  /** The event's first date, so a station standing past midnight can name its days. */
  raceDate?: string;
  rules: AmenityRules;
  /** The columns this race provisions, which the operator names and orders. */
  amenities?: Amenity[];
  /** Per-station hand edits, keyed by the station's map name then amenity key. */
  overrides: Record<string, Partial<AmenitySet>>;
  onOverridesChange: (next: Record<string, Partial<AmenitySet>>) => void;
  /** Removes a single course pass — see `passKey`. */
  onRemovePass?: (key: string) => void;
  notes?: Record<string, string>;
  /** Supplying this makes the note editable here as well as in the schedule. */
  onNoteChange?: (mapName: string, note: string) => void;
  raceOverrides?: RaceOverrides;
  onCrossingEdit?: <K extends keyof CrossingOverride>(
    key: string,
    field: K,
    value: CrossingOverride[K] | undefined
  ) => void;
}

function hm(clock: string): string {
  const seconds = parseClockTimeToSeconds(clock);
  return seconds === null ? clock : secondsToClockTime(seconds).slice(0, 5);
}

interface Stop {
  station: PipelineStation;
  kmFromStart: number;
  passIndex: number;
  passCount: number;
  gapKm: number;
  officialCutoffClock?: string;
}

/**
 * Every point a runner on one distance actually meets, in the order they meet it.
 * A station the course passes twice appears twice — on an out-and-back the second
 * visit is a separate resupply, and spacing it as though it were one stop understates
 * what the position has to carry.
 */
function buildRun(result: PipelineResult, courseName: string): Stop[] {
  const stops: Stop[] = [];

  for (const station of result.stations) {
    for (const crossing of station.crossings) {
      if (crossing.courseName !== courseName) continue;
      stops.push({
        station,
        kmFromStart: crossing.kmFromStart,
        passIndex: crossing.passIndex,
        passCount: crossing.passCount,
        gapKm: 0,
        officialCutoffClock: crossing.officialCutoffClock,
      });
    }
  }

  stops.sort((a, b) => a.kmFromStart - b.kmFromStart);

  let previousKm = 0;
  for (const stop of stops) {
    stop.gapKm = stop.kmFromStart - previousKm;
    previousKm = stop.kmFromStart;
  }

  return stops;
}

export function DistanceRunView({
  result,
  raceDate,
  rules,
  amenities = DEFAULT_AMENITIES,
  overrides,
  onOverridesChange,
  onRemovePass,
  notes,
  onNoteChange,
  raceOverrides,
  onCrossingEdit,
}: Props) {
  const t = useT();
  const courses = [...result.courses]
    .filter((c) => result.courseOrder.includes(c.name))
    // Legs are raced in order; separate distances read best longest first.
    .sort((a, b) =>
      result.legOrdered
        ? result.courseOrder.indexOf(a.name) - result.courseOrder.indexOf(b.name)
        : b.totalKm - a.totalKm
    );

  const [selected, setSelected] = useState(courses[0]?.name ?? '');
  const course = courses.find((c) => c.name === selected) ?? courses[0];

  if (!course) return <p className="hint">No distances to show.</p>;

  const stops = buildRun(result, course.name);
  const finalGap = course.totalKm - (stops[stops.length - 1]?.kmFromStart ?? 0);
  const longestGap = Math.max(0, ...stops.map((s) => s.gapKm), finalGap);
  const onCourse = (stop: Stop) =>
    !isEndZoneStop(stop.station.mapName, stop.kmFromStart, course.totalKm);
  const courseStops = stops.filter(onCourse);

  // Totals describe the stops runners actually meet between the lines, so start and
  // finish furniture is listed but not counted.
  const totals = totalAmenities(
    courseStops.map((stop) =>
      resolveAmenities(stop.station.schedule.activityLevel, rules, overrides[stop.station.mapName], amenities)
    ),
    amenities
  );

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: '1rem' }}>
        {courses.map((c) => (
          <button
            key={c.name}
            className={c.name === course.name ? undefined : 'secondary'}
            onClick={() => setSelected(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {stops.length === 0 ? (
        <p className="hint">No scheduled positions sit on the {course.name} route.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{t('Point')}</th>
                <th className="num">{t('At km')}</th>
                <th className="num">{t('Gap from previous')}</th>
                <th className="num">{t('Open')}</th>
                <th className="num">{t('Close')}</th>
                <th className="num">{t('Cut-off')}</th>
                <th>{t('Activity')}</th>
                {amenities.map((a) => (
                  <th key={a.key} className="amenity-col" title={t(a.label)}>
                    {t(a.label)}
                  </th>
                ))}
                {onRemovePass && <th aria-label="Remove" />}
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <tr
                  key={`${stop.station.mapName}-${stop.passIndex}`}
                  className={onCourse(stop) ? undefined : 'end-zone'}
                >
                  <td className="num muted">{onCourse(stop) ? courseStops.indexOf(stop) + 1 : '—'}</td>
                  <td>
                    <span className="station-name">{stop.station.schedule.name}</span>
                    {stop.passCount > 1 && (
                      <span className="colocated">
                        pass {stop.passIndex + 1} of {stop.passCount}
                      </span>
                    )}
                    {onNoteChange ? (
                      <input
                        className="note-input"
                        type="text"
                        value={notes?.[stop.station.mapName] ?? ''}
                        placeholder="Note"
                        onChange={(e) => onNoteChange(stop.station.mapName, e.target.value)}
                      />
                    ) : (
                      notes?.[stop.station.mapName] && (
                        <span className="colocated note">{notes[stop.station.mapName]}</span>
                      )
                    )}
                  </td>
                  <td className="num">
                    {onCrossingEdit ? (
                      <EditableCell
                        computed={Number(stop.kmFromStart.toFixed(1))}
                        override={
                          raceOverrides?.crossings?.[
                            passKey(stop.station.mapName, course.name, stop.passIndex)
                          ]?.kmFromStart
                        }
                        type="number"
                        step={0.1}
                        align="right"
                        title="Kilometre on this route"
                        onChange={(v) =>
                          onCrossingEdit(passKey(stop.station.mapName, course.name, stop.passIndex), 'kmFromStart', v)
                        }
                      />
                    ) : (
                      stop.kmFromStart.toFixed(1)
                    )}
                  </td>
                  <td className="num">
                    {/* The tag leads, so the figures stay flush right in one column
                        instead of the tagged row's number being shunted left. */}
                    {stop.gapKm === longestGap && stop.gapKm > 0 && (
                      <span className="tag over" style={{ marginRight: '0.4rem' }}>
                        {t('longest')}
                      </span>
                    )}
                    {stop.gapKm.toFixed(1)}
                  </td>
                  {/* Each end names its own day — a station opening Saturday and closing
                      Sunday says so here rather than only in the schedule. */}
                  <td className="num">
                    {hm(stop.station.schedule.openClockTime)}
                    <span className="colocated">
                      {eventDayLabel(stop.station.schedule.openSeconds, raceDate)}
                    </span>
                  </td>
                  <td className="num">
                    {hm(stop.station.schedule.closeClockTime)}
                    <span className="colocated">
                      {eventDayLabel(stop.station.schedule.closeSeconds, raceDate)}
                    </span>
                  </td>
                  <td className="num">
                    {onCrossingEdit ? (
                      <EditableCell
                        computed={stop.officialCutoffClock ? hm(stop.officialCutoffClock) : ''}
                        override={
                          raceOverrides?.crossings?.[
                            passKey(stop.station.mapName, course.name, stop.passIndex)
                          ]?.cutoffClock
                        }
                        type="time"
                        align="right"
                        title="Cut-off at this pass"
                        onChange={(v) =>
                          onCrossingEdit(passKey(stop.station.mapName, course.name, stop.passIndex), 'cutoffClock', v)
                        }
                      />
                    ) : stop.officialCutoffClock ? (
                      hm(stop.officialCutoffClock)
                    ) : (
                      '–'
                    )}
                  </td>
                  <td>
                    <span className={`tag ${stop.station.schedule.activityLevel}`}>
                      {stop.station.schedule.activityLevel}
                    </span>
                  </td>
                  {amenities.map((a) => {
                    const set = resolveAmenities(
                      stop.station.schedule.activityLevel,
                      rules,
                      overrides[stop.station.mapName],
                      amenities
                    );
                    const isEdited = overrides[stop.station.mapName]?.[a.key] !== undefined;
                    return (
                      <td key={a.key} className="amenity-col">
                        <button
                          type="button"
                          className={set[a.key] ? 'amenity on' : 'amenity'}
                          title={`${a.label} — ${set[a.key] ? 'provided' : 'not provided'}${isEdited ? ' (set by hand)' : ''}`}
                          onClick={() => {
                            const forStation = { ...(overrides[stop.station.mapName] ?? {}) };
                            forStation[a.key] = !set[a.key];
                            onOverridesChange({ ...overrides, [stop.station.mapName]: forStation });
                          }}
                        >
                          {set[a.key] ? a.icon : ''}
                        </button>
                      </td>
                    );
                  })}
                  {onRemovePass && (
                    <td>
                      <button
                        type="button"
                        className="row-remove"
                        title={`Remove this ${stop.station.schedule.name} pass from every section`}
                        onClick={() =>
                          onRemovePass(passKey(stop.station.mapName, course.name, stop.passIndex))
                        }
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <td className="num muted">—</td>
                <td className="muted">Course end</td>
                <td className="num">{course.totalKm.toFixed(1)}</td>
                <td className="num">
                  {finalGap === longestGap && finalGap > 0 && (
                    <span className="tag over" style={{ marginRight: '0.4rem' }}>
                      {t('longest')}
                    </span>
                  )}
                  {finalGap.toFixed(1)}
                </td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td />
                {amenities.map((a) => (
                  <td key={a.key} />
                ))}
                {onRemovePass && <td />}
              </tr>
              <tr className="total-row">
                <td />
                <td className="row-head">Total</td>
                <td className="num">{courseStops.length} {t('on course')}</td>
                <td className="num" />
                <td className="num" />
                <td className="num" />
                <td className="num" />
                <td />
                {amenities.map((a) => (
                  <td key={a.key} className="amenity-col num">
                    {totals[a.key]}
                  </td>
                ))}
                {onRemovePass && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {courseStops.length} stop{courseStops.length === 1 ? '' : 's'} on course over{' '}
        {course.totalKm.toFixed(1)} km, longest gap <strong>{longestGap.toFixed(1)} km</strong>. Start and
        finish furniture is greyed out and left out of the counts. Gaps are measured along this distance's own
        route, so a point the course passes twice is listed twice — the second visit is a separate resupply.
        Where a divided road puts the two carriageways within the snapping corridor, a pass may appear that
        runners cannot actually reach; remove it with the × and every section follows.
      </p>
    </>
  );
}
