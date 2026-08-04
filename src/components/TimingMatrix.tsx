import { useT } from '../lib/i18n';
import type { Course } from '../lib/snap';
import { passKey, type PipelineResult, type PipelineStation } from '../lib/pipeline';
import type { CrossingOverride, RaceOverrides } from '../lib/overrides';
import { EditableCell } from './EditableCell';
import { parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
  notes?: Record<string, string>;
  /** Supplying this makes the note editable here as well as in the schedule. */
  onNoteChange?: (mapName: string, note: string) => void;
  overrides?: RaceOverrides;
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

/** Longest first, the way a race schedule is read. */
function orderedCourses(result: PipelineResult): Course[] {
  return result.courses
    .filter((c) => result.courseOrder.includes(c.name))
    .slice()
    .sort((a, b) => b.totalKm - a.totalKm);
}

interface Cell {
  kms: number[];
  cutoffs: string[];
}

function cellFor(station: PipelineStation, courseName: string): Cell {
  const passes = station.crossings.filter((c) => c.courseName === courseName);
  return {
    kms: passes.map((p) => p.kmFromStart).sort((a, b) => a - b),
    cutoffs: Array.from(
      new Set(passes.map((p) => p.officialCutoffClock).filter((c): c is string => !!c))
    ),
  };
}

export function TimingMatrix({ result, notes, onNoteChange, overrides, onCrossingEdit }: Props) {
  const t = useT();
  const courses = orderedCourses(result);
  const startByCourse = new Map(result.distanceInputs.map((d) => [d.courseName, d.startTimeClock]));

  // Already ordered down the route by the pipeline, so every view agrees.
  const rows = result.stations;

  if (courses.length === 0 || rows.length === 0) {
    return <p className="hint">No timing points to tabulate.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th>{t('Timing point')}</th>
            <th>{t('Operating')}</th>
            {courses.map((course) => (
              <th key={course.name}>{course.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="row-head">Start</td>
            <td className="absent">—</td>
            {courses.map((course) => {
              const start = startByCourse.get(course.name);
              return (
                <td key={course.name} className="start-time">
                  {start ? hm(start) : '—'}
                </td>
              );
            })}
          </tr>

          {rows.map((station) => (
            <tr key={station.schedule.name}>
              <td className="row-head">
                {station.schedule.name}
                {station.sourceNames.length > 0 &&
                  station.sourceNames.join(', ') !== station.schedule.name && (
                    <span className="colocated">{station.sourceNames.join(', ')}</span>
                  )}
                {onNoteChange ? (
                  <input
                    className="note-input"
                    type="text"
                    value={notes?.[station.mapName] ?? ''}
                    placeholder="Note"
                    onChange={(e) => onNoteChange(station.mapName, e.target.value)}
                  />
                ) : (
                  notes?.[station.mapName] && <span className="colocated note">{notes[station.mapName]}</span>
                )}
              </td>
              <td className="km">
                {hm(station.schedule.openClockTime)}–{hm(station.schedule.closeClockTime)}
              </td>
              {courses.map((course) => {
                const cell = cellFor(station, course.name);
                if (cell.kms.length === 0) {
                  return (
                    <td key={course.name} className="absent">
                      –
                    </td>
                  );
                }
                const passes = station.crossings.filter((c) => c.courseName === course.name);
                return (
                  <td key={course.name} className="km">
                    {onCrossingEdit ? (
                      /*
                       * Stacked, not side by side. A course that passes a point twice needs
                       * two editable figures, and laying them across the cell made them read
                       * as two separate distance columns — the second pass of the 21K looked
                       * like a 10K value.
                       */
                      <div className="pass-list">
                        {passes.map((pass) => (
                          <span className="pass" key={pass.passIndex}>
                            {passes.length > 1 && (
                              <span className="pass-index" title={`Pass ${pass.passIndex + 1} of ${passes.length}`}>
                                {pass.passIndex + 1}
                              </span>
                            )}
                            <EditableCell
                              computed={Number(pass.kmFromStart.toFixed(1))}
                              override={
                                overrides?.crossings?.[
                                  passKey(station.mapName, course.name, pass.passIndex)
                                ]?.kmFromStart
                              }
                              type="number"
                              step={0.1}
                              align="right"
                              title={`Kilometre on ${course.name}`}
                              onChange={(v) =>
                                onCrossingEdit(
                                  passKey(station.mapName, course.name, pass.passIndex),
                                  'kmFromStart',
                                  v
                                )
                              }
                            />
                          </span>
                        ))}
                      </div>
                    ) : (
                      cell.kms.map((km) => `${km.toFixed(1)}k`).join(' / ')
                    )}
                    {cell.cutoffs.map((c) => (
                      <span key={c} className="cot">
                        COT {hm(c)}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        Kilometres are measured along each distance's own route, so one point reads differently per race. A
        cell showing two figures is a point the course passes twice — outbound and returning. “Operating” is
        the single continuous shift from open to close.
      </p>
    </div>
  );
}
