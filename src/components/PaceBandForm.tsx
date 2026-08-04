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
}

const NUMERIC_FIELDS = [
  { key: 'fastestMinPerKm', label: 'Fastest', title: 'Pace of the leading runners, in minutes per km' },
  { key: 'typicalMinPerKm', label: 'Typical', title: 'Median runner pace, in minutes per km' },
  { key: 'slowestMinPerKm', label: 'Slowest', title: 'Pace of the final finishers, in minutes per km' },
] as const;

export function PaceBandForm({ rows, onChange, drivenByResults }: Props) {
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
