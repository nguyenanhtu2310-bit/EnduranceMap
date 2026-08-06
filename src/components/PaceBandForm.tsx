import type { DistanceInput } from '../lib/pipeline';
import { TimeInput } from './TimeInput';
import { useT } from '../lib/i18n';

export interface DistanceFormRow extends Omit<DistanceInput, 'runnerCount'> {
  /** Kept as a string so the field can be cleared while typing. */
  runnerCountText: string;
  measuredKm: number;
}

interface Props {
  rows: DistanceFormRow[];
  onChange: (rows: DistanceFormRow[]) => void;
  /** Courses whose pace comes from a results file, so the band here is reference only. */
  drivenByResults?: Set<string>;
  /** The event's first date, so a day can be named rather than counted. */
  raceDate?: string;
  /** Courses a hand-added distance can be pointed at, longest first. */
  courses?: { name: string; totalKm: number }[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Names the day an offset lands on, for the picker's own labels.
 *
 * Falls back to counting where no date is set, because "D+1" is still better than a
 * clock time that could mean either of two mornings.
 */
function dayOptions(raceDate?: string): { value: number; label: string }[] {
  const base = raceDate ? new Date(`${raceDate}T00:00:00`) : null;
  const usable = base && !Number.isNaN(base.getTime()) ? base : null;
  return [0, 1, 2, 3].map((value) => {
    if (!usable) return { value, label: value === 0 ? 'Day 1' : `D+${value}` };
    const day = new Date(usable);
    day.setDate(day.getDate() + value);
    return { value, label: `${WEEKDAYS[day.getDay()]} ${day.getDate()}` };
  });
}

function DayPicker({
  value,
  onChange,
  raceDate,
  title,
}: {
  value: number;
  onChange: (day: number) => void;
  raceDate?: string;
  title: string;
}) {
  return (
    <select value={value} title={title} onChange={(e) => onChange(Number(e.target.value))}>
      {dayOptions(raceDate).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const NUMERIC_FIELDS = [
  { key: 'fastestMinPerKm', label: 'Fastest', title: 'Pace of the leading runners, in minutes per km' },
  { key: 'typicalMinPerKm', label: 'Typical', title: 'Median runner pace, in minutes per km' },
  { key: 'slowestMinPerKm', label: 'Slowest', title: 'Pace of the final finishers, in minutes per km' },
] as const;

export function PaceBandForm({ rows, onChange, drivenByResults, raceDate, courses = [] }: Props) {
  const t = useT();
  function update(index: number, patch: Partial<DistanceFormRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /*
   * A distance the route files do not describe, running on a course that they do.
   *
   * One route is often raced by more than one field — an elite wave off the same start an
   * hour earlier, a relay on the marathon course, a category with its own cut-off. Each
   * needs its own start, its own field size and its own band, and until now the only
   * distances on offer were the ones a file happened to contain.
   *
   * It borrows an existing course's geometry rather than inventing any: the pipeline
   * already gives a named leg its own copy of a drawn route, which is the same problem.
   */
  function addRow() {
    const source = courses[0];
    if (!source) return;
    const base = rows.find((r) => r.courseName === source.name);
    let name = `${source.name} (2)`;
    for (let n = 2; rows.some((r) => r.courseName === name); n++) name = `${source.name} (${n})`;
    onChange([
      ...rows,
      {
        ...(base ?? {
          startTimeClock: '05:00',
          startSpreadMinutes: 10,
          fastestMinPerKm: 3.2,
          typicalMinPerKm: 6.5,
          slowestMinPerKm: 10,
        }),
        courseName: name,
        sourceCourseName: source.name,
        measuredKm: source.totalKm,
        runnerCountText: '100',
        organizerCutoffClock: '',
      } as DistanceFormRow,
    ]);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('Distance')}</th>
            <th className="num">{t('Measured')}</th>
            <th>{t('Start')}</th>
            <th title={t('Which day of the event this distance starts on')}>{t('Start day')}</th>
            <th className="num" title={t('Minutes over which the whole field crosses the start line')}>
              {t('Spread (min)')}
            </th>
            <th className="num">{t('Runners')}</th>
            {NUMERIC_FIELDS.map((f) => (
              <th key={f.key} className="num" title={t(f.title)}>
                {t(f.label)}
              </th>
            ))}
            <th className="num" title="Cut-off time provided by the organizer — leave blank if not provided yet">
              COT
            </th>
            <th title={t('Which day the cut-off falls on — an ultra finishes on another day')}>
              {t('COT day')}
            </th>
            <th aria-label={t('Remove')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.courseName}>
              <td>
                <strong>{row.courseName}</strong>
                {drivenByResults?.has(row.courseName) && (
                  <span className="colocated">{t('from results file')}</span>
                )}
              </td>
              <td className="num muted">{row.measuredKm.toFixed(2)} km</td>
              <td style={{ minWidth: 110 }}>
                <TimeInput
                  value={row.startTimeClock}
                  onChange={(v) => update(i, { startTimeClock: v })}
                  title="Gun time for this distance"
                />
              </td>
              <td style={{ minWidth: 96 }}>
                <DayPicker
                  value={row.startDayOffset ?? 0}
                  onChange={(day) => update(i, { startDayOffset: day })}
                  raceDate={raceDate}
                  title={t('Which day of the event this distance starts on')}
                />
              </td>
              <td className="num" style={{ minWidth: 80 }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={row.startSpreadMinutes ?? 0}
                  onChange={(e) => update(i, { startSpreadMinutes: Number(e.target.value) })}
                />
              </td>
              <td className="num" style={{ minWidth: 90 }}>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={row.runnerCountText}
                  onChange={(e) => update(i, { runnerCountText: e.target.value })}
                />
              </td>
              {NUMERIC_FIELDS.map((f) => (
                <td key={f.key} className="num" style={{ minWidth: 80 }}>
                  <input
                    type="number"
                    min={1}
                    step={0.1}
                    value={row[f.key]}
                    onChange={(e) => update(i, { [f.key]: Number(e.target.value) } as Partial<DistanceFormRow>)}
                  />
                </td>
              ))}
              <td className="num" style={{ minWidth: 104 }}>
                <TimeInput
                  value={row.organizerCutoffClock ?? ''}
                  onChange={(v) => update(i, { organizerCutoffClock: v })}
                  align="right"
                  title="Official finish cut-off"
                />
              </td>
              <td style={{ minWidth: 96 }}>
                <DayPicker
                  value={row.cutoffDayOffset ?? 0}
                  onChange={(day) => update(i, { cutoffDayOffset: day })}
                  raceDate={raceDate}
                  title={t('Which day the cut-off falls on')}
                />
              </td>
              <td>
                {row.sourceCourseName && (
                  <button
                    type="button"
                    className="row-remove"
                    title={t('Remove this distance')}
                    onClick={() => removeRow(i)}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {courses.length > 0 && (
        <div className="actions" style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary" onClick={addRow}>
            + {t('Add a distance')}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {t('For a wave, a relay or a category racing a course the files already hold.')}
          </span>
        </div>
      )}

      <p className="hint" style={{ margin: '0.75rem 0 0' }}>
        {t(
          'Paces are minutes per km. Fastest and slowest anchor the P1 and P99 arrivals; spread is how long the field takes to clear the start line. COT is the finish cut-off the organizer has set for that distance — leave it blank if it has not been provided yet, and the tool proposes one instead.'
        )}
      </p>
    </div>
  );
}
