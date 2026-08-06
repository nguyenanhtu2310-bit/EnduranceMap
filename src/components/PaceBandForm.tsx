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

export function PaceBandForm({ rows, onChange, drivenByResults, raceDate }: Props) {
  const t = useT();
  function update(index: number, patch: Partial<DistanceFormRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
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
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ margin: '0.75rem 0 0' }}>
        {t(
          'Paces are minutes per km. Fastest and slowest anchor the P1 and P99 arrivals; spread is how long the field takes to clear the start line. COT is the finish cut-off the organizer has set for that distance — leave it blank if it has not been provided yet, and the tool proposes one instead.'
        )}
      </p>
    </div>
  );
}
